import { fail, uuid, text, day, int, isUuid, today } from './util.js';

// Solicitudes de herramientas, disponibilidad y reservas. Mixed into
// HerramientasService (service.js). A request is only an ask:
//   approving it reserves concrete units for its dates (conflicts refused under
//   each asset's row lock), dispatching it creates the movements, receiving
//   them delivers it, and returning every unit finishes it.
// Transitions are a closed table: nothing jumps from «solicitada» to «entregada».
export const REQUEST_TRANSITIONS = {
  borrador: ['solicitada', 'cancelada'],
  solicitada: ['en_revision', 'aprobada', 'parcialmente_aprobada', 'rechazada', 'cancelada'],
  en_revision: ['aprobada', 'parcialmente_aprobada', 'rechazada', 'cancelada'],
  aprobada: ['en_preparacion', 'en_traslado', 'cancelada'],
  parcialmente_aprobada: ['en_preparacion', 'en_traslado', 'cancelada'],
  en_preparacion: ['en_traslado', 'cancelada'],
  en_traslado: ['entregada', 'en_preparacion'],
  entregada: ['finalizada'],
  rechazada: [],
  finalizada: [],
  cancelada: [],
};
export const canTransition = (from, to) => (REQUEST_TRANSITIONS[from] || []).includes(to);
const ref = (n) => `SOL-${String(n).padStart(6, '0')}`;

// Units of a type free for [from, to]: operativa, not retired, no movement on
// its way, no active reservation overlapping, and either unassigned, assigned to
// that same project, or due back before `from`.
const CANDIDATES = `SELECT a.id, a.code, a.name, a.location_id, l.name loc_name, l.kind loc_kind, l.project_id loc_project
  FROM inventory.assets a JOIN inventory.locations l ON l.id=a.location_id
  LEFT JOIN inventory.asset_assignments aa ON aa.asset_id=a.id AND aa.ended_at IS NULL
  WHERE a.type_id=$1 AND a.retired_at IS NULL AND a.condition='operativa'
    AND NOT EXISTS (SELECT 1 FROM inventory.asset_movements pm WHERE pm.asset_id=a.id AND pm.status='pendiente' AND pm.project_id IS DISTINCT FROM $4::uuid)
    AND NOT EXISTS (SELECT 1 FROM inventory.reservations r WHERE r.asset_id=a.id AND r.status='activa' AND r.starts_on<=$3::date AND r.ends_on>=$2::date AND r.request_id IS DISTINCT FROM $5::uuid)
    AND (aa.id IS NULL OR aa.project_id=$4::uuid OR (aa.expected_return_on IS NOT NULL AND aa.expected_return_on<$2::date))`;

