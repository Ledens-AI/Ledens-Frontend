import { audit } from '../db/audit.js';
import { PresupuestoError, isUuid } from './service.js';

// New partidas for the base (partida_propuestas): lines of a budget that no
// partida of the base covers. Saving the presupuesto creates them at once
// (createInBase with `auto`, from PresupuestosService.propose); a proposal still
// pending from before is decided here by an admin. Creating appends the
// partida at the end of the base (ledens.work_items) with the next free PA-###
// and, for a new category, the next CAT-### — never changing, reordering or
// reusing anything that exists (rules of the company's budget prompt, §3 and §8).
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const VAT = 0.21;
const LOCK = 727101; // serialises code assignment between approvals

const text = (v, field, max, required) => {
  if (v == null || (typeof v === 'string' && !v.trim())) { if (required) fail(400, `Falta ${field}`); return null; }
  if (typeof v !== 'string' || v.trim().length > max) fail(400, `${field} no válido (máximo ${max} caracteres)`);
  return v.trim();
};

export class PropuestasService {
  constructor(pool, user) { this.pool = pool; this.user = user; }

  admin() { if (this.user?.role !== 'admin') fail(403, 'Solo un administrador revisa las partidas propuestas'); }

  async list({ status = 'pending' } = {}) {
    this.admin();
    if (!['pending', 'approved', 'rejected'].includes(status)) fail(400, 'Estado no válido');
    const rows = (await this.pool.query(`
      SELECT pp.id, pp.status, pp.category_code, pp.category_name, pp.name, pp.definition, pp.unit, pp.price_incl_vat::text price, pp.price_source,
             pp.nearest_code, pp.reason, pp.origin, pp.created_at, pp.decided_at, pp.decision_note, pp.created_code,
             c.name creador, d.name decisor, p.id presupuesto_id, p.ref, p.title, l.name linea, l.quantity::text quantity
        FROM partida_propuestas pp LEFT JOIN users c ON c.id=pp.created_by LEFT JOIN users d ON d.id=pp.decided_by
        LEFT JOIN presupuestos p ON p.id=pp.presupuesto_id LEFT JOIN presupuesto_partidas l ON l.id=pp.partida_id
       WHERE pp.status=$1 ORDER BY pp.created_at DESC LIMIT 200`, [status])).rows;
    const categories = (await this.pool.query('SELECT id_categoria code, name FROM ledens.work_categories WHERE id_categoria IS NOT NULL ORDER BY id_categoria')).rows;
    return {
      propuestas: rows.map((r) => ({
        id: r.id, status: r.status, categoryCode: r.category_code, categoryName: r.category_name, name: r.name, definition: r.definition, unit: r.unit,
        priceInclVat: r.price, priceSource: r.price_source, nearestCode: r.nearest_code, reason: r.reason, origin: r.origin,
        createdAt: r.created_at, createdBy: r.creador, decidedAt: r.decided_at, decidedBy: r.decisor, decisionNote: r.decision_note, createdCode: r.created_code,
        presupuesto: r.presupuesto_id ? { id: r.presupuesto_id, ref: r.ref, title: r.title } : null, line: r.linea ? { name: r.linea, quantity: r.quantity } : null,
      })),
      categories,
    };
  }

