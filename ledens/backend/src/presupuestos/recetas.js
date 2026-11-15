import { audit } from '../db/audit.js';
import { PresupuestoError, PresupuestosService, isUuid } from './service.js';
import { seedRecetas, toolType, unitFamily, TOOLS } from './recetasIniciales.js';

// Recetas de las partidas (migration 046): the tools each partida of the base
// requires and the materials one unit of it consumes. Admins edit them from
// «Partidas» (Herramientas / Materiales); the team reads them. A presupuesto
// turns them into what its lines need (/api/presupuestos/:id/necesidades) and
// an obra compares the tools it needs with the ones it has (Ledens Tools).
// A tool is a type of Ledens Tools (inventory.tool_types); naming one that does
// not exist creates the type (no unit, just the catalogue entry). The partida is
// keyed by its PA-### code, never by the uuid of ledens.work_items.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const CODE = /^PA-\d+$/;
const COUNTED = "(l.kind IN ('confirmada','condicionada') OR l.selected)";
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const str = (v, field, max, required) => {
  if (v == null || (typeof v === 'string' && !v.trim())) { if (required) fail(400, `Falta ${field}`); return null; }
  if (typeof v !== 'string' && typeof v !== 'number') fail(400, `${field} no válido`);
  const s = String(v).trim();
  if (s.length > max) fail(400, `${field}: máximo ${max} caracteres`);
  return s;
};
const decimal = (v, field, { min = 0, max = 1e9, required = false, positive = false } = {}) => {
  if (v == null || v === '') { if (required) fail(400, `Falta ${field}`); return null; }
  const s = String(v).trim().replace(/\s/g, '');
  const n = Number(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s);
  if (!Number.isFinite(n) || n < min || n > max || (positive && n <= 0)) fail(400, `${field}: número no válido`);
  return n;
};

const toolOut = (r) => ({ id: r.id, toolTypeId: r.tool_type_id, name: r.type_name, category: r.category, tracking: r.tracking, quantity: r.quantity, notes: r.notes, origin: r.origin });
const matOut = (r) => ({ id: r.id, name: r.name, unit: r.unit, quantity: String(Number(r.quantity)), wastePct: String(Number(r.waste_pct)), notes: r.notes, origin: r.origin });


export class RecetasService {
  constructor(pool, user) { this.pool = pool; this.user = user; }

  admin() { if (this.user?.role !== 'admin') fail(403, 'Solo un administrador modifica las herramientas y materiales de las partidas'); }
  team() { if (!['admin', 'jefe'].includes(this.user?.role)) fail(403, 'Solo el equipo ve las recetas de las partidas'); }
  actor() { return { id: this.user.id, name: this.user.name || this.user.email }; }

