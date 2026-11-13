import crypto from 'node:crypto';
import { audit } from '../db/audit.js';
import { PresupuestosService } from '../presupuestos/service.js';
import { can, permissionsOf } from './permissions.js';
import { requestMethods } from './requests.js';
import { supervisionMethods } from './supervision.js';
import { ToolError, fail, isUuid, uuid, text, day, money, int, today } from './util.js';
import { LOCATION_KINDS, OWNERSHIP, INCIDENT_KINDS, PURPOSES, BLOCKING, STATUS_SQL, ASSET_FROM, ASSET_COLS } from './sql.js';

export { ToolError, fail, isUuid, uuid, text, day, money, int, today };

// Ledens Tools (migration 043, /api/herramientas). One service per request,
// built with the effective user (after «Ver como»). What each role may see
// and do is decided here (permissions.js), never by the frontend:
//  - admin: the whole company — register, edit, label, approve, move, repair;
//  - jefe: the tools of «sus obras» (projects of the obras assigned to them,
//    presupuestos.jefe_id, plus those Gestión financiera grants them,
//    ledens.finance_project_permissions) and those in their custody; elsewhere
//    only what availability needs (no custodian, no other obra's name, never
//    costs). They request, send, receive and report; they never approve.
//  - client: nothing.
// Every write on an asset first takes that asset's row lock (FOR UPDATE), so
// two phones acting on the same drill at once are serialised; the partial
// unique indexes of the migration (one pending movement, one open assignment
// per asset) are the database's own backstop.
const newToken = () => crypto.randomBytes(10).toString('base64url'); // 80 random bits, URL-safe, ~14 chars
const appUrl = () => (process.env.PUBLIC_APP_URL || 'https://ambitious-island-05d1d8a03.2.azurestaticapps.net').replace(/\/+$/, '');
export const qrUrl = (token) => `${appUrl()}/h/${token}`;

export class HerramientasService {
  constructor(pool, user, { storage = null } = {}) {
    this.pool = pool;
    this.user = user;
    this.storage = storage;
    this._mine = undefined;
    this._tables = {};
  }

  get isAdmin() { return this.user.role === 'admin'; }
  can(perm) { return can(this.user, perm); }
  need(perm, message = 'No tienes permiso para esto') { if (!this.can(perm)) fail(403, message); }
  actor() { return { id: this.user.id, name: this.user.name || this.user.email }; }
  audit(db, action, detail) { return audit({ actor: this.actor(), action, detail: String(detail).slice(0, 2000) }, db); }