  // body may adjust what is created: name, definition, unit, priceInclVat
  // ('' = no price), categoryCode or newCategoryName, incluyeMateriales,
  // subcategoria, palabrasClave, note.
  async approve(id, body = {}) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Propuesta no encontrada');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const p = (await c.query('SELECT pp.*, pr.ref FROM partida_propuestas pp LEFT JOIN presupuestos pr ON pr.id=pp.presupuesto_id WHERE pp.id=$1 FOR UPDATE OF pp', [id])).rows[0];
      if (!p) fail(404, 'Propuesta no encontrada');
      if (p.status !== 'pending') fail(409, 'Esta propuesta ya está decidida');
      const r = await createInBase(c, p, body, this.user);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  async reject(id, body = {}) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Propuesta no encontrada');
    const note = text(body.note, 'el motivo', 1000, true);
    const r = (await this.pool.query("UPDATE partida_propuestas SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1 AND status='pending' RETURNING partida_id, name", [id, this.user.id, note])).rows[0];
    if (!r) fail(409, 'La propuesta no existe o ya está decidida');
    if (r.partida_id) {
      await this.pool.query(`UPDATE presupuesto_partidas SET annotations = annotations || jsonb_build_array(jsonb_build_object('type','nueva','text',$2::text)) WHERE id=$1`,
        [r.partida_id, `Partida propuesta rechazada: ${note}`]);
    }
    await audit({ actor: { id: this.user.id, name: this.user.name || this.user.email }, action: 'Partida propuesta rechazada', target: { id: null, label: r.name.slice(0, 60) }, detail: note }, this.pool);
    return { ok: true };
  }
}