  async tx(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  // code → { herramientas, materiales } for the given PA-### codes.
  async forCodes(codes, db = this.pool) {
    const list = [...new Set(codes.filter((c) => CODE.test(c || '')))];
    const out = new Map(list.map((c) => [c, { herramientas: [], materiales: [] }]));
    if (!list.length) return out;
    const tools = (await db.query(`SELECT h.*, t.name type_name, t.category, t.tracking FROM partida_herramientas h JOIN inventory.tool_types t ON t.id=h.tool_type_id
                                   WHERE h.base_code=ANY($1::text[]) ORDER BY h.base_code, h.position, t.name`, [list])).rows;
    const mats = (await db.query('SELECT * FROM partida_materiales WHERE base_code=ANY($1::text[]) ORDER BY base_code, position, name', [list])).rows;
    for (const t of tools) out.get(t.base_code).herramientas.push(toolOut(t));
    for (const m of mats) out.get(m.base_code).materiales.push(matOut(m));
    return out;
  }

  async partida(db, code) {
    if (!CODE.test(code || '')) fail(404, 'Partida no encontrada');
    const p = (await db.query('SELECT id_partida code, name, unit_source unit FROM ledens.work_items WHERE id_partida=$1 ORDER BY id LIMIT 1', [code])).rows[0];
    if (!p) fail(404, 'Partida no encontrada');
    return p;
  }

  async get(code) {
    this.team();
    const p = await this.partida(this.pool, code);
    return { partida: p, ...(await this.forCodes([code])).get(code) };
  }

  // Tool types offered when adding a tool (consumables are materials, not tools).
  async toolTypes() {
    this.team();
    const rows = (await this.pool.query("SELECT id, name, category, tracking FROM inventory.tool_types WHERE active AND tracking<>'consumible' ORDER BY category, name")).rows;
    return { types: rows.map((t) => ({ id: t.id, name: t.name, category: t.category, tracking: t.tracking })), categories: [...new Set([...rows.map((t) => t.category), ...Object.values(TOOLS)])].sort() };
  }

  async log(db, code, detail) {
    await audit({ actor: this.actor(), action: 'Receta de partida modificada', target: { id: null, label: code }, detail: `${code} · ${detail}`.slice(0, 4000) }, db);
  }

  async addTool(code, body = {}) {
    this.admin();
    const quantity = Math.round(decimal(body.quantity ?? 1, 'Cantidad', { min: 1, max: 99 }));
    const notes = str(body.notes, 'Observaciones', 500, false);
    return this.tx(async (db) => {
      await this.partida(db, code);
      let type;
      if (body.toolTypeId) {
        if (!isUuid(body.toolTypeId)) fail(400, 'Herramienta no válida');
        type = (await db.query('SELECT id, name, category, tracking FROM inventory.tool_types WHERE id=$1 AND active', [body.toolTypeId])).rows[0];
        if (!type) fail(400, 'Herramienta no encontrada en el inventario');
      } else {
        const name = str(body.name, 'Nombre de la herramienta', 120, true);
        type = await toolType(db, name, str(body.category, 'Categoría', 80, false));
        if (type.created) await audit({ actor: this.actor(), action: 'Tipo de herramienta creado', target: { id: null, label: type.name }, detail: `${type.name} · ${type.category} · individual · desde la receta de ${code}` }, db);
      }
      if (type.tracking === 'consumible') fail(400, `${type.name} es un consumible: añádelo en Materiales`);
      const pos = (await db.query('SELECT coalesce(max(position),0)+1 n FROM partida_herramientas WHERE base_code=$1', [code])).rows[0].n;
      const r = (await db.query(`INSERT INTO partida_herramientas (base_code, tool_type_id, quantity, notes, position, created_by) VALUES ($1,$2,$3,$4,$5,$6)
                                 ON CONFLICT (base_code, tool_type_id) DO NOTHING RETURNING id`, [code, type.id, quantity, notes, pos, this.user.id])).rows[0];
      if (!r) fail(409, `${type.name} ya está en las herramientas de esta partida`);
      await this.log(db, code, `herramienta añadida: ${type.name} × ${quantity}`);
      return { ...(await this.forCodes([code], db)).get(code) };
    });
  }

  async updateTool(code, id, body = {}) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Herramienta no encontrada');
    return this.tx(async (db) => {
      const cur = (await db.query('SELECT h.*, t.name type_name FROM partida_herramientas h JOIN inventory.tool_types t ON t.id=h.tool_type_id WHERE h.id=$1 AND h.base_code=$2 FOR UPDATE OF h', [id, code])).rows[0];
      if (!cur) fail(404, 'Herramienta no encontrada');
      const quantity = body.quantity === undefined ? cur.quantity : Math.round(decimal(body.quantity, 'Cantidad', { min: 1, max: 99, required: true }));
      const notes = body.notes === undefined ? cur.notes : str(body.notes, 'Observaciones', 500, false);
      await db.query('UPDATE partida_herramientas SET quantity=$2, notes=$3 WHERE id=$1', [id, quantity, notes]);
      await this.log(db, code, `herramienta ${cur.type_name}: ${cur.quantity} → ${quantity}${notes !== cur.notes ? ' (observaciones)' : ''}`);
      return { ...(await this.forCodes([code], db)).get(code) };
    });
  }

