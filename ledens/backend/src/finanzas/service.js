// Gestión financiera: imputación de material_expenses, worker_payments y
// customer_payments a ledens.projects, y la rentabilidad que sale de ello.
// Column names below are the real production ones (see FINANZAS.md for how they
// were obtained) — never invent new ones here: the tables belong to the
// accounting import, this module only writes project_id and its own
// imputation_* / project_allocations tables (migration 010).
import { audit as auditLog } from '../db/audit.js';

export class FinError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// Record type → source table and the column shown/distributed as "Importe".
export const TYPES = {
  material: { table: 'ledens.material_expenses', amount: 'total', label: 'Material' },
  trabajador: { table: 'ledens.worker_payments', amount: 'amount', label: 'Pago a trabajador' },
  cliente: { table: 'ledens.customer_payments', amount: 'total', label: 'Pago de cliente' },
};
export const STATES = ['pendiente', 'asignado', 'parcial', 'revision'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

// What a project is called on screen: "Municipio — Nombre", never the uuid.
const PROJECT_LABEL = `concat_ws(' — ', NULLIF(btrim(pr.municipio), ''), COALESCE(NULLIF(btrim(pr.name), ''), NULLIF(btrim(pr.project_id), ''), 'Proyecto sin nombre'))`;

// One row per imputable record, whatever its table. `tercero` is the supplier,
// worker or client name; `categoria` feeds the cost breakdown.
const RECORDS_CTE = `
rec AS (
  SELECT 'material'::text AS type, m.id, m.occurred_on AS fecha, m.total AS importe, m.project_id,
         m.document_id, m.bank_movement_id,
         COALESCE(NULLIF(btrim(d.tercero), ''), NULLIF(btrim(b.beneficiary_name), '')) AS tercero,
         concat_ws(' · ', NULLIF(btrim(m.description), ''), NULLIF(btrim(m.partida), '')) AS concepto,
         m.quantity, m.und AS unidad, m.unit_price,
         COALESCE(NULLIF(btrim(wi.categoria), ''), NULLIF(btrim(m.partida), ''), 'Materiales sin categoría') AS categoria
    FROM ledens.material_expenses m
    LEFT JOIN ledens.documents d ON d.id = m.document_id
    LEFT JOIN ledens.bank_movements b ON b.id = m.bank_movement_id
    LEFT JOIN ledens.work_items wi ON wi.id = m.work_item_id
  UNION ALL
  SELECT 'trabajador', w.id, w.occurred_on, w.amount, w.project_id, w.document_id, w.bank_movement_id,
         COALESCE(NULLIF(btrim(e.name), ''), NULLIF(btrim(w.empleado), '')),
         concat_ws(' · ', NULLIF(btrim(COALESCE(wc.name, w.categoria)), ''), NULLIF(btrim(w.forma_de_pago), '')),
         NULL::numeric, NULL::text, NULL::numeric,
         COALESCE(NULLIF(btrim(COALESCE(wc.name, w.categoria)), ''), 'Mano de obra sin categoría')
    FROM ledens.worker_payments w
    LEFT JOIN ledens.employees e ON e.id = w.employee_id
    LEFT JOIN ledens.work_categories wc ON wc.id = w.category_id
  UNION ALL
  SELECT 'cliente', p.id, p.occurred_on, p.total, p.project_id, p.document_id, p.bank_movement_id,
         NULLIF(btrim(p.cliente), ''),
         concat_ws(' · ', 'Pago ' || NULLIF(btrim(p.id_pago), ''), NULLIF(btrim(d.descripcion), '')),
         NULL::numeric, NULL::text, NULL::numeric, 'Cobros'
    FROM ledens.customer_payments p
    LEFT JOIN ledens.documents d ON d.id = p.document_id
),
alloc AS (
  SELECT source_type, source_id, sum(amount) AS allocated, count(*)::int AS parts
    FROM ledens.project_allocations GROUP BY 1, 2
),
full_rec AS (
  SELECT r.*, a.allocated, COALESCE(a.parts, 0) AS parts,
         COALESCE(rv.needs_review, false) AS needs_review, rv.review_note,
         rv.suggested_project_id, rv.suggestion_reason,
         CASE WHEN COALESCE(rv.needs_review, false) THEN 'revision'
              WHEN a.parts > 0 AND a.allocated = r.importe THEN 'asignado'
              WHEN a.parts > 0 THEN 'parcial'
              WHEN r.project_id IS NOT NULL THEN 'asignado'
              ELSE 'pendiente' END AS estado,
         (r.project_id IS NULL AND (a.parts IS NULL OR a.allocated <> r.importe)) AS sin_proyecto
    FROM rec r
    LEFT JOIN alloc a ON a.source_type = r.type AND a.source_id = r.id
    LEFT JOIN ledens.imputation_reviews rv ON rv.source_type = r.type AND rv.source_id = r.id
)`;

// Effective imputation: a split record counts through its parts, any other
// assigned record counts whole. Never both (trigger in migration 010).
const IMPUTED_CTE = `${RECORDS_CTE},
imputed AS (
  SELECT r.type, r.id, r.fecha, r.categoria,
         CASE WHEN pa.id IS NULL THEN r.project_id ELSE pa.project_id END AS project_id,
         CASE WHEN pa.id IS NULL THEN r.importe ELSE pa.amount END AS importe
    FROM rec r
    LEFT JOIN ledens.project_allocations pa ON pa.source_type = r.type AND pa.source_id = r.id
   WHERE pa.id IS NOT NULL OR r.project_id IS NOT NULL
)`;

const SORTS = { fecha: 'fecha', importe: 'importe', tercero: 'tercero', concepto: 'concepto', tipo: 'type', estado: 'estado' };

const actorLabel = (actor) => (actor && (actor.name || actor.email)) || 'Sistema';
const PG_UNDEFINED_TABLE = '42P01';

export class FinanzasService {
  constructor(pool) { this.pool = pool; }

  async query(sql, params) {
    try { return await this.pool.query(sql, params); }
    catch (e) {
      if (e.code === PG_UNDEFINED_TABLE) throw new FinError(503, 'La contabilidad todavía no está disponible en esta base de datos');
      throw e;
    }
  }

  async transaction(fn) {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const v = await fn(c); await c.query('COMMIT'); return v; }
    catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      if (e.code === PG_UNDEFINED_TABLE) throw new FinError(503, 'La contabilidad todavía no está disponible en esta base de datos');
      if (e.code === '23514' || e.code === '23503') throw new FinError(422, e.message);
      throw e;
    }
    finally { c.release(); }
  }

  // ---------------------------------------------------------------- projects
  async listProjects({ q = '', limit = 20, ids } = {}) {
    const params = [];
    let where = 'TRUE';
    if (ids?.length) { params.push(ids); where = `pr.id = ANY($${params.length}::uuid[])`; }
    else if (q.trim()) {
      params.push(`%${q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      const p = `$${params.length}`;
      where = `(pr.name ILIKE ${p} OR pr.project_id ILIKE ${p} OR pr.address ILIKE ${p} OR pr.municipio ILIKE ${p} OR c.display_name ILIKE ${p} OR pr.customer_name_source ILIKE ${p})`;
    }
    params.push(Math.min(Math.max(Number(limit) || 20, 1), 100));
    const { rows } = await this.query(`
      SELECT pr.id, ${PROJECT_LABEL} AS label, pr.project_id AS code, pr.address, pr.municipio,
             COALESCE(c.display_name, pr.customer_name_source) AS cliente, ps.name AS estado,
             pr.start_date, pr.end_date
        FROM ledens.projects pr
        LEFT JOIN ledens.customers c ON c.id = pr.customer_id
        LEFT JOIN ledens.project_statuses ps ON ps.id = pr.status_id
       WHERE ${where}
       ORDER BY pr.start_date DESC NULLS LAST, label
       LIMIT $${params.length}`, params);
    return rows;
  }

  async projectExists(c, projectId) {
    if (!isUuid(projectId)) return false;
    const { rows } = await c.query('SELECT 1 FROM ledens.projects WHERE id = $1', [projectId]);
    return rows.length > 0;
  }

  // ----------------------------------------------------------------- records
  // Every column is qualified with `l.` (the listed CTE): inside the EXISTS
  // below, a bare `id` would silently mean project_allocations.id instead.
  buildFilters(f) {
    const params = [];
    const where = [];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    if (f.type) { if (!TYPES[f.type]) throw new FinError(400, 'Tipo no válido'); where.push(`l.type = ${add(f.type)}`); }
    if (f.pending) where.push('l.sin_proyecto');
    if (f.estado) { if (!STATES.includes(f.estado)) throw new FinError(400, 'Estado no válido'); where.push(`l.estado = ${add(f.estado)}`); }
    if (f.project) {
      if (!isUuid(f.project)) throw new FinError(400, 'Proyecto no válido');
      const p = add(f.project);
      where.push(`(l.project_id = ${p} OR EXISTS (SELECT 1 FROM ledens.project_allocations x WHERE x.source_type = l.type AND x.source_id = l.id AND x.project_id = ${p}))`);
    }
    if (f.q && f.q.trim()) {
      const p = add(`%${f.q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      where.push(`(l.tercero ILIKE ${p} OR l.concepto ILIKE ${p} OR l.numerodocumento ILIKE ${p})`);
    }
    const date = (v, name) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FinError(400, `Fecha ${name} no válida`); return v; };
    if (f.from) where.push(`l.fecha >= ${add(date(f.from, 'desde'))}::date`);
    if (f.to) where.push(`l.fecha <= ${add(date(f.to, 'hasta'))}::date`);
    const amount = (v, name) => { if (!/^-?\d+(\.\d+)?$/.test(String(v))) throw new FinError(400, `Importe ${name} no válido`); return String(v); };
    if (f.min !== undefined && f.min !== '') where.push(`l.importe >= ${add(amount(f.min, 'mínimo'))}::numeric`);
    if (f.max !== undefined && f.max !== '') where.push(`l.importe <= ${add(amount(f.max, 'máximo'))}::numeric`);
    return { params, where: where.length ? 'WHERE ' + where.join(' AND ') : '' };
  }

  async listRecords(f = {}) {
    const { params, where } = this.buildFilters(f);
    const sort = SORTS[f.sort] || 'fecha';
    const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
    const pageSize = Math.min(Math.max(Number(f.pageSize) || 25, 1), 100);
    const page = Math.max(Number(f.page) || 1, 1);
    const base = `WITH ${RECORDS_CTE}, listed AS (
      SELECT fr.*, d.numerodocumento, d.tipo AS doc_tipo, ${PROJECT_LABEL} AS project_label
        FROM full_rec fr
        LEFT JOIN ledens.documents d ON d.id = fr.document_id
        LEFT JOIN ledens.projects pr ON pr.id = fr.project_id)`;
    const [{ rows }, { rows: [tot] }] = await Promise.all([
      this.query(`${base}
        SELECT l.type, l.id, l.fecha, l.importe, l.tercero, l.concepto, l.quantity, l.unidad, l.unit_price,
               l.project_id, l.project_label, l.document_id, l.bank_movement_id, l.numerodocumento, l.doc_tipo, l.estado,
               l.parts, l.allocated, l.needs_review, l.suggested_project_id, l.suggestion_reason
          FROM listed l ${where}
         ORDER BY l.${sort} ${dir} NULLS LAST, l.id
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
      this.query(`${base} SELECT count(*)::int AS n, COALESCE(sum(l.importe), 0) AS importe FROM listed l ${where}`, params),
    ]);
    await this.attachSuggestions(rows);
    return { rows, total: tot.n, totalImporte: tot.importe, page, pageSize };
  }

  // Suggestion = the project this supplier/worker/client was most often
  // assigned to before. Shown as a hint, never written as an assignment.
  async attachSuggestions(rows) {
    const need = rows.filter((r) => !r.project_id && !r.parts && (r.tercero || r.suggested_project_id));
    if (!need.length) return;
    const names = [...new Set(need.filter((r) => r.tercero).map((r) => r.tercero.toLowerCase()))];
    const { rows: hist } = !names.length ? { rows: [] } : await this.query(`WITH ${RECORDS_CTE}
      SELECT DISTINCT ON (r.type, lower(r.tercero)) r.type, lower(r.tercero) AS t, r.project_id, count(*)::int AS n,
             ${PROJECT_LABEL} AS label
        FROM rec r JOIN ledens.projects pr ON pr.id = r.project_id
       WHERE lower(r.tercero) = ANY($1::text[])
       GROUP BY r.type, lower(r.tercero), r.project_id, pr.id
       ORDER BY r.type, lower(r.tercero), count(*) DESC`, [names]);
    const byKey = new Map(hist.map((h) => [h.type + '|' + h.t, h]));
    const explicit = need.filter((r) => r.suggested_project_id).map((r) => r.suggested_project_id);
    const labels = explicit.length ? new Map((await this.listProjects({ ids: explicit, limit: 100 })).map((p) => [p.id, p.label])) : new Map();
    for (const r of need) {
      if (r.suggested_project_id && labels.has(r.suggested_project_id)) {
        r.suggestion = { projectId: r.suggested_project_id, label: labels.get(r.suggested_project_id), reason: r.suggestion_reason || 'Sugerencia automática' };
      } else if (r.tercero) {
        const h = byKey.get(r.type + '|' + r.tercero.toLowerCase());
        if (h) r.suggestion = { projectId: h.project_id, label: h.label, reason: `${h.n} ${h.n === 1 ? 'registro anterior' : 'registros anteriores'} de ${r.tercero}` };
      }
    }
  }

  async pendingSummary() {
    const { rows } = await this.query(`WITH ${RECORDS_CTE}
      SELECT type, count(*) FILTER (WHERE sin_proyecto)::int AS pendientes,
             COALESCE(sum(CASE WHEN parts > 0 THEN importe - allocated ELSE importe END) FILTER (WHERE sin_proyecto), 0) AS importe_pendiente,
             count(*) FILTER (WHERE needs_review)::int AS revision,
             count(*)::int AS total
        FROM full_rec GROUP BY type`);
    const by = Object.fromEntries(Object.keys(TYPES).map((t) => [t, { pendientes: 0, importe_pendiente: '0', revision: 0, total: 0 }]));
    for (const r of rows) by[r.type] = r;
    const sum = (k) => Object.values(by).reduce((a, r) => a + Number(r[k]), 0);
    return { porTipo: by, pendientes: sum('pendientes'), revision: sum('revision'), total: sum('total'),
      // Absolute values: a client payment and a cost are both "money waiting for a project".
      importePendiente: rows.reduce((a, r) => a + Math.abs(Number(r.importe_pendiente)), 0).toFixed(2) };
  }

  async getRecord(type, id) {
    if (!TYPES[type]) throw new FinError(400, 'Tipo no válido');
    if (!isUuid(id)) throw new FinError(404, 'Registro no encontrado');
    const { rows: [r] } = await this.query(`WITH ${RECORDS_CTE}
      SELECT fr.*, ${PROJECT_LABEL} AS project_label FROM full_rec fr LEFT JOIN ledens.projects pr ON pr.id = fr.project_id
       WHERE fr.type = $1 AND fr.id = $2`, [type, id]);
    if (!r) throw new FinError(404, 'Registro no encontrado');
    const [doc, bank, parts, history] = await Promise.all([
      r.document_id ? this.query(`SELECT d.id, d.numerodocumento, d.tipo, d.tipodocumento, d.document_on, d.tercero, d.niftercero,
          d.descripcion, d.base_amount, d.vat_amount, d.withholding_amount, d.total, d.review_state, d.estadopagocobro,
          d.enlacearchivo, d.trimestre, vb.paid, vb.balance, vb.quality
          FROM ledens.documents d LEFT JOIN ledens.v_document_balances vb ON vb.id = d.id WHERE d.id = $1`, [r.document_id]).then((x) => x.rows[0]) : null,
      r.bank_movement_id ? this.query(`SELECT b.id, b.source_id, b.completed_on, b.description, b.reference, b.payer,
          b.beneficiary_name, b.amount, b.total_amount, b.currency, b.state, b.type, ba.name AS bank_account,
          vb.confirmed_allocated, vb.difference, vb.document_links
          FROM ledens.bank_movements b LEFT JOIN ledens.bank_accounts ba ON ba.id = b.bank_account_id
          LEFT JOIN ledens.v_bank_balances vb ON vb.id = b.id WHERE b.id = $1`, [r.bank_movement_id]).then((x) => x.rows[0]) : null,
      this.query(`SELECT pa.project_id, pa.amount, pa.pct, pa.origin, pa.assigned_at, ${PROJECT_LABEL} AS label
          FROM ledens.project_allocations pa JOIN ledens.projects pr ON pr.id = pa.project_id
         WHERE pa.source_type = $1 AND pa.source_id = $2 ORDER BY pa.amount DESC`, [type, id]).then((x) => x.rows),
      this.history(type, id),
    ]);
    if (doc) doc.archivo = safeDocumentUrl(doc.enlacearchivo);
    if (doc) delete doc.enlacearchivo;
    await this.attachSuggestions([r]);
    return { ...r, typeLabel: TYPES[type].label, documento: doc, movimiento: bank, distribucion: parts, historial: history };
  }

  async history(type, id) {
    const { rows } = await this.query(`
      SELECT a.id, a.at, a.actor_label, a.origin, a.action, a.reason, a.old_allocations, a.new_allocations,
             (SELECT ${PROJECT_LABEL} FROM ledens.projects pr WHERE pr.id = a.old_project_id) AS old_label,
             (SELECT ${PROJECT_LABEL} FROM ledens.projects pr WHERE pr.id = a.new_project_id) AS new_label
        FROM ledens.imputation_audit a WHERE a.source_type = $1 AND a.source_id = $2 ORDER BY a.at DESC, a.id DESC LIMIT 50`, [type, id]);
    return rows;
  }

  async recentActivity(limit = 20) {
    const { rows } = await this.query(`
      SELECT a.id, a.at, a.actor_label, a.origin, a.action, a.reason, a.source_type, a.source_id,
             (SELECT ${PROJECT_LABEL} FROM ledens.projects pr WHERE pr.id = a.old_project_id) AS old_label,
             (SELECT ${PROJECT_LABEL} FROM ledens.projects pr WHERE pr.id = a.new_project_id) AS new_label
        FROM ledens.imputation_audit a ORDER BY a.at DESC, a.id DESC LIMIT $1`, [Math.min(Number(limit) || 20, 100)]);
    return rows;
  }

  // ------------------------------------------------------------- assignment
  // Locks the source row and returns its current imputation.
  async lockRecord(c, type, id) {
    const t = TYPES[type];
    if (!t) throw new FinError(400, 'Tipo no válido');
    if (!isUuid(id)) throw new FinError(404, 'Registro no encontrado');
    const { rows: [row] } = await c.query(`SELECT id, project_id, ${t.amount} AS importe FROM ${t.table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!row) throw new FinError(404, 'Registro no encontrado');
    const { rows: parts } = await c.query(
      'SELECT project_id, amount, pct FROM ledens.project_allocations WHERE source_type = $1 AND source_id = $2 ORDER BY project_id', [type, id]);
    return { ...row, parts };
  }

  async writeAudit(c, { actor, origin, action, type, id, oldProject, newProject, oldParts, newParts, reason }) {
    await c.query(`INSERT INTO ledens.imputation_audit
        (actor_id, actor_label, origin, action, source_type, source_id, old_project_id, new_project_id, old_allocations, new_allocations, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [actor?.id || null, actorLabel(actor), origin, action, type, id, oldProject || null, newProject || null,
      oldParts?.length ? JSON.stringify(oldParts) : null, newParts?.length ? JSON.stringify(newParts) : null, reason || null]);
    // Also in the platform-wide audit trail the admin screen already shows.
    await auditLog({ actor: actor ? { id: actor.id, label: actorLabel(actor) } : { label: 'Sistema (automatización)' },
      action: 'Imputación a proyecto', target: { label: `${TYPES[type].label} ${id}` },
      detail: `${action}${reason ? ' · ' + reason : ''}` }, c);
  }

  /**
   * Assigns one record to one project (or clears it with projectId null).
   * expectedProjectId (optional) guards against overwriting a change someone
   * else made since the screen loaded. A split record is replaced by the single
   * assignment. Changing or removing an existing assignment needs a reason.
   */
  async assignIn(c, { type, id, projectId, expectedProjectId, reason, actor, origin = 'manual' }) {
    if (projectId !== null && !(await this.projectExists(c, projectId))) throw new FinError(400, 'El proyecto no existe');
    const cur = await this.lockRecord(c, type, id);
    if (expectedProjectId !== undefined && (cur.project_id || null) !== (expectedProjectId || null)) {
      throw new FinError(409, 'Otra persona ha cambiado este registro. Recarga para ver su proyecto actual.', { currentProjectId: cur.project_id });
    }
    const wasSplit = cur.parts.length > 0;
    if (!wasSplit && (cur.project_id || null) === (projectId || null)) return { changed: false, previousProjectId: cur.project_id };
    const changing = wasSplit || cur.project_id;
    if (changing && origin === 'manual' && !(reason && reason.trim())) throw new FinError(400, 'Indica el motivo del cambio');
    if (origin === 'automatica' && changing) throw new FinError(409, 'La automatización nunca sobrescribe una imputación existente');
    if (wasSplit) await c.query('DELETE FROM ledens.project_allocations WHERE source_type = $1 AND source_id = $2', [type, id]);
    await c.query(`UPDATE ${TYPES[type].table} SET project_id = $2 WHERE id = $1`, [id, projectId]);
    // A confirmed assignment resolves a pending review.
    if (projectId) await c.query(`UPDATE ledens.imputation_reviews SET needs_review = false, updated_by = $3, updated_at = now()
      WHERE source_type = $1 AND source_id = $2 AND needs_review`, [type, id, actor?.id || null]);
    await this.writeAudit(c, { actor, origin, type, id, reason: reason?.trim(),
      action: !projectId ? 'Desasignar' : wasSplit ? 'Sustituir distribución' : cur.project_id ? 'Reasignar' : 'Asignar',
      oldProject: cur.project_id, newProject: projectId, oldParts: cur.parts });
    return { changed: true, previousProjectId: cur.project_id };
  }

  assign(args) { return this.transaction((c) => this.assignIn(c, args)); }

  /**
   * Bulk assign / mark for review. One transaction, one savepoint per record:
   * a record that fails is rolled back alone and reported, the rest commit.
   */
  async bulk({ items, action, projectId, reason, note, actor }) {
    if (!Array.isArray(items) || !items.length) throw new FinError(400, 'Selecciona al menos un registro');
    if (items.length > 500) throw new FinError(400, 'Máximo 500 registros por operación');
    if (!['assign', 'review'].includes(action)) throw new FinError(400, 'Acción no válida');
    return this.transaction(async (c) => {
      if (action === 'assign' && !(await this.projectExists(c, projectId))) throw new FinError(400, 'El proyecto no existe');
      const results = [];
      for (const [i, it] of items.entries()) {
        await c.query(`SAVEPOINT item_${i}`);
        try {
          const r = action === 'assign'
            ? await this.assignIn(c, { type: it.type, id: it.id, projectId, reason, actor })
            : await this.setReviewIn(c, { type: it.type, id: it.id, needsReview: true, note, actor });
          await c.query(`RELEASE SAVEPOINT item_${i}`);
          results.push({ type: it.type, id: it.id, ok: true, changed: r.changed, previousProjectId: r.previousProjectId ?? null });
        } catch (e) {
          await c.query(`ROLLBACK TO SAVEPOINT item_${i}`);
          if (!(e instanceof FinError) && !['23514', '23503', '22P02'].includes(e.code)) throw e;
          results.push({ type: it.type, id: it.id, ok: false, error: e.message });
        }
      }
      return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    });
  }

  /**
   * Splits one record across projects. Amounts must keep the record's sign and
   * add up to at most its amount (enforced again by the DB trigger). A single
   * part covering the whole amount is just an assignment.
   */
  async distribute({ type, id, parts, reason, actor, origin = 'manual' }) {
    if (!Array.isArray(parts) || !parts.length) throw new FinError(400, 'Indica al menos un proyecto');
    if (parts.length > 20) throw new FinError(400, 'Máximo 20 proyectos por registro');
    const seen = new Set();
    for (const p of parts) {
      if (!isUuid(p.projectId)) throw new FinError(400, 'Proyecto no válido');
      if (seen.has(p.projectId)) throw new FinError(400, 'Un proyecto aparece dos veces');
      seen.add(p.projectId);
      if (!/^-?\d+(\.\d{1,2})?$/.test(String(p.amount)) || Number(p.amount) === 0) throw new FinError(400, 'Importe no válido (usa hasta 2 decimales, distinto de cero)');
    }
    return this.transaction(async (c) => {
      const cur = await this.lockRecord(c, type, id);
      const { rows: [chk] } = await c.query(`SELECT sum(x) AS s, bool_and(sign(x) = sign($2::numeric)) AS same_sign,
          abs(sum(x)) <= abs($2::numeric) AS fits, sum(x) = $2::numeric AS exact
        FROM unnest($1::numeric[]) x`, [parts.map((p) => String(p.amount)), cur.importe]);
      if (!chk.same_sign) throw new FinError(400, 'Todos los importes deben tener el mismo signo que el registro');
      if (!chk.fits) throw new FinError(400, `La suma (${chk.s}) supera el importe del registro (${cur.importe})`);
      if (parts.length === 1 && chk.exact) return this.assignIn(c, { type, id, projectId: parts[0].projectId, reason, actor, origin });
      for (const p of parts) if (!(await this.projectExists(c, p.projectId))) throw new FinError(400, 'Un proyecto no existe');
      if ((cur.parts.length || cur.project_id) && origin === 'manual' && !(reason && reason.trim())) throw new FinError(400, 'Indica el motivo del cambio');
      await c.query('DELETE FROM ledens.project_allocations WHERE source_type = $1 AND source_id = $2', [type, id]);
      await c.query(`UPDATE ${TYPES[type].table} SET project_id = NULL WHERE id = $1`, [id]);
      for (const p of parts) {
        await c.query(`INSERT INTO ledens.project_allocations (source_type, source_id, project_id, amount, pct, origin, assigned_by)
          VALUES ($1, $2, $3, $4::numeric, round(100 * $4::numeric / NULLIF($5::numeric, 0), 4), $6, $7)`,
        [type, id, p.projectId, String(p.amount), cur.importe, origin, actor?.id || null]);
      }
      await c.query(`UPDATE ledens.imputation_reviews SET needs_review = false, updated_by = $3, updated_at = now()
        WHERE source_type = $1 AND source_id = $2 AND needs_review`, [type, id, actor?.id || null]);
      // Run the deferred invariant now, so a violation is reported as this request's error.
      await c.query('SET CONSTRAINTS ledens.project_allocations_invariant IMMEDIATE');
      await this.writeAudit(c, { actor, origin, type, id, reason: reason?.trim(), action: 'Distribuir entre proyectos',
        oldProject: cur.project_id, oldParts: cur.parts, newParts: parts.map((p) => ({ project_id: p.projectId, amount: String(p.amount) })) });
      return { changed: true, previousProjectId: cur.project_id, exact: chk.exact };
    });
  }

  async setReviewIn(c, { type, id, needsReview, note, actor }) {
    await this.lockRecord(c, type, id);
    const { rows: [prev] } = await c.query('SELECT needs_review FROM ledens.imputation_reviews WHERE source_type = $1 AND source_id = $2', [type, id]);
    if ((prev?.needs_review || false) === needsReview) return { changed: false };
    await c.query(`INSERT INTO ledens.imputation_reviews (source_type, source_id, needs_review, review_note, updated_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (source_type, source_id) DO UPDATE SET needs_review = EXCLUDED.needs_review,
        review_note = EXCLUDED.review_note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [type, id, needsReview, note?.trim() || null, actor?.id || null]);
    await this.writeAudit(c, { actor, origin: 'manual', type, id, reason: note?.trim(),
      action: needsReview ? 'Marcar para revisión' : 'Revisión resuelta' });
    return { changed: true };
  }

  setReview(args) {
    if (typeof args.needsReview !== 'boolean') throw new FinError(400, 'Indica si necesita revisión');
    return this.transaction((c) => this.setReviewIn(c, args));
  }

  /**
   * Entry point for the invoice automation (OneDrive → extracción → conciliación).
   * Only evidence-backed assignments are applied, and only to records with no
   * project yet; anything else becomes a suggestion for a person to confirm.
   */
  async automaticImputation({ type, id, projectId, evidence }) {
    if (!evidence || !String(evidence).trim()) {
      return this.transaction(async (c) => {
        await this.lockRecord(c, type, id);
        if (!(await this.projectExists(c, projectId))) throw new FinError(400, 'El proyecto no existe');
        await c.query(`INSERT INTO ledens.imputation_reviews (source_type, source_id, suggested_project_id, suggestion_reason)
          VALUES ($1, $2, $3, 'Sugerencia de la automatización')
          ON CONFLICT (source_type, source_id) DO UPDATE SET suggested_project_id = EXCLUDED.suggested_project_id,
            suggestion_reason = EXCLUDED.suggestion_reason, updated_at = now()`, [type, id, projectId]);
        return { applied: false, suggested: true };
      });
    }
    const r = await this.assign({ type, id, projectId, reason: `Evidencia: ${String(evidence).trim().slice(0, 300)}`, actor: null, origin: 'automatica' });
    return { applied: r.changed, suggested: false };
  }

  // ----------------------------------------------------------- rentabilidad
  async profitability(projectId) {
    if (!isUuid(projectId)) throw new FinError(404, 'Proyecto no encontrado');
    const [project] = await this.listProjects({ ids: [projectId] });
    if (!project) throw new FinError(404, 'Proyecto no encontrado');
    const [totals, byCategory, monthly, budget, pending] = await Promise.all([
      this.query(`WITH ${IMPUTED_CTE}
        SELECT type, COALESCE(sum(importe), 0) AS importe, count(DISTINCT id)::int AS registros
          FROM imputed WHERE project_id = $1 GROUP BY type`, [projectId]).then((x) => x.rows),
      this.query(`WITH ${IMPUTED_CTE}
        SELECT type, categoria, COALESCE(sum(importe), 0) AS importe
          FROM imputed WHERE project_id = $1 AND type <> 'cliente' GROUP BY type, categoria ORDER BY sum(importe) DESC`, [projectId]).then((x) => x.rows),
      this.query(`WITH ${IMPUTED_CTE}
        SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, type, COALESCE(sum(importe), 0) AS importe
          FROM imputed WHERE project_id = $1 AND fecha IS NOT NULL GROUP BY 1, 2 ORDER BY 1`, [projectId]).then((x) => x.rows),
      // Budget = lines of the latest accepted version of each budget; legacy lines
      // imported without a version count as they are.
      this.query(`WITH accepted AS (
          SELECT DISTINCT ON (v.budget_id) v.id, v.budget_id FROM ledens.budget_versions v
            JOIN ledens.budgets b ON b.id = v.budget_id
           WHERE b.project_id = $1 AND v.state = 'accepted' ORDER BY v.budget_id, v.version_number DESC)
        SELECT COALESCE(sum(l.total), 0) AS total, count(*)::int AS lineas,
               (SELECT count(*)::int FROM accepted) AS versiones,
               COALESCE(json_agg(json_build_object('categoria', COALESCE(NULLIF(btrim(l.categoria), ''), 'Sin categoría'), 'total', l.total)) FILTER (WHERE l.id IS NOT NULL), '[]') AS lineas_cat
          FROM ledens.budget_lines l
         WHERE l.project_id = $1 AND (l.version_id IS NULL OR l.version_id IN (SELECT id FROM accepted))`, [projectId]).then((x) => x.rows[0]),
      this.query(`WITH ${RECORDS_CTE} SELECT count(*)::int AS n FROM full_rec f WHERE f.estado = 'parcial'
          AND EXISTS (SELECT 1 FROM ledens.project_allocations x WHERE x.source_type = f.type AND x.source_id = f.id AND x.project_id = $1)`, [projectId]).then((x) => x.rows[0]),
    ]);
    const t = Object.fromEntries(Object.keys(TYPES).map((k) => [k, { importe: '0', registros: 0 }]));
    for (const r of totals) t[r.type] = r;
    const materiales = Number(t.material.importe), trabajadores = Number(t.trabajador.importe), cobros = Number(t.cliente.importe);
    const coste = materiales + trabajadores, presupuesto = Number(budget.total);
    const budgetByCat = new Map();
    for (const l of budget.lineas_cat) budgetByCat.set(l.categoria, (budgetByCat.get(l.categoria) || 0) + Number(l.total));
    const costByCat = new Map();
    for (const r of byCategory) costByCat.set(r.categoria, (costByCat.get(r.categoria) || 0) + Number(r.importe));
    const cats = [...new Set([...budgetByCat.keys(), ...costByCat.keys()])];
    return {
      project,
      kpis: {
        presupuesto: budget.lineas ? presupuesto.toFixed(2) : null,
        cobros: cobros.toFixed(2),
        materiales: materiales.toFixed(2),
        trabajadores: trabajadores.toFixed(2),
        costeTotal: coste.toFixed(2),
        // Against the budget, not against recognised revenue (which has no source yet).
        margenPrevisto: budget.lineas ? (presupuesto - coste).toFixed(2) : null,
        margenPrevistoPct: budget.lineas && presupuesto ? (((presupuesto - coste) / presupuesto) * 100).toFixed(1) : null,
        consumoPresupuestoPct: budget.lineas && presupuesto ? ((coste / presupuesto) * 100).toFixed(1) : null,
        registros: { material: t.material.registros, trabajador: t.trabajador.registros, cliente: t.cliente.registros },
        distribucionesParciales: pending.n,
      },
      noDisponibles: [
        { kpi: 'Ingresos reconocidos', motivo: 'No hay facturación de venta ni certificaciones vinculadas a proyectos en la base de datos. Los cobros no se usan como sustituto.' },
        { kpi: 'Margen de contribución', motivo: 'Necesita ingresos reconocidos. Se muestra en su lugar el margen previsto sobre presupuesto.' },
        { kpi: 'Saldo pendiente de cobro', motivo: 'Necesita lo facturado al cliente por proyecto, que todavía no existe.' },
        { kpi: 'Otros costes directos', motivo: 'Solo materiales y pagos a trabajadores tienen proyecto; los movimientos de efectivo y costes fijos no están vinculados a proyectos.' },
      ],
      presupuesto: { lineas: budget.lineas, versionesAceptadas: budget.versiones },
      costesPorCategoria: byCategory,
      presupuestoVsCoste: cats.map((c) => ({ categoria: c, presupuesto: (budgetByCat.get(c) || 0).toFixed(2), coste: (costByCat.get(c) || 0).toFixed(2) }))
        .sort((a, b) => Number(b.presupuesto) + Number(b.coste) - Number(a.presupuesto) - Number(a.coste)),
      evolucion: monthly,
    };
  }

  // ------------------------------------------------------------ conciliación
  async reconciliation({ view = 'movimientos', page = 1, pageSize = 25, q = '' } = {}) {
    const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100), off = (Math.max(Number(page) || 1, 1) - 1) * size;
    const like = q.trim() ? `%${q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%` : null;
    if (view === 'documentos') {
      const { rows } = await this.query(`
        SELECT d.id, d.document_on, d.numerodocumento, d.tercero, d.descripcion, d.total, vb.paid, vb.balance, vb.quality, vb.method,
               count(*) OVER()::int AS total_rows
          FROM ledens.v_document_balances vb JOIN ledens.documents d ON d.id = vb.id
         WHERE vb.quality <> 'OK' AND ($1::text IS NULL OR d.tercero ILIKE $1 OR d.numerodocumento ILIKE $1 OR d.descripcion ILIKE $1)
         ORDER BY d.document_on DESC NULLS LAST, d.id LIMIT ${size} OFFSET ${off}`, [like]);
      return { rows, total: rows[0]?.total_rows || 0 };
    }
    const { rows } = await this.query(`
      SELECT b.id, b.source_id, b.completed_on, b.description, b.beneficiary_name, b.payer, b.total_amount, b.currency,
             ba.name AS bank_account, vb.confirmed_allocated, vb.difference, vb.document_links, count(*) OVER()::int AS total_rows
        FROM ledens.v_bank_balances vb JOIN ledens.bank_movements b ON b.id = vb.id
        LEFT JOIN ledens.bank_accounts ba ON ba.id = b.bank_account_id
       WHERE vb.difference <> 0 AND NOT COALESCE(b.is_internal_transfer, false)
         AND ($1::text IS NULL OR b.description ILIKE $1 OR b.beneficiary_name ILIKE $1 OR b.payer ILIKE $1 OR b.source_id ILIKE $1)
       ORDER BY b.completed_on DESC NULLS LAST, b.id LIMIT ${size} OFFSET ${off}`, [like]);
    return { rows, total: rows[0]?.total_rows || 0 };
  }
}

// documents.enlacearchivo holds the SharePoint location of the original. It is
// only handed to signed-in staff, and only if it really is an https SharePoint
// link (opening it still requires the person's own SharePoint login).
export function safeDocumentUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && /(^|\.)sharepoint\.com$/i.test(u.hostname) ? u.href : null;
  } catch { return null; }
}