// Appends the partida of proposal `p` (a partida_propuestas row, plus `ref` of
// its presupuesto) to the base inside the caller's transaction `c`, marks the
// proposal approved and links the budget line to the new PA-###. With `auto`
// (saving a presupuesto): no category → «Sin clasificar», and a partida of the
// base with the same name and unit is reused instead of creating a twin.
export async function createInBase(c, p, body = {}, user, { auto = false } = {}) {
  await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
  const name = text(body.name ?? p.name, 'el nombre', 300, true);
  const definition = text(body.definition ?? p.definition, 'La definición', 4000, false);
  const unit = text(body.unit ?? p.unit, 'la unidad', 20, true);
  const rawPrice = body.priceInclVat !== undefined ? body.priceInclVat : p.price_incl_vat;
  let price = null;
  if (rawPrice !== null && rawPrice !== undefined && rawPrice !== '') {
    price = Number(String(rawPrice).replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) fail(400, 'Precio no válido');
  }
  const yesNo = (v, field) => { if (v == null || v === '') return null; if (!['SI', 'NO'].includes(v)) fail(400, `${field}: SI o NO`); return v; };
  const incluyeMateriales = yesNo(body.incluyeMateriales, 'Incluye materiales');
  const subcategoria = text(body.subcategoria, 'La subcategoría', 200, false);
  const palabras = text(body.palabrasClave, 'Las palabras clave', 1000, false);
  const actor = { id: user?.id || null, name: user?.name || user?.email || 'Sistema' };
  const note = text(body.note, 'La nota', 1000, false) ?? (auto ? 'Creada al guardar el presupuesto' : null);
  const link = async (pa, text2) => {
    if (p.partida_id) {
      await c.query(`UPDATE presupuesto_partidas SET base_code=$2,
                       annotations = (SELECT coalesce(jsonb_agg(a) FILTER (WHERE a->>'type'<>'nueva'), '[]'::jsonb) FROM jsonb_array_elements(annotations) a)
                                     || jsonb_build_array(jsonb_build_object('type','nueva','text',$3::text)) WHERE id=$1`, [p.partida_id, pa, text2]);
    }
  };

  // Saving a presupuesto: the same partida already in the base (an earlier line, or created before without price).
  if (auto) {
    const same = (await c.query(`SELECT id_partida, categoria FROM ledens.work_items WHERE lower(btrim(name))=lower($1) AND lower(btrim(unit_source))=lower($2)
                                  AND id_partida ~ '^PA-\\d+$' ORDER BY id_partida LIMIT 1`, [name, unit])).rows[0];
    if (same) {
      await c.query("UPDATE partida_propuestas SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3, created_code=$4 WHERE id=$1",
        [p.id, actor.id, 'Ya existía en la base con el mismo nombre y unidad', same.id_partida]);
      await link(same.id_partida, `Partida de la base ${same.id_partida}, con el mismo nombre y unidad (creada antes desde otro presupuesto).`);
      return { code: same.id_partida, category: null, active: null, reused: true };
    }
  }

  // Category: an existing one, or a new one with the next CAT-###.
  const newCat = async (catName) => {
    const n = (await c.query("SELECT coalesce(max((regexp_match(id_categoria, '^CAT-(\\d+)$'))[1]::int), 0) + 1 n FROM ledens.work_categories")).rows[0].n;
    return (await c.query('INSERT INTO ledens.work_categories (id_categoria, name) VALUES ($1,$2) RETURNING id, id_categoria, name', [`CAT-${String(n).padStart(3, '0')}`, catName])).rows[0];
  };
  let cat = null;
  const code = text(body.categoryCode ?? p.category_code, 'La categoría', 20, false);
  const newName = text(body.newCategoryName, 'El nombre de la categoría', 200, false);
  if (newName) cat = await newCat(newName);
  else if (code) {
    cat = (await c.query('SELECT id, id_categoria, name FROM ledens.work_categories WHERE id_categoria=$1', [code])).rows[0];
    if (!cat && !auto) fail(400, `La categoría ${code} no existe`);
  } else if (!auto) fail(400, 'Elige una categoría existente o crea una nueva');
  if (!cat) {
    cat = (await c.query("SELECT id, id_categoria, name FROM ledens.work_categories WHERE lower(name)='sin clasificar' ORDER BY id_categoria LIMIT 1")).rows[0]
      || await newCat('Sin clasificar');
  }

  const n = (await c.query("SELECT coalesce(max((regexp_match(id_partida, '^PA-(\\d+)$'))[1]::int), 0) + 1 n FROM ledens.work_items")).rows[0].n;
  const pa = `PA-${String(n).padStart(3, '0')}`;
  const unitId = (await c.query('SELECT unit_id FROM ledens.work_items WHERE unit_source=$1 AND unit_id IS NOT NULL LIMIT 1', [unit])).rows[0]?.unit_id || null;
  const observaciones = [p.origin, price == null ? 'PRECIO PENDIENTE DE VALORACIÓN.' : `Precio: ${p.price_source || 'indicado por el administrador al aprobarla'}.`,
    'PENDIENTE DE VALIDACIÓN COMO PRECIO ESTÁNDAR. Rendimiento no validado.', p.reason].filter(Boolean).join(' ');
  await c.query(`INSERT INTO ledens.work_items (id_partida, category_id, categoria, name, definicion_partida, unit_source, unit_id,
                   sale_price_including_vat, sale_price_excluding_vat, incluye_materiales, activa, subcategoria, palabrasclave, observacionesagente,
                   rendimientovalidado, observacionesplanificacion)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'NO','Pendiente de definir con datos reales de Ledens')`,
  [pa, cat.id, cat.name, name, definition, unit, unitId, price, price == null ? null : Math.round(price / (1 + VAT) * 1e6) / 1e6,
    incluyeMateriales, price == null ? 'NO' : 'SI', subcategoria, palabras, observaciones.slice(0, 4000)]);
  await c.query("UPDATE partida_propuestas SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3, created_code=$4, category_code=$5, name=$6, definition=$7, unit=$8, price_incl_vat=$9 WHERE id=$1",
    [p.id, actor.id, note, pa, cat.id_categoria, name, definition, unit, price]);
  await link(pa, `Partida nueva creada en la base como ${pa} · ${cat.id_categoria} ${cat.name} (${price == null ? 'inactiva, precio pendiente de valoración' : 'activa'}).`);
  await audit({ actor, action: 'Partida creada en la base', target: { id: null, label: pa }, detail: `${pa} «${name}» (${unit}${price == null ? ', sin precio' : `, ${price} € IVA incl.`}) · ${cat.id_categoria}${p.ref ? ` · desde ${p.ref}` : ''}${auto ? ' · al guardar el presupuesto' : ''}` }, c);
  return { code: pa, category: cat.id_categoria, active: price != null };
}