  async removeTool(code, id) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Herramienta no encontrada');
    return this.tx(async (db) => {
      const cur = (await db.query('DELETE FROM partida_herramientas h USING inventory.tool_types t WHERE h.id=$1 AND h.base_code=$2 AND t.id=h.tool_type_id RETURNING t.name', [id, code])).rows[0];
      if (!cur) fail(404, 'Herramienta no encontrada');
      await this.log(db, code, `herramienta quitada: ${cur.name}`);
      return { ...(await this.forCodes([code], db)).get(code) };
    });
  }

  material(body, cur = {}) {
    const has = (k) => body[k] !== undefined;
    return {
      name: has('name') ? str(body.name, 'Material', 160, true) : cur.name,
      unit: has('unit') ? str(body.unit, 'Unidad del material', 20, true) : cur.unit,
      quantity: has('quantity') ? decimal(body.quantity, 'Cantidad por unidad', { required: true, positive: true, max: 1e8 }) : Number(cur.quantity),
      wastePct: has('wastePct') ? (decimal(body.wastePct, 'Merma', { max: 100 }) ?? 0) : Number(cur.waste_pct ?? 0),
      notes: has('notes') ? str(body.notes, 'Observaciones', 500, false) : cur.notes ?? null,
    };
  }

  async addMaterial(code, body = {}) {
    this.admin();
    const m = this.material(body);
    if (!m.name) fail(400, 'Falta Material');
    if (!m.unit) fail(400, 'Falta Unidad del material');
    if (!(m.quantity > 0)) fail(400, 'Falta Cantidad por unidad');
    return this.tx(async (db) => {
      const p = await this.partida(db, code);
      const pos = (await db.query('SELECT coalesce(max(position),0)+1 n FROM partida_materiales WHERE base_code=$1', [code])).rows[0].n;
      const r = (await db.query(`INSERT INTO partida_materiales (base_code, name, unit, quantity, waste_pct, notes, position, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                                 ON CONFLICT DO NOTHING RETURNING id`, [code, m.name, m.unit, m.quantity, m.wastePct, m.notes, pos, this.user.id])).rows[0];
      if (!r) fail(409, `${m.name} ya está en los materiales de esta partida`);
      await this.log(db, code, `material añadido: ${m.name} ${m.quantity} ${m.unit} por ${p.unit || 'unidad'}${m.wastePct ? ` + ${m.wastePct} % de merma` : ''}`);
      return { ...(await this.forCodes([code], db)).get(code) };
    });
  }

  async updateMaterial(code, id, body = {}) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Material no encontrado');
    return this.tx(async (db) => {
      const cur = (await db.query('SELECT * FROM partida_materiales WHERE id=$1 AND base_code=$2 FOR UPDATE', [id, code])).rows[0];
      if (!cur) fail(404, 'Material no encontrado');
      const m = this.material(body, cur);
      if (m.name.toLowerCase() !== cur.name.toLowerCase()
        && (await db.query('SELECT 1 FROM partida_materiales WHERE base_code=$1 AND lower(btrim(name))=lower(btrim($2)) AND id<>$3', [code, m.name, id])).rows.length) fail(409, `${m.name} ya está en los materiales de esta partida`);
      await db.query('UPDATE partida_materiales SET name=$2, unit=$3, quantity=$4, waste_pct=$5, notes=$6 WHERE id=$1', [id, m.name, m.unit, m.quantity, m.wastePct, m.notes]);
      await this.log(db, code, `material ${cur.name}: ${Number(cur.quantity)} ${cur.unit} (+${Number(cur.waste_pct)} %) → ${m.name} ${m.quantity} ${m.unit} (+${m.wastePct} %)`);
      return { ...(await this.forCodes([code], db)).get(code) };
    });
  }

  async removeMaterial(code, id) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Material no encontrado');
    return this.tx(async (db) => {
      const cur = (await db.query('DELETE FROM partida_materiales WHERE id=$1 AND base_code=$2 RETURNING name', [id, code])).rows[0];
      if (!cur) fail(404, 'Material no encontrado');
      await this.log(db, code, `material quitado: ${cur.name}`);
      return { ...(await this.forCodes([code], db)).get(code) };
    });
  }

  // What a presupuesto needs: its counted lines × the receta of their partida.
  //  ambito 'version' (default): the version on screen (or ?version=);
  //  ambito 'obra': the obra's approved lines (root + approved ampliaciones).
  // Team only. Lines with no partida of the base, or whose unit is not the
  // partida's (m² against ml…), are listed apart and never guessed.
  async necesidades(id, { versionId, ambito = 'version' } = {}) {
    const svc = new PresupuestosService(this.pool, this.user);
    const p = await svc.load(this.pool, id);
    if (!svc.isTeam(p)) fail(404, 'Presupuesto no encontrado');
    let lines; let version = null; let optional = 0;
    if (ambito === 'obra') {
      if (p.parent_id) fail(400, 'Las necesidades de la obra se ven en el presupuesto principal');
      lines = await svc.obraLines([p.id]);
    } else {
      if (versionId && !isUuid(versionId)) fail(404, 'Versión no encontrada');
      const v = (await this.pool.query(`SELECT id, number, status FROM presupuesto_versiones WHERE presupuesto_id=$1 ${versionId ? 'AND id=$2' : ''} ORDER BY number DESC LIMIT 1`,
        versionId ? [p.id, versionId] : [p.id])).rows[0];
      if (!v) fail(404, 'Versión no encontrada');
      version = { id: v.id, number: v.number, status: v.status };
      const all = (await this.pool.query(`SELECT l.id, l.code, l.base_code, l.name, l.unit, l.quantity::text, ${COUNTED} counted FROM presupuesto_partidas l
                                           JOIN presupuesto_capitulos ch ON ch.id=l.capitulo_id WHERE l.version_id=$1 ORDER BY ch.position, l.position`, [v.id])).rows;
      lines = all.filter((l) => l.counted);
      optional = all.length - lines.length;
    }
    const codeOf = (l) => l.base_code || (CODE.test(l.code || '') ? l.code : null);
    const codes = [...new Set(lines.map(codeOf).filter(Boolean))];
    const recetas = await this.forCodes(codes);
    const base = new Map(codes.length ? (await this.pool.query('SELECT DISTINCT ON (id_partida) id_partida, name, unit_source FROM ledens.work_items WHERE id_partida=ANY($1::text[]) ORDER BY id_partida, id', [codes])).rows.map((r) => [r.id_partida, r]) : []);
    const materiales = new Map(); const herramientas = new Map(); const sinReceta = [];
    for (const l of lines) {
      const code = codeOf(l);
      const r = code && recetas.get(code);
      if (!code || !base.has(code)) { sinReceta.push({ name: l.name, code: code || l.code || null, reason: 'Sin partida de la base' }); continue; }
      if (!r.herramientas.length && !r.materiales.length) { sinReceta.push({ name: l.name, code, reason: 'La partida no tiene herramientas ni materiales' }); continue; }
      for (const h of r.herramientas) {
        const t = herramientas.get(h.toolTypeId) || { toolTypeId: h.toolTypeId, name: h.name, category: h.category, tracking: h.tracking, quantity: 0, partidas: [] };
        t.quantity = Math.max(t.quantity, h.quantity);
        if (!t.partidas.includes(code)) t.partidas.push(code);
        herramientas.set(h.toolTypeId, t);
      }
      if (!r.materiales.length) continue;
      const fl = unitFamily(l.unit), fb = unitFamily(base.get(code).unit_source);
      if (fl && fb && fl !== fb) { sinReceta.push({ name: l.name, code, reason: `Unidad distinta: la línea va en ${l.unit} y la receta por ${base.get(code).unit_source}` }); continue; }
      const qty = Number(l.quantity);
      for (const m of r.materiales) {
        const need = qty * Number(m.quantity) * (1 + Number(m.wastePct) / 100);
        const key = `${m.name.toLowerCase()}|${m.unit.toLowerCase()}`;
        const t = materiales.get(key) || { name: m.name, unit: m.unit, quantity: 0, partidas: [] };
        t.quantity += need;
        t.partidas.push({ code, name: l.name, quantity: String(round(need)) });
        materiales.set(key, t);
      }
    }
    return {
      ambito: ambito === 'obra' ? 'obra' : 'version', version, obra: { id: p.parent_id || p.id, projectId: p.parent_id ? null : p.project_id },
      lineas: lines.length, opcionalesExcluidas: optional,
      materiales: [...materiales.values()].map((m) => ({ ...m, quantity: String(round(m.quantity)) })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
      herramientas: [...herramientas.values()].sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es')),
      sinReceta,
    };
  }
}


