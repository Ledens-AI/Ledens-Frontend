import { fail, uuid, text } from './util.js';
import { OWNERSHIP, STATUS_SQL, ASSET_FROM } from './sql.js';

// Supervision side of Ledens Tools, mixed into HerramientasService:
// the jefe's «Herramientas de mi obra», a project's tools, the admin dashboard,
// in-platform alerts (computed, no table: the bell of /plataforma already works
// that way), physical counts, consumables and the initial CSV import.
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export const supervisionMethods = {
  // GET /mis-obras — one card per project of the jefe (admin: projects that have tools).
  async myObras() {
    this.need('tools.read');
    const db = this.pool;
    let ids = await this.mineArray(db);
    if (ids === null) {
      ids = (await db.query(`SELECT DISTINCT p FROM (SELECT project_id p FROM inventory.asset_assignments WHERE ended_at IS NULL
        UNION SELECT project_id FROM inventory.locations WHERE kind='obra' UNION SELECT project_id FROM inventory.tool_requests WHERE status NOT IN ('finalizada','cancelada','rechazada')) x WHERE p IS NOT NULL`)).rows.map((r) => r.p);
    }
    if (!ids.length) return { obras: [] };
    const rows = (await db.query(`SELECT p.id,
        (SELECT count(*)::int FROM inventory.assets a LEFT JOIN inventory.asset_assignments aa ON aa.asset_id=a.id AND aa.ended_at IS NULL JOIN inventory.locations l ON l.id=a.location_id
          WHERE a.retired_at IS NULL AND coalesce(aa.project_id, l.project_id)=p.id) assigned,
        (SELECT count(*)::int FROM inventory.asset_movements m JOIN inventory.locations l ON l.id=m.to_location_id WHERE m.status='pendiente' AND l.project_id=p.id) incoming,
        (SELECT count(*)::int FROM inventory.tool_requests r WHERE r.project_id=p.id AND r.status IN ('borrador','solicitada','en_revision','aprobada','parcialmente_aprobada','en_preparacion','en_traslado')) requests,
        (SELECT count(*)::int FROM inventory.asset_incidents i WHERE i.status='abierta' AND i.project_id=p.id) incidents,
        (SELECT count(*)::int FROM inventory.asset_assignments aa WHERE aa.ended_at IS NULL AND aa.project_id=p.id AND aa.expected_return_on<=$2::date) returns,
        (SELECT count(*)::int FROM inventory.asset_assignments aa WHERE aa.ended_at IS NULL AND aa.project_id=p.id AND aa.expected_return_on<current_date) overdue
      FROM unnest($1::uuid[]) p(id)`, [ids, plusDays(3)])).rows;
    const projects = await this.projects(ids, db);
    return {
      obras: rows.map((r) => {
        const p = projects.get(r.id) || {};
        return { project: { id: r.id, code: p.code || null, name: p.name || 'Proyecto', status: p.status || null }, assigned: r.assigned, incoming: r.incoming, requests: r.requests, incidents: r.incidents, returnsDue: r.returns, overdue: r.overdue };
      }).filter((o) => !projects.get(o.project.id)?.missing).sort((a, b) => String(b.project.code).localeCompare(String(a.project.code))),
    };
  },

  // GET /obras/:projectId — the Herramientas tab of an obra.
  async projectTools(projectId) {
    this.need('tools.read');
    const db = this.pool;
    uuid(projectId, 'Proyecto');
    if (!(await this.isMine(db, projectId))) fail(404, 'Proyecto no encontrado');
    const p = (await this.projects([projectId], db)).get(projectId);
    if (!p || p.missing) fail(404, 'Proyecto no encontrado');
    const list = await this.list({ proyecto: projectId });
    const incoming = (await db.query(`SELECT m.id, m.asset_id, m.purpose, m.sent_at, m.to_custodian_user_id, a.code, a.name, f.name from_name, s.name sender
      FROM inventory.asset_movements m JOIN inventory.locations l ON l.id=m.to_location_id JOIN inventory.assets a ON a.id=m.asset_id
      LEFT JOIN inventory.locations f ON f.id=m.from_location_id JOIN users s ON s.id=m.sent_by
      WHERE m.status='pendiente' AND l.kind='obra' AND l.project_id=$1 ORDER BY m.sent_at`, [projectId])).rows;
    const reserved = (await db.query(`SELECT r.id, r.starts_on::text, r.ends_on::text, a.id asset_id, a.code, a.name FROM inventory.reservations r JOIN inventory.assets a ON a.id=r.asset_id
      WHERE r.project_id=$1 AND r.status='activa' AND r.ends_on>=current_date ORDER BY r.starts_on, a.code`, [projectId])).rows;
    const requests = (await this.listRequests({ proyecto: projectId, estado: 'abiertas' })).solicitudes;
    return {
      project: { id: projectId, code: p.code, name: p.name },
      herramientas: list.herramientas,
      incoming: incoming.map((m) => ({ id: m.id, assetId: m.asset_id, code: m.code, name: m.name, purpose: m.purpose, from: m.from_name, sentAt: m.sent_at, sender: m.sender, forMe: this.isAdmin || !m.to_custodian_user_id || m.to_custodian_user_id === this.user.id })),
      reservations: reserved.map((r) => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, asset: { id: r.asset_id, code: r.code, name: r.name } })),
      requests,
    };
  },

  // GET /panel — the company-wide picture (tools.read.all).
  async dashboard(q = {}) {
    this.need('tools.read.all', 'Solo administración ve el panel de herramientas');
    const db = this.pool;
    const args = [];
    const where = ['a.retired_at IS NULL'];
    if (q.proyecto) { args.push(uuid(q.proyecto, 'Proyecto')); where.push(`coalesce(aa.project_id, l.project_id)=$${args.length}`); }
    if (q.ubicacion) { args.push(uuid(q.ubicacion, 'Ubicación')); where.push(`a.location_id=$${args.length}`); }
    if (q.categoria) { args.push(text(q.categoria, 'Categoría', { max: 80 })); where.push(`t.category=$${args.length}`); }
    if (q.responsable) { args.push(uuid(q.responsable, 'Responsable')); where.push(`a.custodian_user_id=$${args.length}`); }
    const counts = (await db.query(`SELECT ${STATUS_SQL} status, count(*)::int n FROM ${ASSET_FROM} WHERE ${where.join(' AND ')} GROUP BY 1`, args)).rows;
    const by = Object.fromEntries(counts.map((c) => [c.status, c.n]));
    const total = counts.reduce((s, c) => s + c.n, 0);
    const pendingApproval = (await db.query("SELECT count(*)::int n FROM inventory.tool_requests WHERE status IN ('solicitada','en_revision')")).rows[0].n;
    const overdue = (await db.query(`SELECT aa.id, aa.expected_return_on::text, aa.project_id, a.id asset_id, a.code, a.name FROM inventory.asset_assignments aa JOIN inventory.assets a ON a.id=aa.asset_id
      WHERE aa.ended_at IS NULL AND aa.expected_return_on<current_date ORDER BY aa.expected_return_on LIMIT 50`)).rows;
    const rentals = (await db.query(`SELECT id, code, name, owner_name, rental_ends_on::text FROM inventory.assets WHERE retired_at IS NULL AND ownership='alquilada' AND rental_ends_on<=$1::date ORDER BY rental_ends_on LIMIT 50`, [plusDays(7)])).rows;
    const incidents = (await db.query(`SELECT i.id, i.kind, i.reported_at, i.blocks_use, a.id asset_id, a.code, a.name FROM inventory.asset_incidents i JOIN inventory.assets a ON a.id=i.asset_id
      WHERE i.status='abierta' ORDER BY i.blocks_use DESC, i.reported_at DESC LIMIT 50`)).rows;
    const lowStock = (await db.query(`SELECT t.id, t.name, t.unit, t.min_stock, coalesce(sum(s.quantity),0) quantity FROM inventory.tool_types t LEFT JOIN inventory.consumable_stock s ON s.type_id=t.id
      WHERE t.tracking='consumible' AND t.active AND t.min_stock IS NOT NULL GROUP BY t.id HAVING coalesce(sum(s.quantity),0) < t.min_stock ORDER BY t.name`)).rows;
    const projects = await this.projects(overdue.map((o) => o.project_id), db);
    return {
      kpis: {
        total, disponibles: by.disponible || 0, asignados: by.asignada || 0, reservados: by.reservada || 0, enTraslado: by.en_traslado || 0,
        enMantenimiento: (by.en_mantenimiento || 0) + (by.averiada || 0), extraviados: (by.perdida || 0) + (by.robada || 0),
        solicitudesPendientes: pendingApproval, devolucionesVencidas: overdue.length,
      },
      overdue: overdue.map((o) => { const p = projects.get(o.project_id); return { assignmentId: o.id, expectedReturnOn: o.expected_return_on, asset: { id: o.asset_id, code: o.code, name: o.name }, project: { id: o.project_id, code: p?.code, name: p?.name } }; }),
      rentals: rentals.map((r) => ({ id: r.id, code: r.code, name: r.name, ownerName: r.owner_name, rentalEndsOn: r.rental_ends_on })),
      incidents: incidents.map((i) => ({ id: i.id, kind: i.kind, reportedAt: i.reported_at, blocksUse: i.blocks_use, asset: { id: i.asset_id, code: i.code, name: i.name } })),
      lowStock: lowStock.map((t) => ({ id: t.id, name: t.name, unit: t.unit, minStock: t.min_stock, quantity: t.quantity })),
    };
  },

  // GET /avisos — the bell of /plataforma. Computed each time from the state, so
  // nothing is ever stale or sent twice; one line per kind, never one per tool.
  async alerts() {
    if (!this.can('tools.read')) return { avisos: [] };
    const db = this.pool;
    const out = [];
    const pend = await this.pendingMovements();
    if (pend.toReceive.length) out.push({ kind: 'recepcion', count: pend.toReceive.length, title: pend.toReceive.length === 1 ? 'Una herramienta pendiente de recibir' : `${pend.toReceive.length} herramientas pendientes de recibir`, sub: 'Confirma la recepción al llegar' });
    const mine = await this.mineArray(db);
    const scope = mine === null ? 'true' : '(aa.project_id=ANY($1::uuid[]))';
    const due = (await db.query(`SELECT count(*) FILTER (WHERE aa.expected_return_on<current_date)::int overdue, count(*) FILTER (WHERE aa.expected_return_on BETWEEN current_date AND $2::date)::int soon
      FROM inventory.asset_assignments aa WHERE aa.ended_at IS NULL AND ${scope} AND ($1::uuid[] IS NULL OR true)`, [mine, plusDays(2)])).rows[0];
    if (due.overdue) out.push({ kind: 'vencida', count: due.overdue, title: due.overdue === 1 ? 'Una devolución vencida' : `${due.overdue} devoluciones vencidas`, sub: 'Devuélvelas o pide una prórroga' });
    if (due.soon) out.push({ kind: 'devolucion', count: due.soon, title: due.soon === 1 ? 'Una devolución próxima' : `${due.soon} devoluciones en los próximos 2 días`, sub: 'Prepara su vuelta a almacén' });
    if (this.can('tools.requests.approve')) {
      const n = (await db.query("SELECT count(*)::int n FROM inventory.tool_requests WHERE status IN ('solicitada','en_revision')")).rows[0].n;
      if (n) out.push({ kind: 'aprobar', count: n, title: n === 1 ? 'Una solicitud de herramientas por decidir' : `${n} solicitudes de herramientas por decidir`, sub: 'Revisa disponibilidad y aprueba' });
      const inc = (await db.query("SELECT count(*)::int n FROM inventory.asset_incidents WHERE status='abierta' AND blocks_use AND reported_at>now()-interval '7 days'")).rows[0].n;
      if (inc) out.push({ kind: 'incidencia', count: inc, title: inc === 1 ? 'Una herramienta averiada esta semana' : `${inc} herramientas averiadas esta semana`, sub: 'Abre el mantenimiento' });
    } else {
      const d = (await db.query(`SELECT status, count(*)::int n FROM inventory.tool_requests WHERE requested_by=$1 AND decided_at>now()-interval '7 days'
        AND status IN ('aprobada','parcialmente_aprobada','rechazada') GROUP BY status`, [this.user.id])).rows;
      for (const r of d) out.push({ kind: r.status === 'rechazada' ? 'rechazada' : 'aprobada', count: r.n, title: `${r.n === 1 ? 'Una solicitud' : `${r.n} solicitudes`} ${r.status === 'rechazada' ? (r.n === 1 ? 'rechazada' : 'rechazadas') : r.status === 'aprobada' ? (r.n === 1 ? 'aprobada' : 'aprobadas') : 'aprobada en parte'}`, sub: 'Mis solicitudes' });
    }
    return { avisos: out };
  },

  // ---------- physical counts ----------
  async startCount(body = {}) {
    this.need('tools.manage', 'Solo administración hace recuentos');
    const locationId = uuid(body.locationId, 'Ubicación');
    return this.tx(async (db) => {
      if (!(await db.query('SELECT 1 FROM inventory.locations WHERE id=$1', [locationId])).rows.length) fail(404, 'Ubicación no encontrada');
      if ((await db.query("SELECT 1 FROM inventory.inventory_counts WHERE location_id=$1 AND status='abierto'", [locationId])).rows.length) fail(409, 'Ya hay un recuento abierto en esta ubicación');
      const r = (await db.query('INSERT INTO inventory.inventory_counts (location_id, started_by) VALUES ($1,$2) RETURNING id', [locationId, this.user.id])).rows[0];
      return this.getCount(r.id, db);
    });
  },
  async getCount(id, db = this.pool) {
    this.need('tools.manage');
    uuid(id, 'Recuento');
    const c = (await db.query('SELECT c.*, l.name loc_name FROM inventory.inventory_counts c JOIN inventory.locations l ON l.id=c.location_id WHERE c.id=$1', [id])).rows[0];
    if (!c) fail(404, 'Recuento no encontrado');
    const expected = (await db.query('SELECT id, code, name FROM inventory.assets WHERE location_id=$1 AND retired_at IS NULL ORDER BY code', [c.location_id])).rows;
    const seen = (await db.query('SELECT a.id, a.code, a.name, a.location_id FROM inventory.inventory_count_lines x JOIN inventory.assets a ON a.id=x.asset_id WHERE x.count_id=$1 ORDER BY a.code', [id])).rows;
    const seenIds = new Set(seen.map((s) => s.id));
    return {
      count: { id: c.id, status: c.status, location: { id: c.location_id, name: c.loc_name }, startedAt: c.started_at, closedAt: c.closed_at },
      expected: expected.length, seen: seen.length,
      missing: expected.filter((e) => !seenIds.has(e.id)).map(({ id: i, code, name }) => ({ id: i, code, name })),
      unexpected: seen.filter((s) => s.location_id !== c.location_id).map(({ id: i, code, name }) => ({ id: i, code, name })),
    };
  },
  async countSeen(id, body = {}) {
    this.need('tools.manage');
    return this.tx(async (db) => {
      const c = (await db.query("SELECT id FROM inventory.inventory_counts WHERE id=$1 AND status='abierto' FOR UPDATE", [uuid(id, 'Recuento')])).rows[0];
      if (!c) fail(409, 'El recuento no está abierto');
      let a;
      if (body.token) a = (await db.query('SELECT id FROM inventory.assets WHERE qr_token=$1', [String(body.token)])).rows[0];
      else a = (await this.loadAsset(db, body.assetId || body.code));
      if (!a) fail(404, 'Etiqueta no reconocida');
      await db.query('INSERT INTO inventory.inventory_count_lines (count_id, asset_id, seen_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, a.id, this.user.id]);
      return this.getCount(c.id, db);
    });
  },
  // Closing only reports: discrepancies are fixed with corrections or incidents, never silently.
  async closeCount(id) {
    this.need('tools.manage');
    return this.tx(async (db) => {
      const report = await this.getCount(id, db);
      if (report.count.status !== 'abierto') fail(409, 'El recuento ya está cerrado');
      const summary = { expected: report.expected, seen: report.seen, missing: report.missing.map((m) => m.code), unexpected: report.unexpected.map((m) => m.code) };
      await db.query("UPDATE inventory.inventory_counts SET status='cerrado', closed_by=$2, closed_at=now(), summary=$3 WHERE id=$1", [id, this.user.id, JSON.stringify(summary)]);
      await this.audit(db, 'Recuento de herramientas cerrado', `${report.count.location.name} · ${report.seen}/${report.expected} vistas · faltan ${summary.missing.length} · fuera de sitio ${summary.unexpected.length}`);
      return this.getCount(id, db);
    });
  },

  // ---------- consumables (category C) ----------
  async consumables() {
    this.need('tools.read');
    const db = this.pool;
    const mine = await this.myProjects(db);
    const rows = (await db.query(`SELECT t.id, t.name, t.category, t.unit, t.min_stock, s.location_id, s.quantity, l.name loc_name, l.kind loc_kind, l.project_id
      FROM inventory.tool_types t LEFT JOIN inventory.consumable_stock s ON s.type_id=t.id LEFT JOIN inventory.locations l ON l.id=s.location_id
      WHERE t.tracking='consumible' AND t.active ORDER BY t.category, t.name, l.name`)).rows;
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, name: r.name, category: r.category, unit: r.unit, minStock: r.min_stock, total: 0, stock: [] });
      const t = map.get(r.id);
      if (!r.location_id) continue;
      t.total += Number(r.quantity);
      if (r.loc_kind !== 'obra' || mine === null || mine.has(r.project_id)) t.stock.push({ locationId: r.location_id, location: r.loc_name, quantity: r.quantity });
    }
    return { consumibles: [...map.values()].map((t) => ({ ...t, total: t.total.toFixed(2), low: t.minStock !== null && t.total < Number(t.minStock) })) };
  },
  // Entradas / consumos. An admin adjusts anywhere; a jefe only records consumption at their obras.
  async adjustConsumable(body = {}, key) {
    const typeId = uuid(body.typeId, 'Consumible');
    const locationId = uuid(body.locationId, 'Ubicación');
    const raw = String(body.delta ?? '').trim().replace(',', '.');
    if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(raw)) fail(400, 'Cantidad no válida');
    const delta = Number(raw);
    if (!delta) fail(400, 'La cantidad no puede ser cero');
    const reason = text(body.reason, 'Motivo', { max: 300, required: true });
    return this.once(key, 'consumible', async (db) => {
      const loc = (await db.query('SELECT kind, project_id FROM inventory.locations WHERE id=$1', [locationId])).rows[0];
      if (!loc) fail(404, 'Ubicación no encontrada');
      if (!this.can('tools.manage')) {
        this.need('tools.transfer');
        if (delta > 0 || loc.kind !== 'obra' || !(await this.isMine(db, loc.project_id))) fail(403, 'Solo puedes registrar consumos en tus obras');
      }
      const t = (await db.query("SELECT name FROM inventory.tool_types WHERE id=$1 AND tracking='consumible'", [typeId])).rows[0];
      if (!t) fail(404, 'Consumible no encontrado');
      await db.query('INSERT INTO inventory.consumable_stock (type_id, location_id, quantity) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [typeId, locationId]);
      const cur = (await db.query('SELECT quantity FROM inventory.consumable_stock WHERE type_id=$1 AND location_id=$2 FOR UPDATE', [typeId, locationId])).rows[0];
      if (Number(cur.quantity) + delta < 0) fail(409, `No hay tantas existencias (quedan ${cur.quantity})`);
      await db.query('UPDATE inventory.consumable_stock SET quantity=quantity+$3, updated_at=now() WHERE type_id=$1 AND location_id=$2', [typeId, locationId, delta]);
      await db.query('INSERT INTO inventory.consumable_ledger (type_id, location_id, delta, reason, actor_id) VALUES ($1,$2,$3,$4,$5)', [typeId, locationId, delta, reason, this.user.id]);
      await this.audit(db, 'Existencias de consumible ajustadas', `${t.name} · ${delta > 0 ? '+' : ''}${delta} · ${reason}`);
      return { ok: true, quantity: (Number(cur.quantity) + delta).toFixed(2) };
    });
  },

  // ---------- CSV import (admins) ----------
  // Columns (header row, «;» or «,»): tipo; categoria; seguimiento (individual|kit);
  // nombre; marca; modelo; numero_serie; propiedad (propia|alquilada|tercero);
  // propietario; fecha_adquisicion (AAAA-MM-DD); coste; proveedor; garantia;
  // ubicacion (name of an existing location; empty = Almacén central); observaciones.
  // Every row is validated first; with ?simular=1, or any error, nothing is written.
  async importCsv(csv, { dryRun = false } = {}) {
    this.need('tools.manage', 'Solo administración importa inventario');
    if (typeof csv !== 'string' || !csv.trim()) fail(400, 'El fichero está vacío');
    const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) fail(400, 'El fichero no tiene filas');
    if (lines.length > 2001) fail(400, 'Máximo 2000 herramientas por importación');
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const split = (l) => {
      const out = []; let cur = ''; let q = false;
      for (let i = 0; i < l.length; i += 1) {
        const ch = l[i];
        if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out.map((v) => v.trim());
    };
    const norm = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z_]/g, '_');
    const head = split(lines[0]).map(norm);
    for (const req of ['tipo', 'categoria', 'nombre']) if (!head.includes(req)) fail(400, `Falta la columna «${req}»`);
    const db = this.pool;
    const locations = new Map((await db.query("SELECT id, lower(name) n FROM inventory.locations WHERE active AND kind<>'pendiente'")).rows.map((l) => [l.n, l.id]));
    const errors = [];
    const rows = [];
    lines.slice(1).forEach((l, i) => {
      const v = Object.fromEntries(split(l).map((x, k) => [head[k], x]));
      const n = i + 2;
      try {
        const tracking = (v.seguimiento || 'individual').toLowerCase();
        if (!['individual', 'kit'].includes(tracking)) fail(400, 'seguimiento debe ser individual o kit');
        const ownership = (v.propiedad || 'propia').toLowerCase();
        if (!OWNERSHIP.includes(ownership)) fail(400, 'propiedad no válida');
        const loc = v.ubicacion ? locations.get(v.ubicacion.toLowerCase()) : null;
        if (v.ubicacion && !loc) fail(400, `ubicación «${v.ubicacion}» no existe`);
        const row = {
          line: n, type: text(v.tipo, 'tipo', { max: 120, required: true }), category: text(v.categoria, 'categoria', { max: 80, required: true }), tracking,
          body: { name: v.nombre, brand: v.marca || null, model: v.modelo || null, serialNumber: v.numero_serie || null, ownership, ownerName: v.propietario || null,
            acquiredOn: v.fecha_adquisicion || null, cost: v.coste || null, supplier: v.proveedor || null, warrantyUntil: v.garantia || null, notes: v.observaciones || null, locationId: loc },
        };
        this.parseAssetFields(row.body);
        rows.push(row);
      } catch (e) {
        if (!e.status) throw e;
        errors.push({ line: n, error: e.message });
      }
    });
    const serials = new Map();
    for (const r of rows) {
      if (!r.body.serialNumber) continue;
      const k = `${r.type.toLowerCase()}|${r.body.serialNumber.toLowerCase()}`;
      if (serials.has(k)) errors.push({ line: r.line, error: `número de serie repetido (fila ${serials.get(k)})` });
      serials.set(k, r.line);
    }
    if (errors.length || dryRun) return { valid: errors.length === 0, rows: rows.length, errors: errors.sort((a, b) => a.line - b.line), created: 0 };
    const created = await this.tx(async (tx) => {
      const types = new Map();
      for (const r of rows) {
        const k = `${r.type.toLowerCase()}|${r.tracking}`;
        if (!types.has(k)) {
          await tx.query('INSERT INTO inventory.tool_types (name, category, tracking) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [r.type, r.category, r.tracking]);
          types.set(k, (await tx.query('SELECT id FROM inventory.tool_types WHERE lower(name)=lower($1) AND tracking=$2', [r.type, r.tracking])).rows[0].id);
        }
        await this.create({ ...r.body, typeId: types.get(k) }, { db: tx });
      }
      await this.audit(tx, 'Inventario de herramientas importado', `${rows.length} herramientas desde CSV`);
      return rows.length;
    });
    return { valid: true, rows: rows.length, errors: [], created };
  },
};

