import { audit } from '../db/audit.js';
import { PresupuestoError, isUuid } from './service.js';

// «Partidas» (admins): the base de partidas (ledens.work_items) as a table an
// admin can read and correct. ledens.* belongs to the accounting import, and
// its exact columns are not defined in this repo, so the columns are read from
// the catalog (information_schema) on every call: the screen shows the most
// important ones first (name, description, unit, prices, rendimiento…) and
// lets the admin edit every plain value (text, number, yes/no, date).
// Never inserted or deleted here, never renumbered: id_partida is read-only
// because budgets keep it (presupuesto_partidas.base_code). Every change is
// optimistic (the screen sends the value it saw; someone else's newer change
// answers 409) and written to audit_log.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const VAT = 0.21;
const PAGE = 50;

// Never shown: keys and links to other tables.
const HIDDEN = new Set(['id', 'source_id', 'raw_id', 'category_id', 'unit_id']);
// Shown, never edited.
const READ_ONLY = new Set(['id_partida']);
// SI / NO text columns of the base.
const YES_NO = new Set(['activa', 'incluye_materiales', 'rendimientovalidado']);
const LABELS = {
  id_partida: 'Código', name: 'Nombre de partida', categoria: 'Categoría', subcategoria: 'Subcategoría', definicion_partida: 'Descripción',
  unit_source: 'Unidad de medición', sale_price_including_vat: 'Precio venta (IVA incl.)', sale_price_excluding_vat: 'Precio venta (sin IVA)',
  activa: 'Activa', incluye_materiales: 'Incluye materiales', rendimientovalidado: 'Rendimiento validado', palabrasclave: 'Palabras clave',
  observacionesagente: 'Observaciones (agente)', observacionesplanificacion: 'Observaciones de planificación',
};
// Order of the important columns; any rendimiento/cuadrilla/coste/precio column follows them.
const MAIN = ['id_partida', 'name', 'categoria', 'definicion_partida', 'unit_source', 'sale_price_including_vat', 'sale_price_excluding_vat'];
const MAIN_TAIL = ['incluye_materiales', 'activa'];
const isMainExtra = (c) => /rendimiento|cuadrilla|horas|jornada/.test(c) && c !== 'rendimientovalidado';
// Wide text that does not fit a table cell: in the row, only on its detail.
const LONG = new Set(['definicion_partida', 'palabrasclave', 'observacionesagente', 'observacionesplanificacion']);

const kindOf = (t) => (/^(numeric|integer|smallint|bigint|real|double precision)$/.test(t) ? 'number'
  : t === 'boolean' ? 'boolean' : t === 'date' ? 'date' : /^(text|character varying|character)$/.test(t) ? 'text' : null);