export { seedRecetas };
export const JOB = 'recetas-partidas-iniciales-1';

// Once per database, at startup, after the migrations (never blocks the API).
export async function runRecetasInicialesOnce(pool, { log = console.log } = {}) {
  if ((await pool.query('SELECT 1 FROM mantenimientos WHERE name=$1', [JOB])).rows.length) return null;
  if (!(await pool.query("SELECT to_regclass('ledens.work_items') t")).rows[0].t) return null; // no base yet: retried at next start
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Two replicas starting at once: only one seeds.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [JOB]);
    if ((await c.query('SELECT 1 FROM mantenimientos WHERE name=$1', [JOB])).rows.length) { await c.query('ROLLBACK'); return null; }
    const r = await seedRecetas(c);
    if (!r.partidas) { await c.query('ROLLBACK'); return r; } // empty base: retried at next start
    await c.query('INSERT INTO mantenimientos (name, detail) VALUES ($1,$2)', [JOB, `${r.conReceta} de ${r.partidas} partidas con receta inicial (${r.herramientas} herramientas, ${r.materiales} materiales); sin regla: ${r.sinRegla.length}`]);
    await c.query('COMMIT');
    log(`[recetas] ${r.conReceta} de ${r.partidas} partidas con receta inicial · ${r.herramientas} herramientas · ${r.materiales} materiales · sin regla: ${r.sinRegla.join(', ') || 'ninguna'}`);
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