  async tx(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // Idempotency-Key: the same key from the same person replays the first answer
  // (a retry on a bad connection never registers a second movement). The key is
  // stored inside the write's own transaction; a concurrent duplicate waits on
  // the primary key until the first commits, then reads its answer.
  async once(key, route, fn) {
    if (key === undefined || key === null || key === '') return this.tx(fn);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail(400, 'Clave de idempotencia no válida');
    return this.tx(async (db) => {
      const ins = await db.query(`INSERT INTO inventory.idempotency_keys (user_id, key, route, response) VALUES ($1,$2,$3,'null'::jsonb)
        ON CONFLICT DO NOTHING RETURNING key`, [this.user.id, key, route]);
      if (!ins.rows.length) {
        const prev = (await db.query('SELECT route, response FROM inventory.idempotency_keys WHERE user_id=$1 AND key=$2', [this.user.id, key])).rows[0];
        if (prev.route !== route) fail(422, 'Esta clave de idempotencia ya se usó para otra operación');
        return { ...prev.response, replayed: true };
      }
      const out = await fn(db);
      await db.query('UPDATE inventory.idempotency_keys SET response=$3 WHERE user_id=$1 AND key=$2', [this.user.id, key, JSON.stringify(out)]);
      return out;
    });
  }

  async hasTable(db, name) {
    if (this._tables[name] === undefined) this._tables[name] = !!(await db.query('SELECT to_regclass($1) t', [name])).rows[0].t;
    return this._tables[name];
  }

  // Projects a jefe works on: those of the obras assigned to them and those
  // Gestión financiera lets them see — the same rule as «Presupuestos y obras».
  // null for an admin (every project).
  async myProjects(db = this.pool) {
    if (this.can('tools.read.all')) return null;
    if (this._mine !== undefined) return this._mine;
    const ids = new Set((await db.query('SELECT DISTINCT project_id FROM presupuestos WHERE jefe_id=$1 AND project_id IS NOT NULL', [this.user.id])).rows.map((r) => r.project_id));
    if (await this.hasTable(db, 'ledens.finance_project_permissions')) {
      for (const r of (await db.query('SELECT project_id FROM ledens.finance_project_permissions WHERE user_id=$1 AND project_id IS NOT NULL', [this.user.id])).rows) ids.add(r.project_id);
    }
    this._mine = ids;
    return ids;
  }
  async isMine(db, projectId) {
    const mine = await this.myProjects(db);
    return mine === null ? true : !!projectId && mine.has(projectId);
  }
  async mineArray(db) { const m = await this.myProjects(db); return m === null ? null : [...m]; }

  async projects(ids, db = this.pool) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length || !(await this.hasTable(db, 'ledens.projects'))) return new Map();
    return new PresupuestosService(db, this.user).projectsById(list, db);
  }
  async employees(ids, db = this.pool) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length || !(await this.hasTable(db, 'ledens.employees'))) return new Map();
    return new Map((await db.query('SELECT id, name FROM ledens.employees WHERE id=ANY($1::uuid[])', [list])).rows.map((r) => [r.id, r.name]));
  }

  // The project an asset currently works for: its open assignment, else the obra it sits in.
  // A jefe acts on an asset of one of their projects or in their own custody.
  async inScope(db, a) {
    if (this.can('tools.read.all')) return true;
    if (a.custodian_user_id === this.user.id) return true;
    return this.isMine(db, a.work_project);
  }
  // Who confirms a movement: the person it is addressed to; when it is addressed
  // to a place, the team of that obra; an admin always (warehouse, workshop…).
  async canReceive(db, m) {
    if (!this.can('tools.receive')) return false;
    if (this.isAdmin) return true;
    if (m.to_custodian_user_id) return m.to_custodian_user_id === this.user.id;
    const loc = m.to_location_kind ? { kind: m.to_location_kind, project_id: m.to_location_project } : (await db.query('SELECT kind, project_id FROM inventory.locations WHERE id=$1', [m.to_location_id])).rows[0];
    return loc.kind === 'obra' && (await this.isMine(db, loc.project_id));
  }

  // ---------- reading assets ----------

  // An asset as the user may see it. Economic data only with tools.manage; for
  // a jefe, an asset outside their scope shows where it is only by kind
  // («Otra obra») and never who holds it.
  async present(db, rows) {
    const mine = await this.myProjects(db);
    const seeAll = mine === null;
    const projectIds = rows.flatMap((r) => [r.work_project, r.loc_project, r.pm_to_project, r.asg_project]);
    const projects = await this.projects(projectIds, db);
    const employees = await this.employees(rows.flatMap((r) => [r.custodian_employee_id, r.pm_to_employee]), db);
    const visibleProject = (id) => !!id && (seeAll || mine.has(id));
    const proj = (id) => (id ? (visibleProject(id) ? (() => { const p = projects.get(id); return { id, code: p?.code || null, name: p?.name || 'Proyecto', mine: !seeAll || undefined }; })() : { id: null, name: 'Otra obra', mine: false, hidden: true }) : null);
    const showMoney = this.can('tools.manage');
    return rows.map((r) => {
      const scope = seeAll || r.custodian_user_id === this.user.id || visibleProject(r.work_project);
      const location = r.loc_kind === 'obra' && !visibleProject(r.loc_project)
        ? { id: null, kind: 'obra', name: 'Otra obra', hidden: true }
        : { id: r.location_id, kind: r.loc_kind, name: r.loc_name, project: proj(r.loc_project) };
      const custodian = !scope ? null
        : r.custodian_user_id ? { type: 'user', id: r.custodian_user_id, name: r.cust_user_name || r.cust_user_email }
        : r.custodian_employee_id ? { type: 'employee', id: r.custodian_employee_id, name: employees.get(r.custodian_employee_id) || 'Trabajador' } : null;
      const out = {
        id: r.id, code: r.code, kind: r.kind, name: r.name, brand: r.brand, model: r.model, serialNumber: scope ? r.serial_number : null,
        type: { id: r.type_id, name: r.type_name, category: r.category, tracking: r.tracking },
        status: r.status, condition: r.condition, ownership: r.ownership, ownerName: r.owner_name, rentalEndsOn: r.rental_ends_on,
        hasPhoto: !!r.photo_key, location, custodian, mine: scope,
        project: proj(r.work_project),
        assignment: r.asg_id && scope ? { id: r.asg_id, project: proj(r.asg_project), expectedReturnOn: r.asg_return, since: r.asg_since, requestId: r.asg_request } : null,
        pending: r.pm_id ? {
          id: r.pm_id, purpose: r.pm_purpose, sentAt: r.pm_sent_at, sentBy: scope ? r.pm_sent_by : null,
          to: r.pm_to_kind === 'obra' && !visibleProject(r.pm_to_project) ? { kind: 'obra', name: 'Otra obra', hidden: true } : { id: r.pm_to, kind: r.pm_to_kind, name: r.pm_to_name },
          toCustodian: !scope ? null : r.pm_to_user ? { type: 'user', id: r.pm_to_user } : r.pm_to_employee ? { type: 'employee', id: r.pm_to_employee, name: employees.get(r.pm_to_employee) || 'Trabajador' } : null,
          forMe: r.pm_to_user === this.user.id || (!r.pm_to_user && !r.pm_to_employee && r.pm_to_kind === 'obra' && !seeAll && visibleProject(r.pm_to_project)) || (seeAll && this.isAdmin),
        } : null,
        lastMovementAt: r.last_movement_at, notes: scope ? r.notes : null, labelVersion: r.label_version,
        retiredAt: r.retired_at, retiredReason: r.retired_reason, version: r.version,
      };
      if (showMoney) Object.assign(out, { acquiredOn: r.acquired_on, cost: r.cost, supplier: r.supplier, invoiceDocumentId: r.invoice_document_id, warrantyUntil: r.warranty_until });
      return out;
    });
  }

  async loadAsset(db, idOrCode, { lock = false } = {}) {
    const byId = isUuid(idOrCode);
    if (!byId && (typeof idOrCode !== 'string' || !/^[A-Z0-9-]{3,40}$/i.test(idOrCode))) fail(404, 'Herramienta no encontrada');
    if (lock) {
      const l = (await db.query(`SELECT id FROM inventory.assets WHERE ${byId ? 'id=$1' : 'upper(code)=upper($1)'} FOR UPDATE`, [idOrCode])).rows[0];
      if (!l) fail(404, 'Herramienta no encontrada');
      idOrCode = l.id;
    }
    const r = (await db.query(`SELECT ${ASSET_COLS} FROM ${ASSET_FROM} WHERE ${isUuid(idOrCode) ? 'a.id=$1' : 'upper(a.code)=upper($1)'}`, [idOrCode])).rows[0];
    if (!r) fail(404, 'Herramienta no encontrada');
    return r;
  }

  // GET /api/herramientas — the inventory, filtered and paginated in SQL.
  // estado: todas | disponibles | mi_obra | otras_obras | reservadas | averiadas | en_traslado | baja | <status>
  async list(q = {}) {
    this.need('tools.read');
    const db = this.pool;
    const mine = await this.mineArray(db);
    // $1 (the jefe's projects, null for all) and $2 (the filter) are always bound and typed.
    const where = ["(a.retired_at IS NULL OR $2::text = 'baja')", '($1::uuid[] IS NULL OR cardinality($1::uuid[]) >= 0)'];
    const args = [mine, String(q.estado || 'todas')];
    const add = (sql, v) => { args.push(v); where.push(sql.replaceAll('$?', `$${args.length}`)); };
    const estado = args[1];
    const filters = {
      disponibles: "s.status='disponible'",
      reservadas: "s.status='reservada' OR EXISTS (SELECT 1 FROM inventory.reservations r WHERE r.asset_id=s.id AND r.status='activa' AND r.ends_on>=current_date)",
      averiadas: "s.condition<>'operativa'",
      en_traslado: "s.status='en_traslado'",
      asignadas: "s.status='asignada'",
      baja: 's.retired_at IS NOT NULL',
      mi_obra: "(s.custodian_user_id=$U OR s.work_project=ANY(coalesce($1::uuid[], ARRAY[s.work_project])))",
      otras_obras: "s.work_project IS NOT NULL AND NOT (s.work_project=ANY(coalesce($1::uuid[], '{}'::uuid[])))",
    };
    if (estado === 'mi_obra' && mine === null) filters.mi_obra = 's.work_project IS NOT NULL';
    if (estado !== 'todas' && !filters[estado]) fail(400, 'Filtro no válido');
    const outer = [];
    if (filters[estado]) {
      let f = filters[estado];
      if (f.includes('$U')) { args.push(this.user.id); f = f.replaceAll('$U', `$${args.length}`); }
      outer.push(`(${f})`);
    }
    if (q.q) {
      const term = text(q.q, 'Búsqueda', { max: 100 });
      add("(a.code ILIKE $? OR a.name ILIKE $? OR coalesce(a.brand,'') ILIKE $? OR coalesce(a.model,'') ILIKE $? OR t.category ILIKE $? OR t.name ILIKE $?)", `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    }
    if (q.tipo) add('a.type_id=$?', uuid(q.tipo, 'Tipo'));
    if (q.categoria) add('t.category=$?', text(q.categoria, 'Categoría', { max: 80 }));
    if (q.ubicacion) add('a.location_id=$?', uuid(q.ubicacion, 'Ubicación'));
    if (q.responsable) add('a.custodian_user_id=$?', uuid(q.responsable, 'Responsable'));
    if (q.proyecto) {
      const p = uuid(q.proyecto, 'Proyecto');
      if (!(await this.isMine(db, p))) fail(404, 'Proyecto no encontrado');
      add('coalesce(aa.project_id, l.project_id)=$?', p);
    }
    const pageSize = 50;
    const page = q.pagina ? int(q.pagina, 'Página', { min: 1, max: 10000 }) : 1;
    const { rows } = await db.query(`WITH s AS (SELECT ${ASSET_COLS} FROM ${ASSET_FROM} WHERE ${where.join(' AND ')})
      SELECT s.*, count(*) OVER () total FROM s ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
      ORDER BY s.code LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, args);
    return { herramientas: await this.present(db, rows), total: Number(rows[0]?.total || 0), page, pageSize };
  }

  // GET /api/herramientas/:id (uuid or code) — the ficha, with what the user may do on it.
  async get(idOrCode, db = this.pool) {
    this.need('tools.read');
    const r = await this.loadAsset(db, idOrCode);
    const [asset] = await this.present(db, [r]);
    const scope = asset.mine;
    const kitItems = r.kind === 'kit' ? (await db.query('SELECT id, name, quantity, missing, notes FROM inventory.kit_items WHERE kit_id=$1 ORDER BY position, name', [r.id])).rows : [];
    const incidents = scope ? (await db.query(`SELECT i.id, i.kind, i.description, i.blocks_use, i.reported_at, i.photo_key IS NOT NULL has_photo, u.name reporter
      FROM inventory.asset_incidents i JOIN users u ON u.id=i.reported_by WHERE i.asset_id=$1 AND i.status='abierta' ORDER BY i.reported_at DESC`, [r.id])).rows
      .map((i) => ({ id: i.id, kind: i.kind, description: i.description, blocksUse: i.blocks_use, reportedAt: i.reported_at, hasPhoto: i.has_photo, reporter: i.reporter })) : [];
    const maintenance = scope ? (await db.query("SELECT id, provider, notes, opened_at, cost FROM inventory.asset_maintenance WHERE asset_id=$1 AND status='abierto'", [r.id])).rows[0] || null : null;
    if (maintenance && !this.can('tools.manage')) delete maintenance.cost;
    const resRows = (await db.query(`SELECT id, project_id, starts_on::text, ends_on::text, request_id FROM inventory.reservations WHERE asset_id=$1 AND status='activa' AND ends_on>=current_date ORDER BY starts_on`, [r.id])).rows;
    const mine = await this.myProjects(db);
    const projects = await this.projects(resRows.map((x) => x.project_id), db);
    const reservations = resRows.map((x) => {
      const visible = mine === null || mine.has(x.project_id);
      const p = projects.get(x.project_id);
      return { id: x.id, startsOn: x.starts_on, endsOn: x.ends_on, project: visible ? { id: x.project_id, code: p?.code, name: p?.name } : { name: 'Otra obra', hidden: true }, requestId: visible ? x.request_id : null };
    });
    const blocked = r.retired_at || r.condition !== 'operativa';
    const canMove = !r.retired_at && !r.pm_id && this.can('tools.transfer') && (await this.inScope(db, r));
    const actions = {
      transfer: canMove,
      returnToWarehouse: canMove && r.loc_kind !== 'almacen',
      receive: !!r.pm_id && (await this.canReceive(db, { to_location_id: r.pm_to, to_custodian_user_id: r.pm_to_user, to_location_kind: r.pm_to_kind, to_location_project: r.pm_to_project })),
      cancelMovement: !!r.pm_id && (this.isAdmin || r.pm_sent_by === this.user.id),
      report: !r.retired_at && this.can('tools.maintenance.report') && (scope || (!!r.pm_id && r.pm_to_user === this.user.id)),
      request: !r.retired_at && !blocked && this.can('tools.request'),
      manage: this.can('tools.manage'),
      maintenance: this.can('tools.maintenance.manage') && !r.retired_at,
      updateKit: r.kind === 'kit' && !r.retired_at && (this.can('tools.manage') || (this.can('tools.transfer') && scope)),
    };
    return { herramienta: { ...asset, kitItems, incidents, maintenance, reservations, qrUrl: actions.manage ? qrUrl(r.qr_token) : undefined }, actions, permissions: permissionsOf(this.user) };
  }

  // The token of a scanned label → the asset id. An unknown or replaced label is 404:
  // the QR grants nothing, the ficha behind it applies the user's own permissions.
  async resolveLabel(token) {
    this.need('tools.read');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(token)) fail(404, 'Etiqueta no reconocida');
    const r = (await this.pool.query('SELECT id, code FROM inventory.assets WHERE qr_token=$1', [token])).rows[0];
    if (!r) fail(404, 'Etiqueta no reconocida o sustituida por una nueva');
    return { id: r.id, code: r.code };
  }

  // ---------- catalogue (admins) ----------

  async options() {
    this.need('tools.read');
    const db = this.pool;
    const types = (await db.query('SELECT id, name, category, tracking, unit, min_stock, active FROM inventory.tool_types WHERE active ORDER BY category, name')).rows
      .map((t) => ({ id: t.id, name: t.name, category: t.category, tracking: t.tracking, unit: t.unit, minStock: t.min_stock }));
    const mine = await this.myProjects(db);
    const locs = (await db.query('SELECT id, kind, name, project_id, system FROM inventory.locations WHERE active ORDER BY kind, name')).rows
      .filter((l) => l.kind !== 'obra' || mine === null || mine.has(l.project_id));
    let projects = [];
    if (await this.hasTable(db, 'ledens.projects')) {
      projects = (await new PresupuestosService(db, this.user).projectsList()).filter((p) => mine === null || mine.has(p.id))
        .map((p) => ({ id: p.id, code: p.code, name: p.name, open: p.open, mine: mine === null ? undefined : true }));
    }
    // Who can hold a tool: the team with an account, and the workers of
    // Gestión financiera (ledens.employees) who have none. Never clients.
    const users = (await db.query("SELECT id, name, email, role FROM users WHERE role IN ('admin','jefe') ORDER BY name NULLS LAST, email")).rows
      .map((u) => ({ type: 'user', id: u.id, name: u.name || u.email, role: u.role }));
    let workers = [];
    if (await this.hasTable(db, 'ledens.employees')) {
      // activo / user_id are optional columns of the accounting import: read through to_jsonb.
      workers = (await db.query(`SELECT e.id, e.name FROM ledens.employees e WHERE coalesce((to_jsonb(e)->>'activo')::boolean, true) AND to_jsonb(e)->>'user_id' IS NULL AND e.name IS NOT NULL ORDER BY e.name LIMIT 500`)).rows
        .map((e) => ({ type: 'employee', id: e.id, name: e.name }));
    }
    return { types, locations: locs.map((l) => ({ id: l.id, kind: l.kind, name: l.name, projectId: l.project_id, system: l.system })), projects, custodians: [...users, ...workers], permissions: permissionsOf(this.user), me: this.user.id };
  }

  async createType(body = {}) {
    this.need('tools.manage');
    const name = text(body.name, 'Nombre del tipo', { max: 120, required: true });
    const category = text(body.category, 'Categoría', { max: 80, required: true });
    const tracking = body.tracking || 'individual';
    if (!['individual', 'kit', 'consumible'].includes(tracking)) fail(400, 'Seguimiento no válido');
    const unit = text(body.unit, 'Unidad', { max: 20 }) || 'ud';
    const minStock = money(body.minStock, 'Existencias mínimas');
    return this.tx(async (db) => {
      const r = (await db.query(`INSERT INTO inventory.tool_types (name, category, tracking, unit, min_stock) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING RETURNING id`, [name, category, tracking, unit, minStock])).rows[0];
      if (!r) fail(409, 'Ya existe un tipo con ese nombre');
      await this.audit(db, 'Tipo de herramienta creado', `${name} · ${category} · ${tracking}`);
      return { id: r.id, name, category, tracking, unit, minStock };
    });
  }

  async createLocation(body = {}) {
    this.need('tools.manage');
    const kind = body.kind;
    if (!LOCATION_KINDS.includes(kind) || kind === 'pendiente') fail(400, 'Tipo de ubicación no válido');
    if (kind === 'obra') {
      const projectId = uuid(body.projectId, 'Proyecto');
      return this.tx(async (db) => ({ id: await this.obraLocation(db, projectId) }));
    }
    const name = text(body.name, 'Nombre de la ubicación', { max: 160, required: true });
    const address = text(body.address, 'Dirección', { max: 300 });
    return this.tx(async (db) => {
      const r = (await db.query(`INSERT INTO inventory.locations (kind, name, address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [kind, name, address])).rows[0];
      if (!r) fail(409, 'Ya existe una ubicación con ese nombre');
      await this.audit(db, 'Ubicación de herramientas creada', `${kind} · ${name}`);
      return { id: r.id, kind, name };
    });
  }

  // The obra location of a project, created on first use (one per project, race-free).
  async obraLocation(db, projectId) {
    const found = (await db.query("SELECT id FROM inventory.locations WHERE kind='obra' AND project_id=$1", [projectId])).rows[0];
    if (found) return found.id;
    const p = (await this.projects([projectId], db)).get(projectId);
    if (!p || p.missing) fail(404, 'Proyecto no encontrado');
    const name = [p.code, p.name].filter(Boolean).join(' · ').slice(0, 160) || 'Obra';
    await db.query(`INSERT INTO inventory.locations (kind, name, project_id) VALUES ('obra', $1, $2) ON CONFLICT DO NOTHING`, [name, projectId]);
    return (await db.query("SELECT id FROM inventory.locations WHERE kind='obra' AND project_id=$1", [projectId])).rows[0].id;
  }
  async systemLocation(db, kind) {
    return (await db.query('SELECT id FROM inventory.locations WHERE kind=$1 AND system ORDER BY created_at LIMIT 1', [kind])).rows[0].id;
  }

  parseAssetFields(body, { partial = false } = {}) {
    const f = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    if (!partial || has('name')) f.name = text(body.name, 'Nombre', { max: 160, required: true });
    for (const [k, col, max] of [['brand', 'brand', 80], ['model', 'model', 80], ['serialNumber', 'serial_number', 80], ['ownerName', 'owner_name', 160], ['supplier', 'supplier', 160], ['notes', 'notes', 2000]]) {
      if (!partial || has(k)) f[col] = text(body[k], k, { max });
    }
    if (!partial || has('ownership')) {
      const o = body.ownership ?? 'propia';
      if (!OWNERSHIP.includes(o)) fail(400, 'Propiedad no válida');
      f.ownership = o;
    }
    for (const [k, col, label] of [['acquiredOn', 'acquired_on', 'Fecha de adquisición'], ['warrantyUntil', 'warranty_until', 'Fin de garantía'], ['rentalEndsOn', 'rental_ends_on', 'Fin del alquiler']]) {
      if (!partial || has(k)) f[col] = day(body[k], label);
    }
    if (!partial || has('cost')) f.cost = money(body.cost, 'Coste');
    if (!partial || has('invoiceDocumentId')) f.invoice_document_id = uuid(body.invoiceDocumentId, 'Factura', { required: false });
    if (f.ownership && f.ownership !== 'propia' && !f.owner_name && !partial) fail(400, 'Indica el propietario o la empresa de alquiler');
    return f;
  }

  // POST /api/herramientas — alta. An individual asset or a kit; consumables are stock, not assets.
  async create(body = {}, { db: outer } = {}) {
    this.need('tools.manage', 'Solo administración da de alta herramientas');
    const typeId = uuid(body.typeId, 'Tipo');
    const fields = this.parseAssetFields(body);
    const run = async (db) => {
      const type = (await db.query('SELECT id, name, tracking FROM inventory.tool_types WHERE id=$1 AND active', [typeId])).rows[0];
      if (!type) fail(400, 'Tipo no encontrado');
      if (type.tracking === 'consumible') fail(400, 'Los consumibles se gestionan por existencias, no como herramienta individual');
      const locationId = body.locationId ? uuid(body.locationId, 'Ubicación') : await this.systemLocation(db, 'almacen');
      const loc = (await db.query('SELECT id, kind, project_id FROM inventory.locations WHERE id=$1 AND active', [locationId])).rows[0];
      if (!loc) fail(400, 'Ubicación no encontrada');
      const seq = type.tracking === 'kit' ? 'kit_code_seq' : 'asset_code_seq';
      const n = (await db.query(`SELECT nextval('inventory.${seq}') n`)).rows[0].n;
      const prefix = type.tracking === 'kit' ? `KIT-${(text(body.kitPrefix, 'Prefijo', { max: 20 }) || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '')}` : 'LED-TOOL';
      const code = `${prefix}-${String(n).padStart(type.tracking === 'kit' ? 3 : 6, '0')}`;
      const cols = Object.keys(fields);
      const vals = cols.map((c) => fields[c]);
      const custodian = await this.parseCustodian(db, body.custodian);
      const r = (await db.query(`INSERT INTO inventory.assets (code, kind, type_id, location_id, custodian_user_id, custodian_employee_id, qr_token, created_by, last_movement_at, ${cols.join(', ')})
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(), ${cols.map((_, i) => `$${i + 9}`).join(', ')}) RETURNING id`,
      [code, type.tracking, typeId, locationId, custodian.user, custodian.employee, newToken(), this.user.id, ...vals])).rows[0];
      await db.query(`INSERT INTO inventory.asset_movements (asset_id, purpose, to_location_id, to_custodian_user_id, to_custodian_employee_id, status, notes, sent_by, resolved_by, resolved_at)
        VALUES ($1,'alta',$2,$3,$4,'recibido','Alta en inventario',$5,$5,now())`, [r.id, locationId, custodian.user, custodian.employee, this.user.id]);
      if (loc.kind === 'obra') await db.query('INSERT INTO inventory.asset_assignments (asset_id, project_id, created_by) VALUES ($1,$2,$3)', [r.id, loc.project_id, this.user.id]);
      if (type.tracking === 'kit' && Array.isArray(body.kitItems)) await this.writeKitItems(db, r.id, body.kitItems);
      await this.audit(db, 'Herramienta dada de alta', `${code} · ${fields.name}`);
      return r.id;
    };
    const id = outer ? await run(outer) : await this.tx(run);
    return outer ? { id } : this.get(id);
  }

  // PATCH /api/herramientas/:id — ficha data only. Location, custodian and condition
  // change through movements and incidents, never here. `version` guards
  // against overwriting someone else's edit.
  async update(id, body = {}) {
    this.need('tools.manage', 'Solo administración edita las fichas');
    const fields = this.parseAssetFields(body, { partial: true });
    if (Object.prototype.hasOwnProperty.call(body, 'typeId')) fields.type_id = uuid(body.typeId, 'Tipo');
    if (!Object.keys(fields).length) fail(400, 'Nada que cambiar');
    const version = int(body.version, 'Versión', { min: 1, max: 1e9 });
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      if (a.version !== version) fail(409, 'Otra persona ha modificado esta ficha. Recarga para ver los cambios.');
      if (fields.type_id) {
        const t = (await db.query('SELECT tracking FROM inventory.tool_types WHERE id=$1', [fields.type_id])).rows[0];
        if (!t || t.tracking !== a.kind) fail(400, 'El tipo debe tener el mismo seguimiento (individual o kit)');
      }
      const ownership = fields.ownership || a.ownership;
      const owner = Object.prototype.hasOwnProperty.call(fields, 'owner_name') ? fields.owner_name : a.owner_name;
      if (ownership !== 'propia' && !owner) fail(400, 'Indica el propietario o la empresa de alquiler');
      const changes = Object.keys(fields).filter((k) => String(a[k] ?? '') !== String(fields[k] ?? ''));
      if (!changes.length) return;
      const cols = Object.keys(fields);
      await db.query(`UPDATE inventory.assets SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, version=version+1, updated_at=now() WHERE id=$1`, [a.id, ...cols.map((c) => fields[c])]);
      await this.audit(db, 'Ficha de herramienta modificada', `${a.code} · ${changes.join(', ')}`);
    });
    return this.get(id);
  }

  // Baja lógica: the asset and its history stay; it leaves every list but «Bajas».
  async retire(id, body = {}) {
    this.need('tools.manage', 'Solo administración da de baja herramientas');
    const reason = text(body.reason, 'Motivo de la baja', { max: 500, required: true });
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      if (a.retired_at) fail(409, 'Esta herramienta ya está de baja');
      if (a.pm_id) fail(409, 'Tiene un traslado pendiente: cancélalo o confírmalo antes de darla de baja');
      await db.query("UPDATE inventory.reservations SET status='cancelada', ended_at=now() WHERE asset_id=$1 AND status='activa'", [a.id]);
      await db.query("UPDATE inventory.asset_assignments SET ended_at=now(), ended_reason='baja' WHERE asset_id=$1 AND ended_at IS NULL", [a.id]);
      await db.query('UPDATE inventory.assets SET retired_at=now(), retired_reason=$2, version=version+1, updated_at=now() WHERE id=$1', [a.id, reason]);
      await this.audit(db, 'Herramienta dada de baja', `${a.code} · ${reason}`);
    });
    return this.get(id);
  }

  // A lost or stolen label gets a new token: the old QR stops resolving, the code stays.
  // (A worn label is simply reprinted: same token.)
  async relabel(id, body = {}) {
    this.need('tools.manage');
    const reason = text(body.reason, 'Motivo', { max: 300, required: true });
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      await db.query('UPDATE inventory.assets SET qr_token=$2, label_version=label_version+1, version=version+1, updated_at=now() WHERE id=$1', [a.id, newToken()]);
      await this.audit(db, 'Etiqueta QR sustituida', `${a.code} · etiqueta ${a.label_version} → ${a.label_version + 1} · ${reason}`);
    });
    return this.get(id);
  }

  async labels(ids) {
    this.need('tools.manage');
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isUuid)) fail(400, 'Selecciona entre 1 y 200 herramientas');
    const rows = (await this.pool.query('SELECT id, code, name, qr_token, label_version FROM inventory.assets WHERE id=ANY($1::uuid[]) ORDER BY code', [ids])).rows;
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, url: qrUrl(r.qr_token), labelVersion: r.label_version }));
  }

  async writeKitItems(db, kitId, items) {
    if (!Array.isArray(items) || items.length > 100) fail(400, 'Componentes no válidos (máximo 100)');
    const parsed = items.map((i, n) => {
      const quantity = int(i?.quantity ?? 1, `Cantidad del componente ${n + 1}`, { min: 1, max: 10000 });
      const missing = int(i?.missing ?? 0, `Faltantes del componente ${n + 1}`, { min: 0, max: quantity });
      return { name: text(i?.name, `Componente ${n + 1}`, { max: 160, required: true }), quantity, missing, notes: text(i?.notes, 'Observaciones', { max: 300 }) };
    });
    // Components are configuration, not history: replaced whole, the change audited.
    await db.query('DELETE FROM inventory.kit_items WHERE kit_id=$1', [kitId]);
    for (const [n, i] of parsed.entries()) {
      await db.query('INSERT INTO inventory.kit_items (kit_id, name, quantity, missing, notes, position) VALUES ($1,$2,$3,$4,$5,$6)', [kitId, i.name, i.quantity, i.missing, i.notes, n]);
    }
    return parsed;
  }
  async setKitItems(id, body = {}) {
    this.need('tools.manage');
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      if (a.kind !== 'kit') fail(400, 'Solo un kit tiene componentes');
      const items = await this.writeKitItems(db, a.id, body.items);
      await this.audit(db, 'Componentes de kit modificados', `${a.code} · ${items.length} componentes`);
    });
    return this.get(id);
  }
  // The jefe holding a kit records what is missing from it (only that).
  async setKitMissing(id, itemId, body = {}) {
    this.need('tools.transfer');
    uuid(itemId, 'Componente');
    const missing = int(body.missing, 'Faltantes', { min: 0, max: 10000 });
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      if (!(await this.inScope(db, a))) fail(403, 'Este kit no está en tus obras');
      const it = (await db.query('SELECT name, quantity, missing FROM inventory.kit_items WHERE id=$1 AND kit_id=$2', [itemId, a.id])).rows[0];
      if (!it) fail(404, 'Componente no encontrado');
      if (missing > it.quantity) fail(400, 'No pueden faltar más unidades de las que tiene el kit');
      await db.query('UPDATE inventory.kit_items SET missing=$2 WHERE id=$1', [itemId, missing]);
      await this.audit(db, 'Faltantes de kit registrados', `${a.code} · ${it.name}: ${it.missing} → ${missing}`);
    });
    return this.get(id);
  }

  async parseCustodian(db, c) {
    if (!c) return { user: null, employee: null };
    if (typeof c !== 'object') fail(400, 'Responsable no válido');
    const id = uuid(c.id, 'Responsable');
    if (c.type === 'user') {
      const u = (await db.query("SELECT id FROM users WHERE id=$1 AND role IN ('admin','jefe')", [id])).rows[0];
      if (!u) fail(400, 'Responsable no encontrado');
      return { user: id, employee: null };
    }
    if (c.type === 'employee') {
      if (!(await this.hasTable(db, 'ledens.employees')) || !(await db.query('SELECT 1 FROM ledens.employees WHERE id=$1', [id])).rows.length) fail(400, 'Trabajador no encontrado');
      return { user: null, employee: id };
    }
    fail(400, 'Responsable no válido');
  }

  // ---------- movements ----------

  // POST /api/herramientas/movimientos — send an asset somewhere. It stays where
  // it was until the reception is confirmed; registering it as received at once
  // («recibido ya») is only possible for whoever may confirm it (the receiver
  // picking it up themselves, an admin, or a jefe moving it between their obras).
  async move(body = {}, key) {
    this.need('tools.transfer', 'No tienes permiso para mover herramientas');
    const assetId = uuid(body.assetId, 'Herramienta');
    const purpose = body.purpose || 'traslado';
    if (!PURPOSES.includes(purpose)) fail(400, 'Tipo de movimiento no válido');
    if (purpose === 'correccion' && !this.isAdmin) fail(403, 'Solo administración corrige ubicaciones');
    const notes = text(body.notes, 'Observaciones', { max: 1000 });
    if (purpose === 'correccion' && !notes) fail(400, 'Explica la corrección');
    return this.once(key, 'movimiento', async (db) => {
      const a = await this.loadAsset(db, assetId, { lock: true });
      if (a.retired_at) fail(409, 'Esta herramienta está de baja');
      if (a.pm_id) fail(409, 'Esta herramienta ya tiene un traslado pendiente de recepción');
      if (!(await this.inScope(db, a))) fail(403, 'Esta herramienta no está en tus obras ni bajo tu custodia');
      let toLocationId;
      if (body.toProjectId) {
        const p = uuid(body.toProjectId, 'Obra de destino');
        if (!this.isAdmin && purpose !== 'traslado' && !(await this.isMine(db, p))) fail(403, 'Esa obra no es tuya');
        toLocationId = await this.obraLocation(db, p);
      } else if (purpose === 'devolucion' && !body.toLocationId) {
        toLocationId = await this.systemLocation(db, 'almacen');
      } else {
        toLocationId = uuid(body.toLocationId, 'Destino');
      }
      const to = (await db.query('SELECT id, kind, name, project_id, active FROM inventory.locations WHERE id=$1', [toLocationId])).rows[0];
      if (!to || !to.active) fail(400, 'Destino no encontrado');
      if (to.kind === 'pendiente' && purpose !== 'correccion') fail(400, 'Ese destino solo se usa en correcciones');
      if (purpose === 'devolucion' && to.kind !== 'almacen') fail(400, 'Una devolución va a un almacén');
      if (purpose === 'reparacion' && !['taller', 'proveedor'].includes(to.kind)) fail(400, 'Una reparación va a un taller o a un proveedor');
      // A blocked asset may only travel to be repaired, back to a warehouse, or be corrected.
      if (a.condition !== 'operativa' && !['reparacion', 'devolucion', 'correccion'].includes(purpose)) fail(409, `No se puede asignar: la herramienta está ${a.condition.replace('_', ' ')} hasta que se revise`, { code: 'bloqueada' });
      const custodian = await this.parseCustodian(db, body.toCustodian);
      if (to.id === a.location_id && custodian.user === a.custodian_user_id && custodian.employee === a.custodian_employee_id) fail(400, 'La herramienta ya está ahí y con ese responsable');
      const warnings = [];
      if (to.kind === 'obra') {
        const other = (await db.query(`SELECT starts_on::text, ends_on::text FROM inventory.reservations WHERE asset_id=$1 AND status='activa' AND project_id<>$2
          AND starts_on<=current_date+14 AND ends_on>=current_date ORDER BY starts_on LIMIT 1`, [a.id, to.project_id])).rows[0];
        if (other) warnings.push(`Está reservada para otra obra del ${other.starts_on} al ${other.ends_on}`);
      }
      const m = (await db.query(`INSERT INTO inventory.asset_movements (asset_id, purpose, from_location_id, to_location_id, from_custodian_user_id, from_custodian_employee_id,
          to_custodian_user_id, to_custodian_employee_id, project_id, corrects_movement_id, status, notes, sent_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendiente',$11,$12) RETURNING *`,
      [a.id, purpose, a.location_id, to.id, a.custodian_user_id, a.custodian_employee_id, custodian.user, custodian.employee,
        to.kind === 'obra' ? to.project_id : null, purpose === 'correccion' ? uuid(body.correctsMovementId, 'Movimiento corregido', { required: false }) : null, notes, this.user.id])).rows[0];
      await this.audit(db, purpose === 'correccion' ? 'Ubicación de herramienta corregida' : 'Herramienta enviada', `${a.code} · ${a.loc_name} → ${to.name}${notes ? ` · ${notes}` : ''}`);
      const now = purpose === 'correccion' || (body.receiveNow === true && (await this.canReceive(db, m)));
      if (body.receiveNow === true && !now) warnings.push('Queda pendiente de que el receptor confirme la recepción');
      if (now) await this.applyReception(db, m, a, { notes: null, by: this.user.id });
      return { movement: { id: m.id, status: now ? 'recibido' : 'pendiente' }, warnings, ...(await this.get(a.id, db)) };
    });
  }

  // The reception: only now do location, custodian and assignment change.
  async applyReception(db, m, a, { notes, by }) {
    await db.query("UPDATE inventory.asset_movements SET status='recibido', resolved_by=$2, resolved_at=now(), resolution_notes=$3 WHERE id=$1", [m.id, by, notes]);
    await db.query('UPDATE inventory.assets SET location_id=$2, custodian_user_id=$3, custodian_employee_id=$4, last_movement_at=now(), updated_at=now() WHERE id=$1',
      [m.asset_id, m.to_location_id, m.to_custodian_user_id, m.to_custodian_employee_id]);
    const to = (await db.query('SELECT kind, project_id FROM inventory.locations WHERE id=$1', [m.to_location_id])).rows[0];
    const open = (await db.query('SELECT id, project_id, request_id FROM inventory.asset_assignments WHERE asset_id=$1 AND ended_at IS NULL', [m.asset_id])).rows[0];
    if (to.kind === 'obra') {
      if (open && open.project_id !== to.project_id) await db.query("UPDATE inventory.asset_assignments SET ended_at=now(), ended_reason='traslado' WHERE id=$1", [open.id]);
      if (!open || open.project_id !== to.project_id) {
        const req = m.request_id ? (await db.query('SELECT return_by::text, obra_id FROM inventory.tool_requests WHERE id=$1', [m.request_id])).rows[0] : null;
        await db.query('INSERT INTO inventory.asset_assignments (asset_id, project_id, obra_id, request_id, movement_id, expected_return_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [m.asset_id, to.project_id, req?.obra_id || null, m.request_id, m.id, req?.return_by || null, by]);
      }
      await db.query("UPDATE inventory.reservations SET status='cumplida', ended_at=now() WHERE asset_id=$1 AND project_id=$2 AND status='activa' AND starts_on<=current_date+30", [m.asset_id, to.project_id]);
    } else if (['almacen', 'pendiente'].includes(to.kind) && open) {
      await db.query('UPDATE inventory.asset_assignments SET ended_at=now(), ended_reason=$2 WHERE id=$1', [open.id, to.kind === 'almacen' ? 'devuelta' : 'ubicacion_pendiente']);
    }
    if (m.request_id) await this.syncRequest(db, m.request_id);
    if (open?.request_id && open.request_id !== m.request_id) await this.syncRequest(db, open.request_id);
  }

  async loadMovement(db, id) {
    uuid(id, 'Movimiento');
    const m = (await db.query(`SELECT m.*, l.kind to_location_kind, l.project_id to_location_project, l.name to_name FROM inventory.asset_movements m
      JOIN inventory.locations l ON l.id=m.to_location_id WHERE m.id=$1`, [id])).rows[0];
    if (!m) fail(404, 'Movimiento no encontrado');
    return m;
  }

  // POST /movimientos/:id/recibir — the receiver confirms. With `incident`, it
  // arrived damaged or incomplete: received and reported in one step.
  async receive(id, body = {}, key) {
    this.need('tools.receive', 'No tienes permiso para confirmar recepciones');
    const notes = text(body.notes, 'Observaciones', { max: 1000 });
    if (body.incident) this.need('tools.maintenance.report', 'No tienes permiso para registrar incidencias');
    return this.once(key, `recibir:${id}`, async (db) => {
      const first = await this.loadMovement(db, id);
      const a = await this.loadAsset(db, first.asset_id, { lock: true });
      const m = await this.loadMovement(db, id); // re-read under the asset lock
      if (m.status !== 'pendiente') fail(409, m.status === 'recibido' ? 'Esta recepción ya se confirmó' : 'Este traslado ya no está pendiente');
      if (!(await this.canReceive(db, m))) fail(403, 'Esta entrega no va dirigida a ti ni a tus obras');
      await this.applyReception(db, m, a, { notes, by: this.user.id });
      await this.audit(db, 'Recepción de herramienta confirmada', `${a.code} · ${m.to_name}${notes ? ` · ${notes}` : ''}`);
      const incident = body.incident ? await this.writeIncident(db, a.id, { ...body.incident, movementId: m.id }) : undefined;
      return { movement: { id: m.id, status: 'recibido' }, incident, ...(await this.get(a.id, db)) };
    });
  }

  // Never left: the asset stays where it was. The sender or an admin.
  async cancelMovement(id, body = {}) {
    const reason = text(body.reason, 'Motivo', { max: 500, required: true });
    return this.tx(async (db) => {
      const first = await this.loadMovement(db, id);
      const a = await this.loadAsset(db, first.asset_id, { lock: true });
      const m = await this.loadMovement(db, id);
      if (m.status !== 'pendiente') fail(409, 'Este traslado ya no está pendiente');
      if (!this.isAdmin && m.sent_by !== this.user.id) fail(403, 'Solo quien lo envió o administración cancela un traslado');
      await db.query("UPDATE inventory.asset_movements SET status='cancelado', resolved_by=$2, resolved_at=now(), resolution_notes=$3 WHERE id=$1", [m.id, this.user.id, reason]);
      await this.audit(db, 'Traslado de herramienta cancelado', `${a.code} · ${reason}`);
      if (m.request_id) await this.syncRequest(db, m.request_id);
      return this.get(a.id, db);
    });
  }

  // Left and did not arrive: nobody holds it, it sits in «Ubicación pendiente de
  // confirmar» until someone finds it (a correction) or reports it lost.
  async notDelivered(id, body = {}) {
    const reason = text(body.reason, 'Qué ha pasado', { max: 1000, required: true });
    return this.tx(async (db) => {
      const first = await this.loadMovement(db, id);
      const a = await this.loadAsset(db, first.asset_id, { lock: true });
      const m = await this.loadMovement(db, id);
      if (m.status !== 'pendiente') fail(409, 'Este traslado ya no está pendiente');
      if (!(await this.canReceive(db, m)) && !this.isAdmin && m.sent_by !== this.user.id) fail(403, 'No puedes resolver este traslado');
      const pending = await this.systemLocation(db, 'pendiente');
      await db.query("UPDATE inventory.asset_movements SET status='no_entregado', resolved_by=$2, resolved_at=now(), resolution_notes=$3 WHERE id=$1", [m.id, this.user.id, reason]);
      await db.query('UPDATE inventory.assets SET location_id=$2, custodian_user_id=NULL, custodian_employee_id=NULL, last_movement_at=now(), updated_at=now() WHERE id=$1', [a.id, pending]);
      await this.audit(db, 'Traslado de herramienta no entregado', `${a.code} · ${reason}`);
      if (m.request_id) await this.syncRequest(db, m.request_id);
      return this.get(a.id, db);
    });
  }

  // Movements waiting for a reception: those I must confirm, and those I sent.
  async pendingMovements() {
    this.need('tools.read');
    const db = this.pool;
    const rows = (await db.query(`SELECT m.id, m.asset_id, m.purpose, m.sent_at, m.sent_by, m.to_location_id, m.to_custodian_user_id, m.notes,
        l.kind to_location_kind, l.project_id to_location_project, l.name to_name, f.name from_name, a.code, a.name, s.name sender
      FROM inventory.asset_movements m JOIN inventory.assets a ON a.id=m.asset_id JOIN inventory.locations l ON l.id=m.to_location_id
      LEFT JOIN inventory.locations f ON f.id=m.from_location_id JOIN users s ON s.id=m.sent_by
      WHERE m.status='pendiente' ORDER BY m.sent_at`)).rows;
    const out = { toReceive: [], sent: [] };
    for (const r of rows) {
      const row = { id: r.id, assetId: r.asset_id, code: r.code, name: r.name, purpose: r.purpose, from: r.from_name, to: r.to_name, sentAt: r.sent_at, sender: r.sender, notes: r.notes };
      if (await this.canReceive(db, r)) out.toReceive.push(row);
      else if (r.sent_by === this.user.id || this.can('tools.read.all')) out.sent.push(row);
    }
    return out;
  }

  // ---------- incidents and maintenance ----------

  async writeIncident(db, assetId, body = {}) {
    const kind = body.kind;
    if (!INCIDENT_KINDS.includes(kind)) fail(400, 'Tipo de incidencia no válido');
    const description = text(body.description, 'Descripción', { max: 2000, required: true });
    const blocks = BLOCKING[kind] ? true : body.blocksUse === true;
    const a = await this.loadAsset(db, assetId);
    const inc = (await db.query(`INSERT INTO inventory.asset_incidents (asset_id, kind, description, blocks_use, project_id, movement_id, reported_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [a.id, kind, description, blocks, a.work_project, body.movementId || null, this.user.id])).rows[0];
    // «No apta para uso»: blocked for new reservations, assignments and dispatches until reviewed.
    const next = BLOCKING[kind] || (blocks ? 'averiada' : null);
    const severity = { operativa: 0, en_mantenimiento: 1, averiada: 2, perdida: 3, robada: 3 };
    if (next && severity[next] >= severity[a.condition]) await db.query('UPDATE inventory.assets SET condition=$2, updated_at=now() WHERE id=$1', [a.id, next]);
    await this.audit(db, 'Incidencia de herramienta registrada', `${a.code} · ${kind}${blocks ? ' · no apta para uso' : ''} · ${description.slice(0, 200)}`);
    const affected = blocks ? (await db.query("SELECT count(*)::int n FROM inventory.reservations WHERE asset_id=$1 AND status='activa' AND ends_on>=current_date", [a.id])).rows[0].n : 0;
    return { id: inc.id, blocksUse: blocks, affectedReservations: affected };
  }

  // POST /api/herramientas/:id/incidencias
  async report(assetId, body = {}, key) {
    this.need('tools.maintenance.report', 'No tienes permiso para registrar incidencias');
    uuid(assetId, 'Herramienta');
    return this.once(key, `incidencia:${assetId}`, async (db) => {
      const a = await this.loadAsset(db, assetId, { lock: true });
      if (a.retired_at) fail(409, 'Esta herramienta está de baja');
      const addressedToMe = a.pm_id && a.pm_to_user === this.user.id;
      if (!(await this.inScope(db, a)) && !addressedToMe) fail(403, 'Esta herramienta no está en tus obras ni bajo tu custodia');
      const incident = await this.writeIncident(db, a.id, body);
      return { incident, ...(await this.get(a.id, db)) };
    });
  }

  async incidentPhoto(incidentId, content, mime) {
    uuid(incidentId, 'Incidencia');
    return this.tx(async (db) => {
      const i = (await db.query('SELECT * FROM inventory.asset_incidents WHERE id=$1 FOR UPDATE', [incidentId])).rows[0];
      if (!i) fail(404, 'Incidencia no encontrada');
      if (i.reported_by !== this.user.id && !this.can('tools.maintenance.manage')) fail(403, 'Solo quien la registró añade la foto');
      if (i.photo_key) fail(409, 'Esta incidencia ya tiene foto');
      const key = await this.putPhoto(i.asset_id, content);
      await db.query('UPDATE inventory.asset_incidents SET photo_key=$2, photo_mime=$3 WHERE id=$1', [i.id, key, mime]);
      return { ok: true };
    });
  }

  async putPhoto(assetId, content) {
    if (!this.storage) fail(503, 'El almacenamiento de fotos no está configurado');
    const key = `${assetId}/${crypto.randomUUID()}`;
    await this.storage.put(key, content, 'image/jpeg');
    return key;
  }
  async assetPhoto(id, content, mime) {
    this.need('tools.manage');
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      const key = await this.putPhoto(a.id, content);
      await db.query('UPDATE inventory.assets SET photo_key=$2, photo_mime=$3, updated_at=now() WHERE id=$1', [a.id, key, mime]);
      await this.audit(db, 'Foto de herramienta actualizada', a.code);
    });
    return this.get(id);
  }
  async openPhoto(id, incidentId) {
    this.need('tools.read');
    const a = await this.loadAsset(this.pool, id);
    let key = a.photo_key, mime = a.photo_mime;
    if (incidentId) {
      if (!(await this.inScope(this.pool, a))) fail(404, 'Foto no encontrada');
      const i = (await this.pool.query('SELECT photo_key, photo_mime FROM inventory.asset_incidents WHERE id=$1 AND asset_id=$2', [uuid(incidentId, 'Incidencia'), a.id])).rows[0];
      key = i?.photo_key; mime = i?.photo_mime;
    }
    if (!key || !this.storage) fail(404, 'Foto no encontrada');
    const f = await this.storage.get(key);
    return { ...f, mime };
  }

  // Maintenance: an admin takes the asset to repair (or reviews it) and closes it with a result.
  async openMaintenance(id, body = {}) {
    this.need('tools.maintenance.manage', 'Solo administración gestiona mantenimientos');
    const provider = text(body.provider, 'Taller o proveedor', { max: 160 });
    const notes = text(body.notes, 'Observaciones', { max: 1000 });
    const incidentId = uuid(body.incidentId, 'Incidencia', { required: false });
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      if (a.retired_at) fail(409, 'Esta herramienta está de baja');
      if (['perdida', 'robada'].includes(a.condition)) fail(409, 'Una herramienta perdida o robada no entra en mantenimiento: resuelve primero la incidencia');
      const r = (await db.query(`INSERT INTO inventory.asset_maintenance (asset_id, incident_id, provider, notes, opened_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING RETURNING id`, [a.id, incidentId, provider, notes, this.user.id])).rows[0];
      if (!r) fail(409, 'Ya tiene un mantenimiento abierto');
      await db.query("UPDATE inventory.assets SET condition='en_mantenimiento', updated_at=now() WHERE id=$1", [a.id]);
      await this.audit(db, 'Mantenimiento de herramienta abierto', `${a.code}${provider ? ` · ${provider}` : ''}`);
    });
    return this.get(id);
  }
  async closeMaintenance(id, body = {}) {
    this.need('tools.maintenance.manage', 'Solo administración gestiona mantenimientos');
    const result = body.result;
    if (!['apta', 'baja', 'sigue_averiada'].includes(result)) fail(400, 'Resultado no válido');
    const cost = money(body.cost, 'Coste');
    const notes = text(body.notes, 'Observaciones', { max: 1000, required: result !== 'apta' });
    await this.tx(async (db) => {
      const a = await this.loadAsset(db, id, { lock: true });
      const mt = (await db.query("SELECT id FROM inventory.asset_maintenance WHERE asset_id=$1 AND status='abierto' FOR UPDATE", [a.id])).rows[0];
      if (!mt) fail(409, 'No tiene ningún mantenimiento abierto');
      await db.query(`UPDATE inventory.asset_maintenance SET status='finalizado', result=$2, cost=coalesce($3, cost), notes=coalesce($4, notes), closed_by=$5, closed_at=now() WHERE id=$1`, [mt.id, result, cost, notes, this.user.id]);
      if (result === 'apta') {
        await db.query("UPDATE inventory.asset_incidents SET status='resuelta', resolved_by=$2, resolved_at=now(), resolution='Revisada en mantenimiento: apta para uso' WHERE asset_id=$1 AND status='abierta' AND blocks_use", [a.id, this.user.id]);
        await db.query("UPDATE inventory.assets SET condition='operativa', updated_at=now() WHERE id=$1", [a.id]);
      } else if (result === 'sigue_averiada') {
        await db.query("UPDATE inventory.assets SET condition='averiada', updated_at=now() WHERE id=$1", [a.id]);
      } else {
        if (a.pm_id) fail(409, 'Tiene un traslado pendiente: resuélvelo antes de darla de baja');
        await db.query("UPDATE inventory.reservations SET status='cancelada', ended_at=now() WHERE asset_id=$1 AND status='activa'", [a.id]);
        await db.query("UPDATE inventory.asset_assignments SET ended_at=now(), ended_reason='baja' WHERE asset_id=$1 AND ended_at IS NULL", [a.id]);
        await db.query("UPDATE inventory.assets SET condition='averiada', retired_at=now(), retired_reason=$2, version=version+1, updated_at=now() WHERE id=$1", [a.id, `Baja tras mantenimiento: ${notes}`]);
      }
      await this.audit(db, 'Mantenimiento de herramienta finalizado', `${a.code} · ${result}${notes ? ` · ${notes}` : ''}`);
    });
    return this.get(id);
  }
  // An incident closed without maintenance (a missing accessory replaced, a lost tool found).
  async resolveIncident(incidentId, body = {}) {
    this.need('tools.maintenance.manage', 'Solo administración resuelve incidencias');
    uuid(incidentId, 'Incidencia');
    const resolution = text(body.resolution, 'Resolución', { max: 1000, required: true });
    return this.tx(async (db) => {
      const i = (await db.query("SELECT asset_id FROM inventory.asset_incidents WHERE id=$1 AND status='abierta'", [incidentId])).rows[0];
      if (!i) fail(404, 'Incidencia abierta no encontrada');
      const a = await this.loadAsset(db, i.asset_id, { lock: true });
      await db.query("UPDATE inventory.asset_incidents SET status='resuelta', resolved_by=$2, resolved_at=now(), resolution=$3 WHERE id=$1", [incidentId, this.user.id, resolution]);
      const stillBlocking = (await db.query("SELECT 1 FROM inventory.asset_incidents WHERE asset_id=$1 AND status='abierta' AND blocks_use", [a.id])).rows.length;
      const inMaintenance = (await db.query("SELECT 1 FROM inventory.asset_maintenance WHERE asset_id=$1 AND status='abierto'", [a.id])).rows.length;
      if (!stillBlocking && !inMaintenance && a.condition !== 'operativa' && body.backInService === true) {
        await db.query("UPDATE inventory.assets SET condition='operativa', updated_at=now() WHERE id=$1", [a.id]);
      }
      await this.audit(db, 'Incidencia de herramienta resuelta', `${a.code} · ${resolution}${body.backInService === true ? ' · vuelve a estar operativa' : ''}`);
      return this.get(a.id, db);
    });
  }

  // GET /:id/historial — every movement, assignment, reservation, incident and
  // maintenance of the asset, newest first. Nothing here can be edited.
  async history(id) {
    this.need('tools.read');
    const db = this.pool;
    const a = await this.loadAsset(db, id);
    if (!(await this.inScope(db, a))) fail(403, 'Solo ves el historial de las herramientas de tus obras');
    const q = (sql) => db.query(sql, [a.id]).then((r) => r.rows);
    const [moves, asg, res, inc, mt] = await Promise.all([
      q(`SELECT m.id, m.purpose, m.status, m.sent_at at, m.resolved_at, m.notes, m.resolution_notes, f.name from_name, t.name to_name, s.name sender, r.name resolver, m.corrects_movement_id
         FROM inventory.asset_movements m LEFT JOIN inventory.locations f ON f.id=m.from_location_id JOIN inventory.locations t ON t.id=m.to_location_id
         JOIN users s ON s.id=m.sent_by LEFT JOIN users r ON r.id=m.resolved_by WHERE m.asset_id=$1`),
      q('SELECT id, project_id, starts_at at, ended_at, ended_reason, expected_return_on::text FROM inventory.asset_assignments WHERE asset_id=$1'),
      q('SELECT r.id, r.project_id, r.starts_on::text, r.ends_on::text, r.status, r.created_at at, u.name who FROM inventory.reservations r JOIN users u ON u.id=r.created_by WHERE r.asset_id=$1'),
      q(`SELECT i.id, i.kind, i.description, i.blocks_use, i.status, i.reported_at at, i.resolution, i.resolved_at, u.name who FROM inventory.asset_incidents i JOIN users u ON u.id=i.reported_by WHERE i.asset_id=$1`),
      q('SELECT m.id, m.status, m.result, m.provider, m.notes, m.opened_at at, m.closed_at, m.cost, u.name who FROM inventory.asset_maintenance m JOIN users u ON u.id=m.opened_by WHERE m.asset_id=$1'),
    ]);
    const projects = await this.projects([...asg, ...res].map((x) => x.project_id), db);
    const pname = (pid) => { const p = projects.get(pid); return p ? [p.code, p.name].filter(Boolean).join(' · ') : 'Proyecto'; };
    const showMoney = this.can('tools.manage');
    const events = [
      ...moves.map((m) => ({ type: 'movimiento', id: m.id, at: m.at, purpose: m.purpose, status: m.status, from: m.from_name, to: m.to_name, by: m.sender, resolvedAt: m.resolved_at, resolvedBy: m.resolver, notes: m.notes, resolution: m.resolution_notes, corrects: m.corrects_movement_id })),
      ...asg.map((x) => ({ type: 'asignacion', id: x.id, at: x.at, project: pname(x.project_id), endedAt: x.ended_at, endedReason: x.ended_reason, expectedReturnOn: x.expected_return_on })),
      ...res.map((x) => ({ type: 'reserva', id: x.id, at: x.at, project: pname(x.project_id), startsOn: x.starts_on, endsOn: x.ends_on, status: x.status, by: x.who })),
      ...inc.map((x) => ({ type: 'incidencia', id: x.id, at: x.at, kind: x.kind, description: x.description, blocksUse: x.blocks_use, status: x.status, by: x.who, resolution: x.resolution, resolvedAt: x.resolved_at })),
      ...mt.map((x) => ({ type: 'mantenimiento', id: x.id, at: x.at, status: x.status, result: x.result, provider: x.provider, notes: x.notes, closedAt: x.closed_at, by: x.who, ...(showMoney ? { cost: x.cost } : {}) })),
    ].sort((x, y) => new Date(y.at) - new Date(x.at));
    return { code: a.code, name: a.name, events };
  }
}

Object.assign(HerramientasService.prototype, requestMethods, supervisionMethods);