export const requestMethods = {
  // Why one unit cannot be reserved for [from, to] (null when it can). Run under its lock.
  async conflictOf(db, assetId, { typeId, from, to, projectId, requestId }) {
    const a = (await db.query(`SELECT a.code, a.type_id, a.retired_at, a.condition, aa.project_id asg_project, aa.expected_return_on::text asg_return,
        (SELECT pm.project_id FROM inventory.asset_movements pm WHERE pm.asset_id=a.id AND pm.status='pendiente') pm_project,
        EXISTS (SELECT 1 FROM inventory.asset_movements pm WHERE pm.asset_id=a.id AND pm.status='pendiente') pm
      FROM inventory.assets a LEFT JOIN inventory.asset_assignments aa ON aa.asset_id=a.id AND aa.ended_at IS NULL WHERE a.id=$1`, [assetId])).rows[0];
    if (!a) return 'no existe';
    if (typeId && a.type_id !== typeId) return `${a.code} no es del tipo pedido`;
    if (a.retired_at) return `${a.code} está de baja`;
    if (a.condition !== 'operativa') return `${a.code} está ${a.condition.replace('_', ' ')}`;
    if (a.pm && a.pm_project !== projectId) return `${a.code} está en traslado a otro sitio`;
    const r = (await db.query(`SELECT starts_on::text, ends_on::text FROM inventory.reservations WHERE asset_id=$1 AND status='activa' AND starts_on<=$3 AND ends_on>=$2
      AND request_id IS DISTINCT FROM $4::uuid LIMIT 1`, [assetId, from, to, requestId || null])).rows[0];
    if (r) return `${a.code} ya está reservada del ${r.starts_on} al ${r.ends_on}`;
    if (a.asg_project && a.asg_project !== projectId && !(a.asg_return && a.asg_return < from)) return `${a.code} está asignada a otra obra${a.asg_return ? ` hasta el ${a.asg_return}` : ' sin fecha de devolución'}`;
    return null;
  },

  // GET /disponibilidad?tipo&desde&hasta[&proyecto] — before sending a request.
  // A jefe sees how many are free and where only by kind outside their obras.
  async availability(q = {}) {
    this.need('tools.read');
    const db = this.pool;
    const typeId = uuid(q.tipo, 'Tipo');
    const from = day(q.desde, 'Fecha de necesidad', { required: true });
    const to = day(q.hasta, 'Fecha de devolución', { required: true });
    if (to < from) fail(400, 'La devolución no puede ser anterior a la necesidad');
    const projectId = uuid(q.proyecto, 'Proyecto', { required: false });
    const type = (await db.query('SELECT id, name, tracking FROM inventory.tool_types WHERE id=$1', [typeId])).rows[0];
    if (!type) fail(404, 'Tipo no encontrado');
    const total = (await db.query("SELECT count(*)::int n FROM inventory.assets WHERE type_id=$1 AND retired_at IS NULL", [typeId])).rows[0].n;
    const rows = (await db.query(`${CANDIDATES} ORDER BY (l.project_id IS NOT DISTINCT FROM $4::uuid) DESC, l.kind<>'almacen', a.code LIMIT 200`, [typeId, from, to, projectId, null])).rows;
    const mine = await this.myProjects(db);
    const visible = (pid) => mine === null || (pid && mine.has(pid));
    return {
      type: { id: type.id, name: type.name }, from, to, total, available: rows.length,
      candidates: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, location: r.loc_kind === 'obra' && !visible(r.loc_project) ? { kind: 'obra', name: 'Otra obra' } : { id: r.location_id, kind: r.loc_kind, name: r.loc_name } })),
    };
  },

  parseItems(items) {
    if (!Array.isArray(items) || !items.length || items.length > 30) fail(400, 'Añade entre 1 y 30 herramientas a la solicitud');
    return items.map((i, n) => ({
      typeId: uuid(i?.typeId, `Tipo de la línea ${n + 1}`),
      assetId: uuid(i?.assetId, `Herramienta de la línea ${n + 1}`, { required: false }),
      quantity: int(i?.quantity ?? 1, `Cantidad de la línea ${n + 1}`, { min: 1, max: 100 }),
      notes: text(i?.notes, 'Observaciones', { max: 300 }),
    }));
  },

  // POST /solicitudes — by a jefe for one of their projects (an admin, any).
  // `draft: true` keeps it as borrador. Idempotency-Key avoids a double submit.
  async createRequest(body = {}, key) {
    this.need('tools.request', 'No tienes permiso para solicitar herramientas');
    const projectId = uuid(body.projectId, 'Obra');
    const obraId = uuid(body.obraId, 'Obra concreta', { required: false });
    const neededFrom = day(body.neededFrom, 'Fecha de necesidad', { required: true });
    const returnBy = day(body.returnBy, 'Fecha prevista de devolución', { required: true });
    if (returnBy < neededFrom) fail(400, 'La devolución no puede ser anterior a la fecha de necesidad');
    if (neededFrom < today() && !this.isAdmin) fail(400, 'La fecha de necesidad ya ha pasado');
    const notes = text(body.notes, 'Observaciones', { max: 1000 });
    const items = this.parseItems(body.items);
    return this.once(key, 'solicitud', async (db) => {
      if (!(await this.isMine(db, projectId))) fail(403, 'Solo puedes pedir herramientas para tus obras');
      if (!(await this.projects([projectId], db)).get(projectId) || (await this.projects([projectId], db)).get(projectId).missing) fail(404, 'Proyecto no encontrado');
      if (obraId && !(await db.query('SELECT 1 FROM presupuestos WHERE id=$1 AND parent_id IS NULL AND project_id=$2', [obraId, projectId])).rows.length) fail(400, 'Esa obra no pertenece al proyecto');
      for (const i of items) {
        const t = (await db.query('SELECT tracking FROM inventory.tool_types WHERE id=$1 AND active', [i.typeId])).rows[0];
        if (!t) fail(400, 'Tipo de herramienta no encontrado');
        if (t.tracking === 'consumible') fail(400, 'Los consumibles no se reservan: pídelos a almacén');
        if (i.assetId && !(await db.query('SELECT 1 FROM inventory.assets WHERE id=$1 AND type_id=$2 AND retired_at IS NULL', [i.assetId, i.typeId])).rows.length) fail(400, 'La herramienta elegida no es de ese tipo');
        if (i.assetId && i.quantity !== 1) fail(400, 'Una herramienta concreta se pide de una en una');
      }
      const status = body.draft === true ? 'borrador' : 'solicitada';
      const r = (await db.query(`INSERT INTO inventory.tool_requests (project_id, obra_id, requested_by, status, needed_from, return_by, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ref`, [projectId, obraId, this.user.id, status, neededFrom, returnBy, notes])).rows[0];
      for (const [n, i] of items.entries()) {
        await db.query('INSERT INTO inventory.tool_request_items (request_id, type_id, asset_id, quantity, notes, position) VALUES ($1,$2,$3,$4,$5,$6)', [r.id, i.typeId, i.assetId, i.quantity, i.notes, n]);
      }
      await this.audit(db, status === 'borrador' ? 'Borrador de solicitud de herramientas' : 'Solicitud de herramientas enviada', `${ref(r.ref)} · ${items.reduce((s, i) => s + i.quantity, 0)} uds · ${neededFrom} → ${returnBy}`);
      return this.getRequest(r.id, db);
    });
  },

  async loadRequest(db, id, { lock = false } = {}) {
    if (!isUuid(id)) fail(404, 'Solicitud no encontrada');
    const r = (await db.query(`SELECT *, needed_from::text needed_from, return_by::text return_by FROM inventory.tool_requests WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
    if (!r) fail(404, 'Solicitud no encontrada');
    if (!this.can('tools.requests.approve') && r.requested_by !== this.user.id && !(await this.isMine(db, r.project_id))) fail(404, 'Solicitud no encontrada');
    return r;
  },

  async getRequest(id, db = this.pool) {
    this.need('tools.read');
    const r = await this.loadRequest(db, id);
    const items = (await db.query(`SELECT i.*, t.name type_name, t.category, a.code asset_code, a.name asset_name FROM inventory.tool_request_items i
      JOIN inventory.tool_types t ON t.id=i.type_id LEFT JOIN inventory.assets a ON a.id=i.asset_id WHERE i.request_id=$1 ORDER BY i.position`, [r.id])).rows;
    const reservations = (await db.query(`SELECT r.id, r.request_item_id, r.status, r.starts_on::text, r.ends_on::text, a.id asset_id, a.code, a.name FROM inventory.reservations r
      JOIN inventory.assets a ON a.id=r.asset_id WHERE r.request_id=$1 ORDER BY a.code`, [r.id])).rows;
    const movements = (await db.query(`SELECT m.id, m.status, m.sent_at, m.resolved_at, a.code, a.name FROM inventory.asset_movements m JOIN inventory.assets a ON a.id=m.asset_id
      WHERE m.request_id=$1 ORDER BY m.sent_at`, [r.id])).rows;
    const users = (await db.query('SELECT id, name, email FROM users WHERE id=ANY($1::uuid[])', [[r.requested_by, r.decided_by].filter(Boolean)])).rows;
    const uname = (uid) => { const u = users.find((x) => x.id === uid); return u ? u.name || u.email : null; };
    const p = (await this.projects([r.project_id], db)).get(r.project_id);
    const approver = this.can('tools.requests.approve');
    const open = ['solicitada', 'en_revision'].includes(r.status);
    // For whoever decides: the free units per line, so approving is one tap.
    const suggestions = approver && open ? await Promise.all(items.map(async (i) => {
      const c = (await db.query(`${CANDIDATES} ORDER BY (a.id=$6::uuid) DESC, (l.project_id IS NOT DISTINCT FROM $4::uuid) DESC, l.kind<>'almacen', a.code LIMIT 50`,
        [i.type_id, r.needed_from, r.return_by, r.project_id, r.id, i.asset_id])).rows;
      return { itemId: i.id, available: c.length, candidates: c.map((x) => ({ id: x.id, code: x.code, name: x.name, location: x.loc_name })) };
    })) : null;
    return {
      solicitud: {
        id: r.id, ref: ref(r.ref), status: r.status, project: { id: r.project_id, code: p?.code || null, name: p?.name || 'Proyecto' }, obraId: r.obra_id,
        requestedBy: { id: r.requested_by, name: uname(r.requested_by) }, neededFrom: r.needed_from, returnBy: r.return_by, notes: r.notes,
        decidedBy: r.decided_by ? { id: r.decided_by, name: uname(r.decided_by) } : null, decidedAt: r.decided_at, decisionReason: r.decision_reason,
        createdAt: r.created_at, updatedAt: r.updated_at,
        items: items.map((i) => ({ id: i.id, type: { id: i.type_id, name: i.type_name, category: i.category }, asset: i.asset_id ? { id: i.asset_id, code: i.asset_code, name: i.asset_name } : null, quantity: i.quantity, quantityApproved: i.quantity_approved, notes: i.notes })),
        reservations: reservations.map((x) => ({ id: x.id, itemId: x.request_item_id, status: x.status, startsOn: x.starts_on, endsOn: x.ends_on, asset: { id: x.asset_id, code: x.code, name: x.name } })),
        movements: movements.map((m) => ({ id: m.id, status: m.status, sentAt: m.sent_at, resolvedAt: m.resolved_at, code: m.code, name: m.name })),
      },
      suggestions,
      actions: {
        submit: r.status === 'borrador' && r.requested_by === this.user.id,
        review: approver && r.status === 'solicitada',
        decide: approver && open,
        prepare: approver && ['aprobada', 'parcialmente_aprobada'].includes(r.status),
        dispatch: approver && ['aprobada', 'parcialmente_aprobada', 'en_preparacion'].includes(r.status),
        finish: (approver || r.requested_by === this.user.id) && r.status === 'entregada',
        cancel: (r.requested_by === this.user.id && ['borrador', 'solicitada', 'en_revision'].includes(r.status)) || (approver && canTransition(r.status, 'cancelada')),
      },
    };
  },

  // GET /solicitudes?estado&proyecto&mias — a jefe: their own and those of their obras; an approver: all.
  async listRequests(q = {}) {
    this.need('tools.read');
    const db = this.pool;
    const mine = await this.mineArray(db);
    const args = [this.user.id, mine];
    const where = ['($2::uuid[] IS NULL OR r.requested_by=$1 OR r.project_id=ANY($2::uuid[]))'];
    if (q.mias === '1') where.push('r.requested_by=$1');
    if (q.estado === 'pendientes') where.push("r.status IN ('solicitada','en_revision')");
    else if (q.estado === 'abiertas') where.push("r.status NOT IN ('rechazada','finalizada','cancelada')");
    else if (q.estado) { if (!REQUEST_TRANSITIONS[q.estado]) fail(400, 'Estado no válido'); args.push(q.estado); where.push(`r.status=$${args.length}`); }
    if (q.proyecto) { args.push(uuid(q.proyecto, 'Proyecto')); where.push(`r.project_id=$${args.length}`); }
    const rows = (await db.query(`SELECT r.*, r.needed_from::text needed_from, r.return_by::text return_by, u.name requester, (SELECT sum(quantity)::int FROM inventory.tool_request_items i WHERE i.request_id=r.id) units,
        (SELECT string_agg(t.name, ', ' ORDER BY i.position) FROM inventory.tool_request_items i JOIN inventory.tool_types t ON t.id=i.type_id WHERE i.request_id=r.id) summary
      FROM inventory.tool_requests r JOIN users u ON u.id=r.requested_by WHERE ${where.join(' AND ')}
      ORDER BY (r.status IN ('solicitada','en_revision')) DESC, r.needed_from, r.created_at DESC LIMIT 200`, args)).rows;
    const projects = await this.projects(rows.map((r) => r.project_id), db);
    return {
      solicitudes: rows.map((r) => {
        const p = projects.get(r.project_id);
        return { id: r.id, ref: ref(r.ref), status: r.status, project: { id: r.project_id, code: p?.code || null, name: p?.name || 'Proyecto' }, requester: r.requester, mine: r.requested_by === this.user.id,
          neededFrom: r.needed_from, returnBy: r.return_by, units: r.units, summary: r.summary, createdAt: r.created_at };
      }),
    };
  },

  async transition(db, r, to, { reason = null, decided = false } = {}) {
    if (!canTransition(r.status, to)) fail(409, `Una solicitud ${r.status.replace('_', ' ')} no puede pasar a ${to.replace('_', ' ')}`);
    await db.query(`UPDATE inventory.tool_requests SET status=$2, updated_at=now()${decided ? ', decided_by=$3, decided_at=now(), decision_reason=$4' : ''} WHERE id=$1`,
      decided ? [r.id, to, this.user.id, reason] : [r.id, to]);
    await this.audit(db, 'Solicitud de herramientas: ' + to.replace('_', ' '), `${ref(r.ref)}${reason ? ` · ${reason}` : ''}`);
  },

  async submitRequest(id) {
    return this.tx(async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      if (r.requested_by !== this.user.id) fail(403, 'Solo quien la preparó envía la solicitud');
      if (r.needed_from < today() && !this.isAdmin) fail(400, 'La fecha de necesidad ya ha pasado: corrígela');
      await this.transition(db, r, 'solicitada');
      return this.getRequest(r.id, db);
    });
  },
  async reviewRequest(id) {
    this.need('tools.requests.approve', 'Solo administración revisa solicitudes');
    return this.tx(async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      await this.transition(db, r, 'en_revision');
      return this.getRequest(r.id, db);
    });
  },

  // POST /solicitudes/:id/aprobar { items: [{ itemId, assetIds: [...] }], reason }
  // Approving reserves exactly the units chosen, for the request's dates. The
  // number of units of a line is its approved quantity (0 leaves it out); less
  // than asked is a partial approval and needs a reason. Every unit is checked
  // under its own lock, in a fixed order, so two approvals racing for the same
  // drill never both win.
  async approveRequest(id, body = {}, key) {
    this.need('tools.requests.approve', 'Solo administración aprueba solicitudes');
    const reason = text(body.reason, 'Motivo', { max: 1000 });
    if (!Array.isArray(body.items)) fail(400, 'Indica qué herramientas se reservan');
    return this.once(key, `aprobar:${id}`, async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      if (!['solicitada', 'en_revision'].includes(r.status)) fail(409, 'Esta solicitud ya está decidida');
      const items = (await db.query('SELECT * FROM inventory.tool_request_items WHERE request_id=$1 ORDER BY position', [r.id])).rows;
      const chosen = new Map();
      for (const it of body.items) {
        const item = items.find((i) => i.id === it?.itemId);
        if (!item) fail(400, 'Línea de la solicitud no encontrada');
        if (!Array.isArray(it.assetIds) || !it.assetIds.every(isUuid)) fail(400, 'Herramientas no válidas');
        if (it.assetIds.length > item.quantity) fail(400, 'No se pueden aprobar más unidades de las pedidas');
        chosen.set(item.id, [...new Set(it.assetIds)]);
      }
      const all = [...chosen.values()].flat();
      if (new Set(all).size !== all.length) fail(400, 'Una misma herramienta no puede ir en dos líneas');
      if (!all.length) fail(400, 'Para no aprobar nada, rechaza la solicitud');
      const partial = items.some((i) => (chosen.get(i.id)?.length || 0) < i.quantity);
      if (partial && !reason) fail(400, 'Explica por qué se aprueba solo una parte');
      const conflicts = [];
      for (const assetId of [...all].sort()) {
        await db.query('SELECT 1 FROM inventory.assets WHERE id=$1 FOR UPDATE', [assetId]);
        const item = items.find((i) => chosen.get(i.id)?.includes(assetId));
        const c = await this.conflictOf(db, assetId, { typeId: item.type_id, from: r.needed_from, to: r.return_by, projectId: r.project_id, requestId: r.id });
        if (c) conflicts.push({ assetId, reason: c });
      }
      if (conflicts.length) fail(409, `Hay conflictos: ${conflicts.map((c) => c.reason).join('; ')}`, { conflicts });
      for (const item of items) {
        const ids = chosen.get(item.id) || [];
        await db.query('UPDATE inventory.tool_request_items SET quantity_approved=$2 WHERE id=$1', [item.id, ids.length]);
        for (const assetId of ids) {
          await db.query(`INSERT INTO inventory.reservations (asset_id, project_id, request_id, request_item_id, starts_on, ends_on, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [assetId, r.project_id, r.id, item.id, r.needed_from, r.return_by, this.user.id]);
        }
      }
      await this.transition(db, r, partial ? 'parcialmente_aprobada' : 'aprobada', { reason, decided: true });
      return this.getRequest(r.id, db);
    });
  },

  async rejectRequest(id, body = {}) {
    this.need('tools.requests.approve', 'Solo administración rechaza solicitudes');
    const reason = text(body.reason, 'Motivo del rechazo', { max: 1000, required: true });
    return this.tx(async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      await db.query('UPDATE inventory.tool_request_items SET quantity_approved=0 WHERE request_id=$1', [r.id]);
      await this.transition(db, r, 'rechazada', { reason, decided: true });
      return this.getRequest(r.id, db);
    });
  },

  async prepareRequest(id) {
    this.need('tools.requests.approve');
    return this.tx(async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      await this.transition(db, r, 'en_preparacion');
      return this.getRequest(r.id, db);
    });
  },

  // POST /solicitudes/:id/despachar — one movement per reserved unit, to the
  // project's obra, addressed to whoever asked. A unit already there is
  // delivered at once. A unit that broke since the approval is left out.
  async dispatchRequest(id, body = {}, key) {
    this.need('tools.requests.approve', 'Solo administración despacha solicitudes');
    return this.once(key, `despachar:${id}`, async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      if (!canTransition(r.status, 'en_traslado')) fail(409, 'Esta solicitud no está lista para enviarse');
      const res = (await db.query("SELECT * FROM inventory.reservations WHERE request_id=$1 AND status='activa' ORDER BY asset_id", [r.id])).rows;
      if (!res.length) fail(409, 'No queda ninguna herramienta reservada para esta solicitud');
      const toLocationId = await this.obraLocation(db, r.project_id);
      const skipped = [];
      let sent = 0;
      for (const x of res) {
        const a = await this.loadAsset(db, x.asset_id, { lock: true });
        if (a.condition !== 'operativa' || a.retired_at) { skipped.push(`${a.code}: ${a.retired_at ? 'de baja' : a.condition}`); continue; }
        if (a.pm_id) { skipped.push(`${a.code}: ya tiene un traslado pendiente`); continue; }
        const m = (await db.query(`INSERT INTO inventory.asset_movements (asset_id, purpose, from_location_id, to_location_id, from_custodian_user_id, from_custodian_employee_id,
            to_custodian_user_id, project_id, request_id, status, sent_by) VALUES ($1,'entrega',$2,$3,$4,$5,$6,$7,$8,'pendiente',$9) RETURNING *`,
        [a.id, a.location_id, toLocationId, a.custodian_user_id, a.custodian_employee_id, r.requested_by, r.project_id, r.id, this.user.id])).rows[0];
        sent += 1;
        if (a.location_id === toLocationId && a.custodian_user_id === r.requested_by) await this.applyReception(db, m, a, { notes: 'Ya estaba en la obra', by: this.user.id });
      }
      if (!sent) fail(409, `Ninguna herramienta se puede enviar: ${skipped.join('; ')}`);
      const cur = (await db.query('SELECT status FROM inventory.tool_requests WHERE id=$1', [r.id])).rows[0];
      if (cur.status === r.status) await this.transition(db, r, 'en_traslado', { reason: skipped.length ? `Sin enviar: ${skipped.join('; ')}` : null });
      await this.syncRequest(db, r.id);
      return { skipped, ...(await this.getRequest(r.id, db)) };
    });
  },

  async finishRequest(id) {
    return this.tx(async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      if (!this.can('tools.requests.approve') && r.requested_by !== this.user.id) fail(403, 'No puedes cerrar esta solicitud');
      await this.transition(db, r, 'finalizada');
      return this.getRequest(r.id, db);
    });
  },

  async cancelRequest(id, body = {}) {
    const reason = text(body.reason, 'Motivo', { max: 1000, required: true });
    return this.tx(async (db) => {
      const r = await this.loadRequest(db, id, { lock: true });
      const approver = this.can('tools.requests.approve');
      const own = r.requested_by === this.user.id && ['borrador', 'solicitada', 'en_revision'].includes(r.status);
      if (!own && !approver) fail(403, 'Ya no puedes cancelar esta solicitud: habla con administración');
      await db.query("UPDATE inventory.reservations SET status='cancelada', ended_at=now() WHERE request_id=$1 AND status='activa'", [r.id]);
      await this.transition(db, r, 'cancelada', { reason });
      return this.getRequest(r.id, db);
    });
  },

  // Keeps a dispatched request in step with its movements: every movement
  // received → entregada; every unit it delivered back (assignment ended) → finalizada.
  async syncRequest(db, requestId) {
    const r = (await db.query('SELECT * FROM inventory.tool_requests WHERE id=$1 FOR UPDATE', [requestId])).rows[0];
    if (!r) return;
    const m = (await db.query(`SELECT count(*) FILTER (WHERE status='pendiente')::int pending, count(*) FILTER (WHERE status='recibido')::int received FROM inventory.asset_movements WHERE request_id=$1 AND purpose='entrega'`, [r.id])).rows[0];
    if (r.status === 'en_traslado' && m.pending === 0) {
      if (m.received > 0) await this.transition(db, r, 'entregada');
      else await this.transition(db, r, 'en_preparacion', { reason: 'Ningún envío llegó: vuelve a preparación' });
      r.status = m.received > 0 ? 'entregada' : 'en_preparacion';
    }
    if (r.status === 'entregada') {
      const open = (await db.query('SELECT count(*)::int n FROM inventory.asset_assignments WHERE request_id=$1 AND ended_at IS NULL', [r.id])).rows[0].n;
      if (open === 0) await this.transition(db, r, 'finalizada', { reason: 'Todas las herramientas devueltas' });
    }
  },

  // POST /reservas — an admin reserves a unit directly (no request). Same conflict rules.
  async reserve(body = {}, key) {
    this.need('tools.requests.approve', 'Solo administración reserva directamente');
    const assetId = uuid(body.assetId, 'Herramienta');
    const projectId = uuid(body.projectId, 'Obra');
    const from = day(body.startsOn, 'Inicio', { required: true });
    const to = day(body.endsOn, 'Fin', { required: true });
    if (to < from) fail(400, 'El fin no puede ser anterior al inicio');
    return this.once(key, 'reserva', async (db) => {
      const a = await this.loadAsset(db, assetId, { lock: true });
      if (!(await this.projects([projectId], db)).get(projectId)) fail(404, 'Proyecto no encontrado');
      const c = await this.conflictOf(db, a.id, { from, to, projectId });
      if (c) fail(409, c);
      const r = (await db.query(`INSERT INTO inventory.reservations (asset_id, project_id, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [a.id, projectId, from, to, this.user.id])).rows[0];
      await this.audit(db, 'Herramienta reservada', `${a.code} · ${from} → ${to}`);
      return { reservation: { id: r.id }, ...(await this.get(a.id, db)) };
    });
  },
  async cancelReservation(id, body = {}) {
    this.need('tools.requests.approve', 'Solo administración cancela reservas');
    uuid(id, 'Reserva');
    const reason = text(body.reason, 'Motivo', { max: 500, required: true });
    return this.tx(async (db) => {
      const x = (await db.query("SELECT asset_id FROM inventory.reservations WHERE id=$1 AND status='activa'", [id])).rows[0];
      if (!x) fail(404, 'Reserva activa no encontrada');
      const a = await this.loadAsset(db, x.asset_id, { lock: true });
      await db.query("UPDATE inventory.reservations SET status='cancelada', ended_at=now() WHERE id=$1", [id]);
      await this.audit(db, 'Reserva de herramienta cancelada', `${a.code} · ${reason}`);
      return this.get(a.id, db);
    });
  },
};