const humanize = (c) => { const s = c.replace(/_/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const q = (c) => `"${c.replace(/"/g, '""')}"`;

export class PartidasService {
  constructor(pool, user) { this.pool = pool; this.user = user; }

  admin() { if (this.user?.role !== 'admin') fail(403, 'Solo un administrador gestiona las partidas'); }

  // Columns of ledens.work_items, the important ones first.
  async columns(db = this.pool) {
    const rows = (await db.query(`SELECT column_name c, data_type t, character_maximum_length len, is_generated g, is_identity i
                                    FROM information_schema.columns WHERE table_schema='ledens' AND table_name='work_items' ORDER BY ordinal_position`)).rows;
    if (!rows.length) fail(503, 'La base de partidas no está disponible');
    this.allColumns = new Set(rows.map((r) => r.c));
    const cols = rows.filter((r) => !HIDDEN.has(r.c)).map((r) => {
      const kind = r.c === 'categoria' ? 'category' : YES_NO.has(r.c) && kindOf(r.t) === 'text' ? 'yesno' : kindOf(r.t);
      return {
        key: r.c, label: LABELS[r.c] || humanize(r.c), kind: kind || 'other',
        editable: !!kind && !READ_ONLY.has(r.c) && r.g !== 'ALWAYS' && r.i !== 'YES' && !/(^|_)(created|updated|imported|synced)(_at)?$/.test(r.c),
        max: r.len || (r.c === 'name' ? 300 : 4000), long: LONG.has(r.c),
      };
    });
    const rank = (c) => { const i = MAIN.indexOf(c.key); if (i >= 0) return i; if (isMainExtra(c.key)) return 50; const j = MAIN_TAIL.indexOf(c.key); return j >= 0 ? 80 + j : 1000; };
    cols.sort((a, b) => rank(a) - rank(b));
    for (const c of cols) c.main = rank(c) < 1000;
    return cols;
  }

  async list({ q: search = '', categoria = '', activa = '', page = 1 } = {}) {
    this.admin();
    const cols = await this.columns();
    const has = new Set(cols.map((c) => c.key));
    const where = []; const args = [];
    const term = String(search || '').trim().slice(0, 200);
    if (term) {
      args.push(`%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(${['id_partida', 'name', 'definicion_partida', 'palabrasclave', 'subcategoria'].filter((c) => has.has(c)).map((c) => `w.${q(c)} ILIKE $${args.length}`).join(' OR ') || 'false'})`);
    }
    if (categoria) { args.push(String(categoria)); where.push(`c.id_categoria = $${args.length}`); }
    if (activa && has.has('activa')) { args.push(activa === 'si' ? 'si' : 'no'); where.push(`lower(coalesce(w.activa, 'no')) = $${args.length}`); }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = 'FROM ledens.work_items w LEFT JOIN ledens.work_categories c ON c.id = w.category_id';
    const total = Number((await this.pool.query(`SELECT count(*) n ${from} ${sqlWhere}`, args)).rows[0].n);
    const p = Math.max(1, Math.min(Number.parseInt(page, 10) || 1, Math.max(1, Math.ceil(total / PAGE))));
    const sel = cols.map((c) => `w.${q(c.key)}::text AS ${q(c.key)}`).join(', ');
    const rows = (await this.pool.query(`SELECT w.id, c.id_categoria category_code, ${sel} ${from} ${sqlWhere}
      ORDER BY (regexp_match(w.id_partida, '^PA-(\\d+)$'))[1]::int NULLS LAST, w.id_partida NULLS LAST, w.id LIMIT ${PAGE} OFFSET ${(p - 1) * PAGE}`, args)).rows;
    const categories = (await this.pool.query('SELECT id_categoria code, name FROM ledens.work_categories WHERE id_categoria IS NOT NULL ORDER BY id_categoria')).rows;
    const units = has.has('unit_source')
      ? (await this.pool.query("SELECT DISTINCT unit_source u FROM ledens.work_items WHERE coalesce(unit_source, '') <> '' ORDER BY 1")).rows.map((r) => r.u) : [];
    return {
      columns: cols, categories, units, total, page: p, pageSize: PAGE,
      partidas: rows.map(({ id, category_code: categoryCode, ...values }) => ({ id, categoryCode, values })),
    };
  }

  // body: { changes: { column: { from, to } } } — `from` is the value the
  // screen showed (as text, '' for none); `to` the new one. For «categoria»
  // both are category codes (CAT-###).
  async update(id, body = {}) {
    this.admin();
    if (!isUuid(id)) fail(404, 'Partida no encontrada');
    const changes = body.changes && typeof body.changes === 'object' ? Object.entries(body.changes) : [];
    if (!changes.length) fail(400, 'No hay cambios que guardar');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const cols = await this.columns(c);
      const byKey = new Map(cols.map((x) => [x.key, x]));
      const sel = cols.map((x) => `w.${q(x.key)}::text AS ${q(x.key)}`).join(', ');
      const cur = (await c.query(`SELECT w.id, c.id_categoria category_code, ${sel} FROM ledens.work_items w LEFT JOIN ledens.work_categories c ON c.id = w.category_id WHERE w.id=$1 FOR UPDATE OF w`, [id])).rows[0];
      if (!cur) fail(404, 'Partida no encontrada');
      const sets = []; const args = [id]; const detail = [];
      const put = (col, v) => { args.push(v); sets.push(`${q(col)} = $${args.length}`); };
      const touched = new Set(changes.map(([k]) => k));
      for (const [key, ch] of changes) {
        const col = byKey.get(key);
        if (!col || !col.editable) fail(400, `El campo ${col?.label || key} no se puede modificar`);
        const was = key === 'categoria' ? cur.category_code : cur[key];
        if (!ch || typeof ch !== 'object' || !('to' in ch)) fail(400, `Cambio no válido en ${col.label}`);
        if (String(ch.from ?? '') !== String(was ?? '')) fail(409, `Otra persona ha cambiado «${col.label}» de esta partida. Vuelve a cargarla.`);
        const value = await this.coerce(c, col, ch.to);
        if (key === 'categoria') {
          if (value?.code === cur.category_code) continue;
          put('category_id', value?.id ?? null); put('categoria', value?.name ?? null);
          detail.push(`${col.label}: ${cur.category_code || '—'} → ${value?.code || '—'}`);
        } else {
          if ((value == null ? null : String(value)) === was || (value != null && col.kind === 'number' && was != null && Number(value) === Number(was))) continue;
          put(key, value);
          detail.push(`${col.label}: ${short(was)} → ${short(value)}`);
          // The unit's link follows the text, as when a proposed partida is approved.
          if (key === 'unit_source' && this.allColumns.has('unit_id')) {
            const unitId = value ? (await c.query('SELECT unit_id FROM ledens.work_items WHERE unit_source=$1 AND unit_id IS NOT NULL AND id<>$2 LIMIT 1', [value, id])).rows[0]?.unit_id || null : null;
            put('unit_id', unitId);
          }
          // One price follows the other (21 % IVA) unless both were edited.
          const pair = { sale_price_including_vat: ['sale_price_excluding_vat', (n) => n / (1 + VAT)], sale_price_excluding_vat: ['sale_price_including_vat', (n) => n * (1 + VAT)] }[key];
          if (pair && byKey.has(pair[0]) && !touched.has(pair[0])) {
            const other = value == null ? null : Math.round(pair[1](Number(value)) * 1e6) / 1e6;
            put(pair[0], other);
            detail.push(`${byKey.get(pair[0]).label}: ${short(cur[pair[0]])} → ${short(other)} (calculado, IVA 21 %)`);
          }
        }
      }
      if (!sets.length) { await c.query('ROLLBACK'); return { ok: true, changed: false, partida: await this.one(id) }; }
      await c.query(`UPDATE ledens.work_items SET ${sets.join(', ')} WHERE id=$1`, args);
      const label = cur.id_partida || (cur.name || 'Partida').slice(0, 60);
      await audit({ actor: { id: this.user.id, name: this.user.name || this.user.email }, action: 'Partida modificada', target: { id: null, label }, detail: `${label} · ${detail.join(' · ')}`.slice(0, 4000) }, c);
      await c.query('COMMIT');
      return { ok: true, changed: true, partida: await this.one(id) };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  async one(id) {
    const cols = await this.columns();
    const sel = cols.map((x) => `w.${q(x.key)}::text AS ${q(x.key)}`).join(', ');
    const r = (await this.pool.query(`SELECT w.id, c.id_categoria category_code, ${sel} FROM ledens.work_items w LEFT JOIN ledens.work_categories c ON c.id = w.category_id WHERE w.id=$1`, [id])).rows[0];
    if (!r) return null;
    const { id: rid, category_code: categoryCode, ...values } = r;
    return { id: rid, categoryCode, values };
  }

  async coerce(db, col, v) {
    const empty = v == null || (typeof v === 'string' && !v.trim());
    if (col.kind === 'category') {
      if (empty) fail(400, 'Elige una categoría');
      const cat = (await db.query('SELECT id, id_categoria code, name FROM ledens.work_categories WHERE id_categoria=$1', [String(v)])).rows[0];
      if (!cat) fail(400, `La categoría ${v} no existe`);
      return cat;
    }
    if (empty) { if (col.key === 'name') fail(400, 'El nombre de la partida no puede quedar vacío'); return null; }
    if (col.kind === 'number') {
      const s = String(v).trim().replace(/\s/g, '');
      const n = Number(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s);
      if (!Number.isFinite(n)) fail(400, `${col.label}: número no válido`);
      if (/precio|price|rendimiento|cuadrilla/.test(col.key) && n < 0) fail(400, `${col.label} no puede ser negativo`);
      return n;
    }
    if (col.kind === 'yesno') { const s = String(v).trim().toUpperCase(); if (!['SI', 'NO'].includes(s)) fail(400, `${col.label}: SI o NO`); return s; }
    if (col.kind === 'boolean') { if (v === true || v === 'true') return true; if (v === false || v === 'false') return false; fail(400, `${col.label}: sí o no`); }
    if (col.kind === 'date') { const s = String(v).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail(400, `${col.label}: fecha no válida`); return s; }
    const s = String(v).trim();
    if (s.length > col.max) fail(400, `${col.label}: máximo ${col.max} caracteres`);
    return s;
  }
}

const short = (v) => { if (v == null || v === '') return '—'; const s = String(v); return s.length > 80 ? `«${s.slice(0, 77)}…»` : `«${s}»`; };
