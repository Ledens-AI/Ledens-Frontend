import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { HerramientasService } from '../src/herramientas/service.js';
import { canTransition, REQUEST_TRANSITIONS } from '../src/herramientas/requests.js';
import { createHerramientasRouter } from '../src/routes/herramientas.js';
import { folderStorage } from '../src/obras/storage.js';

// Ledens Tools (migration 043). On PGlite by default, with synthetic rows; with
// TOOLS_TEST_DATABASE_URL (a dedicated, disposable PostgreSQL 16 database, as in
// CI) the same suite also runs the concurrency tests on real connections.
const REAL = process.env.TOOLS_TEST_DATABASE_URL;
const ORIGIN = 'https://ledens.test';
let db, pool, dir, server, base;
let admin, jefe, otroJefe, cliente, casa, ortega, ajena, obraCasa, worker;
let tipoMartillo, tipoLaser, tipoKit, tipoDiscos, almacen, taller;
const migration = (m) => fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8');
const H = (u) => new HerramientasService(pool, u, { storage: folderStorage(dir) });
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let keyN = 0;
const idem = () => `test-key-${process.pid}-${(keyN += 1)}-${Date.now()}`;

const call = (p, who, { method = 'GET', body, headers = {}, as: viewing, origin = ORIGIN } = {}) => fetch(`${base}${p}`, {
  method,
  body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  headers: { origin, ...(body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...(who ? { 'x-test-user': who.id } : {}), ...(viewing ? { 'x-ledens-view-as': viewing.id } : {}), ...headers },
});
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const expectStatus = async (promise, status) => {
  await assert.rejects(promise, (e) => { assert.equal(e.status, status, e.message); return true; });
};

before(async () => {
  if (REAL) {
    if (!/_test$/.test(new URL(REAL).pathname)) throw new Error('TOOLS_TEST_DATABASE_URL must point at a disposable *_test database');
    pool = new pg.Pool({ connectionString: REAL, max: 8 });
    db = { exec: (q) => pool.query(q), query: (...a) => pool.query(...a), close: () => pool.end() };
    await pool.query('DROP SCHEMA IF EXISTS inventory CASCADE; DROP SCHEMA IF EXISTS ledens CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
    pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  }
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.project_statuses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
    CREATE TABLE ledens.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL);
    CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id text, name text, customer_name_source text, address text,
      start_date date, municipio text, customer_id uuid, status_id uuid, end_date date);
    CREATE TABLE ledens.finance_project_permissions (user_id uuid NOT NULL, project_id uuid, can_write boolean NOT NULL DEFAULT false);
    CREATE TABLE ledens.employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, activo boolean, user_id uuid);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '043_herramientas.sql']) await db.exec(await migration(m));
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@t.test','Admin','admin'),('jefe@t.test','Jefe Casa','jefe'),('jefe2@t.test','Jefe Ortega','jefe'),('cliente@t.test','Cliente','client')
    RETURNING id,email,name,role`)).rows;
  [casa, ortega, ajena] = (await db.query(`INSERT INTO ledens.projects(project_id,name) VALUES ('P2026-030','Casa Marbella'),('P2026-031','Ortega y Gasset'),('P2026-032','Ajena') RETURNING id`)).rows.map((r) => r.id);
  worker = (await db.query("INSERT INTO ledens.employees(name, activo) VALUES ('Oficial Pérez', true) RETURNING id")).rows[0].id;
  // jefe runs Casa Marbella (assigned obra), otroJefe runs Ortega y Gasset (finance permission).
  const content = { title: 'Reforma', clientId: cliente.id, chapters: [{ name: 'Obra', items: [{ name: 'Demolición', unit: 'm2', quantity: '10', unitPrice: '10' }] }] };
  obraCasa = (await new PresupuestosService(pool, admin).create({ ...content, jefeId: jefe.id, projectId: casa })).id;
  await db.query('INSERT INTO ledens.finance_project_permissions(user_id, project_id) VALUES ($1,$2)', [otroJefe.id, ortega]);
  almacen = (await db.query("SELECT id FROM inventory.locations WHERE kind='almacen'")).rows[0].id;

  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'herramientas-'));
  const users = Object.fromEntries([admin, jefe, otroJefe, cliente].map((u) => [u.id, u]));
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/herramientas', createHerramientasRouter({ pool, storage: folderStorage(dir), origin: ORIGIN,
    authenticate: (req, res, next) => { const u = users[req.get('x-test-user')]; if (!u) return res.status(401).json({ error: 'No autenticado' }); req.user = { ...u }; next(); },
    findUser: async (id) => users[id] || null }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/herramientas`;
});
after(async () => { server?.close(); await db?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

const newAsset = async (typeId, extra = {}) => (await H(admin).create({ typeId, name: 'Herramienta', ...extra })).herramienta;

test('1 · alta: types, locations and assets with permanent codes; only administración', async () => {
  tipoMartillo = (await H(admin).createType({ name: 'Martillo demoledor', category: 'Demolición' })).id;
  tipoLaser = (await H(admin).createType({ name: 'Nivel láser', category: 'Medición' })).id;
  tipoKit = (await H(admin).createType({ name: 'Kit de fontanería', category: 'Fontanería', tracking: 'kit' })).id;
  tipoDiscos = (await H(admin).createType({ name: 'Disco de corte 230', category: 'Corte', tracking: 'consumible', unit: 'ud', minStock: '20' })).id;
  taller = (await H(admin).createLocation({ kind: 'taller', name: 'Taller Hilti Málaga' })).id;
  await expectStatus(H(admin).createType({ name: 'martillo demoledor', category: 'X' }), 409);

  const r = await json(await call('', admin, { method: 'POST', body: { typeId: tipoMartillo, name: 'Martillo Hilti TE 1000', brand: 'Hilti', model: 'TE 1000', serialNumber: 'SN-1', cost: '1450.50', supplier: 'Hilti', acquiredOn: '2026-01-10' } }));
  assert.equal(r.status, 201);
  assert.match(r.body.herramienta.code, /^LED-TOOL-\d{6}$/);
  assert.equal(r.body.herramienta.status, 'disponible');
  assert.equal(r.body.herramienta.location.name, 'Almacén central');
  assert.equal(r.body.herramienta.cost, '1450.50', 'administración ve el coste');
  const kit = await newAsset(tipoKit, { name: 'Kit fontanería 1', kitPrefix: 'Fontaneria', kitItems: [{ name: 'Llave grifa', quantity: 2 }, { name: 'Cortatubos', quantity: 1 }] });
  assert.match(kit.code, /^KIT-FONTANERIA-\d{3}$/);
  assert.equal(kit.kitItems.length, 2);
  await expectStatus(H(admin).create({ typeId: tipoDiscos, name: 'Discos' }), 400);
  await expectStatus(H(admin).create({ typeId: tipoMartillo, name: 'Alquilado', ownership: 'alquilada' }), 400);

  assert.equal((await call('', jefe, { method: 'POST', body: { typeId: tipoMartillo, name: 'X' } })).status, 403, 'un jefe no da de alta');
  assert.equal((await call('', cliente)).status, 403, 'un cliente no entra en el módulo');
  assert.equal((await call('', null)).status, 401);
});

test('3 · permisos: costs hidden, writes need our origin, «Ver como» only reads, jefes never edit', async () => {
  const a = await newAsset(tipoLaser, { name: 'Láser Bosch', cost: '300' });
  const asJefe = await json(await call(`/${a.id}`, jefe));
  assert.equal(asJefe.status, 200);
  assert.equal(asJefe.body.herramienta.cost, undefined, 'el jefe nunca recibe costes');
  assert.equal(asJefe.body.herramienta.supplier, undefined);
  assert.equal(asJefe.body.herramienta.qrUrl, undefined);
  assert.equal(asJefe.body.actions.manage, false);
  assert.equal((await call(`/${a.id}`, jefe, { method: 'PATCH', body: { name: 'X', version: 1 } })).status, 403);
  assert.equal((await call(`/${a.id}/baja`, jefe, { method: 'POST', body: { reason: 'X' } })).status, 403);
  assert.equal((await call(`/${a.id}`, admin, { method: 'PATCH', body: { name: 'X', version: 1 }, origin: 'https://evil.test' })).status, 403, 'CSRF: otro origen');
  const viewing = await call(`/${a.id}`, admin, { as: jefe });
  assert.equal(viewing.status, 200);
  assert.equal((await viewing.json()).herramienta.cost, undefined, '«Ver como» un jefe responde como el jefe');
  assert.equal((await call('/movimientos', admin, { method: 'POST', as: jefe, body: { assetId: a.id, toProjectId: casa } })).status, 403, '«Ver como» es solo lectura');
  assert.equal((await call('/panel', jefe)).status, 403, 'el panel es de administración');
  // Optimistic edit
  const e1 = await H(admin).update(a.id, { name: 'Láser Bosch GLL', version: a.version });
  assert.equal(e1.herramienta.name, 'Láser Bosch GLL');
  await expectStatus(H(admin).update(a.id, { name: 'Otro', version: a.version }), 409);
});

test('8/9 · transfer and reception: nothing changes until the receiver confirms', async () => {
  const a = await newAsset(tipoMartillo, { name: 'Martillo para Casa' });
  // An admin sends it to Casa Marbella, for the jefe.
  const sent = await H(admin).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id }, purpose: 'entrega' });
  assert.equal(sent.movement.status, 'pendiente');
  assert.equal(sent.herramienta.status, 'en_traslado');
  assert.equal(sent.herramienta.location.name, 'Almacén central', 'sigue en origen hasta la recepción');
  await expectStatus(H(admin).move({ assetId: a.id, toLocationId: taller, purpose: 'reparacion' }), 409);
  // The other jefe cannot receive it; the jefe it is addressed to can.
  await expectStatus(H(otroJefe).receive(sent.movement.id), 403);
  const pend = await H(jefe).pendingMovements();
  assert.ok(pend.toReceive.some((m) => m.id === sent.movement.id));
  const got = await json(await call(`/movimientos/${sent.movement.id}/recibir`, jefe, { method: 'POST', body: { notes: 'Llega bien' } }));
  assert.equal(got.status, 200);
  assert.equal(got.body.herramienta.status, 'asignada');
  assert.equal(got.body.herramienta.custodian.id, jefe.id);
  assert.equal(got.body.herramienta.project.id, casa);
  assert.equal(got.body.herramienta.location.kind, 'obra');
  await expectStatus(H(jefe).receive(sent.movement.id), 409);

  // 2 · by project: the jefe sees it in his obra; the other jefe only «Otra obra», no custodian.
  const mis = await H(jefe).myObras();
  assert.equal(mis.obras.find((o) => o.project.id === casa).assigned >= 1, true);
  const tab = await json(await call(`/obras/${casa}`, jefe));
  assert.ok(tab.body.herramientas.some((h) => h.id === a.id));
  assert.equal((await call(`/obras/${casa}`, otroJefe)).status, 404);
  const seen = (await H(otroJefe).get(a.id)).herramienta;
  assert.equal(seen.location.name, 'Otra obra');
  assert.equal(seen.custodian, null);
  assert.equal(seen.serialNumber, null);
  const filtered = await H(jefe).list({ estado: 'mi_obra' });
  assert.ok(filtered.herramientas.some((h) => h.id === a.id));
  assert.ok(!(await H(otroJefe).list({ estado: 'mi_obra' })).herramientas.some((h) => h.id === a.id));
  assert.ok((await H(otroJefe).list({ estado: 'otras_obras' })).herramientas.some((h) => h.id === a.id));
  assert.ok((await H(jefe).list({ q: 'casa' })).herramientas.some((h) => h.id === a.id), 'búsqueda por nombre');
  assert.ok((await H(jefe).list({ q: a.code.slice(-6) })).herramientas.some((h) => h.id === a.id), 'búsqueda por código');

  // A jefe moves it between people at his own obra and confirms at once (he may receive there).
  const toWorker = await H(jefe).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'employee', id: worker }, receiveNow: true });
  assert.equal(toWorker.movement.status, 'recibido');
  assert.equal(toWorker.herramienta.custodian.name, 'Oficial Pérez');
  // Transfer to another jefe's obra: pending for that jefe.
  const t = await H(jefe).move({ assetId: a.id, toProjectId: ortega, purpose: 'traslado' });
  assert.equal(t.movement.status, 'pendiente');
  await expectStatus(H(jefe).receive(t.movement.id), 403);
  const r2 = await H(otroJefe).receive(t.movement.id);
  assert.equal(r2.herramienta.project.id, ortega);
  assert.equal(r2.herramienta.custodian, null, 'llega a la obra sin responsable personal');
  // The previous assignment was closed and a new one opened.
  const asg = (await db.query('SELECT project_id, ended_at FROM inventory.asset_assignments WHERE asset_id=$1 ORDER BY starts_at', [a.id])).rows;
  assert.deepEqual(asg.map((x) => [x.project_id, !!x.ended_at]), [[casa, true], [ortega, false]]);
});

test('8 · cancel and «no entregado»: exceptions of a transfer', async () => {
  const a = await newAsset(tipoLaser, { name: 'Láser para cancelar' });
  const s = await H(admin).move({ assetId: a.id, toProjectId: casa });
  await expectStatus(H(jefe).cancelMovement(s.movement.id, { reason: 'x' }), 403);
  const c = await H(admin).cancelMovement(s.movement.id, { reason: 'Se queda en almacén' });
  assert.equal(c.herramienta.status, 'disponible');
  assert.equal(c.herramienta.location.name, 'Almacén central');
  const s2 = await H(admin).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } });
  const nd = await H(jefe).notDelivered(s2.movement.id, { reason: 'No ha llegado en la furgoneta' });
  assert.equal(nd.herramienta.location.kind, 'pendiente');
  assert.equal(nd.herramienta.location.name, 'Ubicación pendiente de confirmar');
  // An admin corrects it once found (a new movement, never an edit of the old one).
  const fix = await H(admin).move({ assetId: a.id, toLocationId: almacen, purpose: 'correccion', notes: 'Estaba en el almacén', correctsMovementId: s2.movement.id });
  assert.equal(fix.movement.status, 'recibido');
  await expectStatus(H(jefe).move({ assetId: a.id, toLocationId: almacen, purpose: 'correccion', notes: 'x' }), 403);
});

test('10 · return to the warehouse: pending for administración, ends the assignment', async () => {
  const a = await newAsset(tipoMartillo, { name: 'Martillo a devolver' });
  await H(admin).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } }).then((s) => H(jefe).receive(s.movement.id));
  const dev = await H(jefe).move({ assetId: a.id, purpose: 'devolucion' });
  assert.equal(dev.movement.status, 'pendiente');
  assert.equal((await H(jefe).get(a.id)).actions.receive, false, 'el jefe no confirma la llegada al almacén');
  const back = await H(admin).receive(dev.movement.id);
  assert.equal(back.herramienta.status, 'disponible');
  assert.equal(back.herramienta.assignment, null);
});

test('11/12 · incidents block the asset until reviewed; maintenance brings it back', async () => {
  const a = await newAsset(tipoMartillo, { name: 'Martillo averiado' });
  await H(admin).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } }).then((s) => H(jefe).receive(s.movement.id));
  await expectStatus(H(otroJefe).report(a.id, { kind: 'averia', description: 'x' }), 403);
  const rep = await json(await call(`/${a.id}/incidencias`, jefe, { method: 'POST', body: { kind: 'averia', description: 'No percute' } }));
  assert.equal(rep.status, 201);
  assert.equal(rep.body.incident.blocksUse, true);
  assert.equal(rep.body.herramienta.status, 'averiada');
  // Photo of the incident: JPEG checked from the bytes.
  const jpeg = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(64, 7), Buffer.from('ffd9', 'hex')]);
  assert.equal((await call(`/incidencias/${rep.body.incident.id}/foto`, jefe, { method: 'POST', body: Buffer.from('MZ not an image'), headers: { 'content-type': 'application/octet-stream' } })).status, 415);
  assert.equal((await call(`/incidencias/${rep.body.incident.id}/foto`, jefe, { method: 'POST', body: jpeg, headers: { 'content-type': 'application/octet-stream' } })).status, 200);
  const ph = await call(`/${a.id}/incidencias/${rep.body.incident.id}/foto`, jefe);
  assert.equal(ph.status, 200);
  assert.equal(ph.headers.get('content-type'), 'image/jpeg');
  // Blocked: no transfer to another obra, no reservation, but it may go to the workshop.
  await expectStatus(H(jefe).move({ assetId: a.id, toProjectId: ortega }), 409);
  await expectStatus(H(admin).reserve({ assetId: a.id, projectId: ortega, startsOn: plus(5), endsOn: plus(8) }), 409);
  const avail = await H(jefe).availability({ tipo: tipoMartillo, desde: plus(1), hasta: plus(3) });
  assert.ok(!avail.candidates.some((c) => c.id === a.id), 'una averiada no aparece como disponible');
  await H(jefe).move({ assetId: a.id, toLocationId: taller, purpose: 'reparacion' }).then((m) => H(admin).receive(m.movement.id));
  await expectStatus(H(jefe).openMaintenance(a.id, {}), 403);
  const open = await H(admin).openMaintenance(a.id, { provider: 'Hilti', incidentId: rep.body.incident.id });
  assert.equal(open.herramienta.status, 'en_mantenimiento');
  const closed = await H(admin).closeMaintenance(a.id, { result: 'apta', cost: '80' });
  assert.equal(closed.herramienta.condition, 'operativa');
  assert.equal(closed.herramienta.incidents.length, 0, 'la incidencia queda resuelta');
  // Loss
  const lost = await H(admin).report(a.id, { kind: 'perdida', description: 'No aparece' });
  assert.equal(lost.herramienta.status, 'perdida');
});

test('4/5/6/7 · requests: availability, approval (partial), reservations and conflicts', async () => {
  const m1 = await newAsset(tipoLaser, { name: 'Láser A' });
  const m2 = await newAsset(tipoLaser, { name: 'Láser B' });
  const from = plus(10), to = plus(15);
  const av = await json(await call(`/disponibilidad?tipo=${tipoLaser}&desde=${from}&hasta=${to}&proyecto=${casa}`, jefe));
  assert.equal(av.status, 200);
  assert.ok(av.body.available >= 2);
  // A jefe only asks for his obras.
  await expectStatus(H(jefe).createRequest({ projectId: ortega, neededFrom: from, returnBy: to, items: [{ typeId: tipoLaser, quantity: 1 }] }), 403);
  await expectStatus(H(jefe).createRequest({ projectId: casa, neededFrom: to, returnBy: from, items: [{ typeId: tipoLaser, quantity: 1 }] }), 400);
  // 13 · the same Idempotency-Key twice → one request.
  const k = idem();
  const body = { projectId: casa, obraId: obraCasa, neededFrom: from, returnBy: to, notes: 'Replanteo', items: [{ typeId: tipoLaser, quantity: 3 }, { typeId: tipoMartillo, quantity: 1 }] };
  const r1 = await json(await call('/solicitudes', jefe, { method: 'POST', body, headers: { 'idempotency-key': k } }));
  const r2 = await json(await call('/solicitudes', jefe, { method: 'POST', body, headers: { 'idempotency-key': k } }));
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.replayed, true);
  assert.equal(r1.body.solicitud.id, r2.body.solicitud.id);
  assert.equal((await db.query('SELECT count(*)::int n FROM inventory.tool_requests WHERE project_id=$1', [casa])).rows[0].n, 1);
  const req = r1.body.solicitud;
  assert.equal(req.status, 'solicitada');
  // The jefe cannot approve, not even his own.
  assert.equal((await call(`/solicitudes/${req.id}/aprobar`, jefe, { method: 'POST', body: { items: [] } })).status, 403);
  // The admin's view suggests free units per line.
  const view = await H(admin).getRequest(req.id);
  assert.ok(view.suggestions[0].candidates.some((c) => c.id === m1.id));
  const lineLaser = req.items[0].id;
  // Partial approval needs a reason.
  await expectStatus(H(admin).approveRequest(req.id, { items: [{ itemId: lineLaser, assetIds: [m1.id, m2.id] }] }), 400);
  const ok = await H(admin).approveRequest(req.id, { items: [{ itemId: lineLaser, assetIds: [m1.id, m2.id] }], reason: 'Solo quedan dos láseres; martillo sin stock' });
  assert.equal(ok.solicitud.status, 'parcialmente_aprobada');
  assert.equal(ok.solicitud.items[0].quantityApproved, 2);
  assert.equal(ok.solicitud.items[1].quantityApproved, 0);
  assert.equal(ok.solicitud.reservations.length, 2);
  assert.equal((await H(jefe).get(m1.id)).herramienta.status, 'reservada');
  await expectStatus(H(admin).approveRequest(req.id, { items: [{ itemId: lineLaser, assetIds: [m1.id] }] }), 409);

  // 7 · conflicts: another obra cannot reserve m1 for overlapping dates; adjacent dates are fine.
  await expectStatus(H(admin).reserve({ assetId: m1.id, projectId: ortega, startsOn: plus(14), endsOn: plus(20) }), 409);
  const after = await H(admin).reserve({ assetId: m1.id, projectId: ortega, startsOn: plus(16), endsOn: plus(20) });
  assert.equal(after.herramienta.reservations.length, 2);
  const other = await H(otroJefe).createRequest({ projectId: ortega, neededFrom: from, returnBy: to, items: [{ typeId: tipoLaser, quantity: 1 }] });
  const conflict = await json(await call(`/solicitudes/${other.solicitud.id}/aprobar`, admin, { method: 'POST', body: { items: [{ itemId: other.solicitud.items[0].id, assetIds: [m2.id] }] } }));
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /reservada/);
  assert.equal(conflict.body.conflicts[0].assetId, m2.id);
  const rejected = await H(admin).rejectRequest(other.solicitud.id, { reason: 'Sin unidades libres esas fechas' });
  assert.equal(rejected.solicitud.status, 'rechazada');
  await expectStatus(H(admin).approveRequest(other.solicitud.id, { items: [{ itemId: other.solicitud.items[0].id, assetIds: [m2.id] }] }), 409);

  // Dispatch → en traslado → the jefe receives both → entregada → returns → finalizada.
  await expectStatus(H(admin).finishRequest(req.id), 409);
  const disp = await H(admin).dispatchRequest(req.id, {}, idem());
  assert.equal(disp.solicitud.status, 'en_traslado');
  assert.equal(disp.solicitud.movements.length, 2);
  for (const m of disp.solicitud.movements) await H(jefe).receive(m.id);
  const delivered = await H(jefe).getRequest(req.id);
  assert.equal(delivered.solicitud.status, 'entregada');
  assert.ok(delivered.solicitud.reservations.every((x) => x.status === 'cumplida'));
  const asg = (await H(jefe).get(m1.id)).herramienta.assignment;
  assert.equal(asg.expectedReturnOn, to, 'la asignación lleva la fecha de devolución de la solicitud');
  for (const id of [m1.id, m2.id]) await H(jefe).move({ assetId: id, purpose: 'devolucion' }).then((m) => H(admin).receive(m.movement.id));
  assert.equal((await H(jefe).getRequest(req.id)).solicitud.status, 'finalizada');
  // Drafts and cancellation.
  const draft = await H(jefe).createRequest({ projectId: casa, neededFrom: from, returnBy: to, draft: true, items: [{ typeId: tipoKit, quantity: 1 }] });
  assert.equal(draft.solicitud.status, 'borrador');
  await expectStatus(H(otroJefe).submitRequest(draft.solicitud.id), 404);
  assert.equal((await H(jefe).submitRequest(draft.solicitud.id)).solicitud.status, 'solicitada');
  assert.equal((await H(jefe).cancelRequest(draft.solicitud.id, { reason: 'Ya no hace falta' })).solicitud.status, 'cancelada');
  const mine = await H(jefe).listRequests({ mias: '1' });
  assert.ok(mine.solicitudes.length >= 2);
  assert.ok(!(await H(otroJefe).listRequests({})).solicitudes.some((s) => s.id === req.id), 'el otro jefe no ve solicitudes ajenas');
});

test('request transitions are a closed table', () => {
  assert.equal(canTransition('solicitada', 'entregada'), false);
  assert.equal(canTransition('borrador', 'aprobada'), false);
  assert.equal(canTransition('aprobada', 'en_traslado'), true);
  for (const end of ['rechazada', 'finalizada', 'cancelada']) assert.deepEqual(REQUEST_TRANSITIONS[end], []);
});

test('13 · idempotent movements and receptions on a retry', async () => {
  const a = await newAsset(tipoLaser, { name: 'Láser reintento' });
  const k = idem();
  const one = await json(await call('/movimientos', admin, { method: 'POST', body: { assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } }, headers: { 'idempotency-key': k } }));
  const two = await json(await call('/movimientos', admin, { method: 'POST', body: { assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } }, headers: { 'idempotency-key': k } }));
  assert.equal(one.status, 201);
  assert.equal(two.status, 200);
  assert.equal(one.body.movement.id, two.body.movement.id);
  assert.equal((await db.query('SELECT count(*)::int n FROM inventory.asset_movements WHERE asset_id=$1 AND purpose<>$2', [a.id, 'alta'])).rows[0].n, 1);
  const rk = idem();
  assert.equal((await call(`/movimientos/${one.body.movement.id}/recibir`, jefe, { method: 'POST', body: {}, headers: { 'idempotency-key': rk } })).status, 200);
  const again = await json(await call(`/movimientos/${one.body.movement.id}/recibir`, jefe, { method: 'POST', body: {}, headers: { 'idempotency-key': rk } }));
  assert.equal(again.status, 200, 'el reintento de una recepción ya guardada no da error');
  assert.equal(again.body.replayed, true);
  assert.equal((await call('/movimientos', admin, { method: 'POST', body: { assetId: a.id, toLocationId: almacen, purpose: 'devolucion' }, headers: { 'idempotency-key': k } })).status, 200, 'la clave devuelve la primera respuesta');
  assert.equal((await call(`/movimientos/${one.body.movement.id}/recibir`, admin, { method: 'POST', body: {}, headers: { 'idempotency-key': k } })).status, 422, 'una clave no vale para otra operación');
});

test('15 · history is append-only and complete', async () => {
  const a = await newAsset(tipoMartillo, { name: 'Martillo historial' });
  const s = await H(admin).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } });
  await H(jefe).receive(s.movement.id);
  await H(jefe).report(a.id, { kind: 'accesorio_faltante', description: 'Falta el cincel plano' });
  await assert.rejects(db.query('DELETE FROM inventory.asset_movements WHERE id=$1', [s.movement.id]), /no se borra/);
  await assert.rejects(db.query("UPDATE inventory.asset_movements SET to_location_id=$2 WHERE id=$1", [s.movement.id, almacen]), /no se modifica/);
  await assert.rejects(db.query('DELETE FROM inventory.assets WHERE id=$1', [a.id]), /no se borra/);
  await assert.rejects(db.query(`INSERT INTO inventory.asset_movements (asset_id, purpose, to_location_id, status, sent_by) VALUES ($1,'traslado',$2,'pendiente',$3),($1,'traslado',$2,'pendiente',$3)`, [a.id, almacen, admin.id]), /duplicate|unique/i, 'un solo traslado pendiente por herramienta');
  const h = await json(await call(`/${a.id}/historial`, jefe));
  assert.equal(h.status, 200);
  const types = h.body.events.map((e) => e.type);
  for (const t of ['movimiento', 'asignacion', 'incidencia']) assert.ok(types.includes(t), t);
  assert.equal(h.body.events.filter((e) => e.type === 'movimiento').length, 2, 'alta + entrega');
  assert.equal((await call(`/${a.id}/historial`, otroJefe)).status, 403);
  const logged = (await db.query("SELECT action FROM audit_log WHERE detail LIKE $1 ORDER BY id", [`${a.code}%`])).rows.map((r) => r.action);
  assert.deepEqual(logged.slice(0, 4), ['Herramienta dada de alta', 'Herramienta enviada', 'Recepción de herramienta confirmada', 'Incidencia de herramienta registrada']);
});

test('QR: opaque token, resolves to the asset, replaced labels stop working, admin-only print', async () => {
  const a = await newAsset(tipoLaser, { name: 'Láser QR' });
  const full = (await H(admin).get(a.id)).herramienta;
  const token = full.qrUrl.split('/h/')[1];
  assert.match(full.qrUrl, /^https:\/\/.+\/h\/[A-Za-z0-9_-]{12,}$/);
  assert.ok(!full.qrUrl.includes(a.code) && !full.qrUrl.includes(a.id), 'el QR no lleva datos del activo');
  assert.equal((await json(await call(`/etiqueta/${token}`, jefe))).body.id, a.id);
  assert.equal((await call(`/etiqueta/${token}`, cliente)).status, 403, 'escanear no da permisos');
  assert.equal((await call(`/etiqueta/${token}`, null)).status, 401);
  const svg = await call(`/${a.id}/qr.svg`, admin);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.match(await svg.text(), /^<svg/);
  assert.equal((await call(`/${a.id}/qr.svg`, jefe)).status, 403);
  const labels = await json(await call('/etiquetas', admin, { method: 'POST', body: { ids: [a.id] } }));
  assert.equal(labels.body[0].code, a.code);
  const re = await H(admin).relabel(a.id, { reason: 'Etiqueta arrancada' });
  assert.equal(re.herramienta.labelVersion, 2);
  assert.equal(re.herramienta.code, a.code, 'el código no cambia');
  assert.equal((await call(`/etiqueta/${token}`, jefe)).status, 404, 'la etiqueta sustituida deja de funcionar');
  assert.equal((await call(`/${a.code}`, jefe)).status, 200, 'búsqueda manual por código');
});

test('dashboard, alerts, consumables, kits and physical counts', async () => {
  const d = await json(await call('/panel', admin));
  assert.equal(d.status, 200);
  assert.ok(d.body.kpis.total > 0);
  for (const k of ['disponibles', 'asignados', 'reservados', 'enTraslado', 'enMantenimiento', 'extraviados', 'solicitudesPendientes', 'devolucionesVencidas']) assert.equal(typeof d.body.kpis[k], 'number', k);
  // An overdue return shows up for the admin and the jefe.
  const a = await newAsset(tipoMartillo, { name: 'Martillo vencido' });
  await H(admin).move({ assetId: a.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } }).then((s) => H(jefe).receive(s.movement.id));
  await db.query("UPDATE inventory.asset_assignments SET expected_return_on=current_date-1 WHERE asset_id=$1 AND ended_at IS NULL", [a.id]);
  assert.ok((await H(admin).dashboard()).overdue.some((o) => o.asset.id === a.id));
  assert.ok((await H(jefe).alerts()).avisos.some((x) => x.kind === 'vencida'));
  assert.ok(!(await H(otroJefe).alerts()).avisos.some((x) => x.kind === 'vencida'), 'cada jefe ve sus avisos');
  // Consumables: stock and minimum.
  await H(admin).adjustConsumable({ typeId: tipoDiscos, locationId: almacen, delta: '25', reason: 'Compra' });
  const casaLoc = (await db.query("SELECT id FROM inventory.locations WHERE project_id=$1", [casa])).rows[0].id;
  await H(admin).adjustConsumable({ typeId: tipoDiscos, locationId: casaLoc, delta: '10', reason: 'Envío a obra' });
  await H(jefe).adjustConsumable({ typeId: tipoDiscos, locationId: casaLoc, delta: '-4', reason: 'Consumo' });
  await expectStatus(H(jefe).adjustConsumable({ typeId: tipoDiscos, locationId: casaLoc, delta: '5', reason: 'x' }), 403);
  await expectStatus(H(jefe).adjustConsumable({ typeId: tipoDiscos, locationId: casaLoc, delta: '-50', reason: 'x' }), 409);
  const c = (await H(jefe).consumables()).consumibles.find((x) => x.id === tipoDiscos);
  assert.equal(c.total, '31.00');
  assert.equal(c.low, false);
  // Kit: the jefe holding it records what is missing.
  const kit = (await H(admin).list({ q: 'KIT-FONTANERIA' })).herramientas[0];
  await H(admin).move({ assetId: kit.id, toProjectId: casa, toCustodian: { type: 'user', id: jefe.id } }).then((s) => H(jefe).receive(s.movement.id));
  const item = (await H(jefe).get(kit.id)).herramienta.kitItems[0];
  const k2 = await H(jefe).setKitMissing(kit.id, item.id, { missing: 1 });
  assert.equal(k2.herramienta.kitItems[0].missing, 1);
  await expectStatus(H(otroJefe).setKitMissing(kit.id, item.id, { missing: 0 }), 403);
  // Count of the warehouse.
  const count = await H(admin).startCount({ locationId: almacen });
  const inWarehouse = (await H(admin).list({ ubicacion: almacen })).herramientas;
  await H(admin).countSeen(count.count.id, { code: inWarehouse[0].code });
  const closed = await H(admin).closeCount(count.count.id);
  assert.equal(closed.count.status, 'cerrado');
  assert.equal(closed.seen, 1);
  assert.equal(closed.missing.length, closed.expected - 1);
});

test('CSV import: validated whole, simulated first, nothing written on any error', async () => {
  const bad = 'tipo;categoria;nombre;propiedad;fecha_adquisicion;ubicacion\nAmoladora;Corte;Radial Makita;propia;2026-02-30;\nAmoladora;Corte;;propia;;\nAmoladora;Corte;Radial 2;regalada;;\nAmoladora;Corte;Radial 3;propia;;Almacén Norte';
  const r = await json(await call('/importar?simular=1', admin, { method: 'POST', body: bad, headers: { 'content-type': 'text/csv' } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.valid, false);
  assert.deepEqual(r.body.errors.map((e) => e.line), [2, 3, 4, 5]);
  const good = 'tipo;categoria;seguimiento;nombre;marca;numero_serie;coste;ubicacion\nAmoladora;Corte;individual;Radial Makita 230;Makita;MK-1;"120,50";Almacén central\nAmoladora;Corte;individual;Radial Makita 125;Makita;MK-2;;';
  const sim = await json(await call('/importar?simular=1', admin, { method: 'POST', body: good, headers: { 'content-type': 'text/csv' } }));
  assert.equal(sim.body.valid, true);
  assert.equal(sim.body.created, 0);
  const before = (await db.query('SELECT count(*)::int n FROM inventory.assets')).rows[0].n;
  const done = await json(await call('/importar', admin, { method: 'POST', body: good, headers: { 'content-type': 'text/csv' } }));
  assert.equal(done.body.created, 2);
  assert.equal((await db.query('SELECT count(*)::int n FROM inventory.assets')).rows[0].n, before + 2);
  assert.equal((await call('/importar', jefe, { method: 'POST', body: good, headers: { 'content-type': 'text/csv' } })).status, 403);
});

test('14 · concurrency on real connections: one unit, two approvals / two transfers at once', { skip: !REAL && 'needs TOOLS_TEST_DATABASE_URL (PostgreSQL 16, as in CI)' }, async () => {
  const u = await newAsset(tipoMartillo, { name: 'Martillo disputado' });
  const from = plus(30), to = plus(35);
  const rA = await H(jefe).createRequest({ projectId: casa, neededFrom: from, returnBy: to, items: [{ typeId: tipoMartillo, quantity: 1 }] });
  const rB = await H(otroJefe).createRequest({ projectId: ortega, neededFrom: plus(32), returnBy: plus(40), items: [{ typeId: tipoMartillo, quantity: 1 }] });
  const results = await Promise.allSettled([
    H(admin).approveRequest(rA.solicitud.id, { items: [{ itemId: rA.solicitud.items[0].id, assetIds: [u.id] }] }),
    H(admin).approveRequest(rB.solicitud.id, { items: [{ itemId: rB.solicitud.items[0].id, assetIds: [u.id] }] }),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1, 'solo una aprobación gana');
  assert.equal(results.find((x) => x.status === 'rejected').reason.status, 409);
  assert.equal((await db.query("SELECT count(*)::int n FROM inventory.reservations WHERE asset_id=$1 AND status='activa'", [u.id])).rows[0].n, 1);

  const v = await newAsset(tipoLaser, { name: 'Láser disputado' });
  const moves = await Promise.allSettled([
    H(admin).move({ assetId: v.id, toProjectId: casa }),
    H(admin).move({ assetId: v.id, toProjectId: ortega }),
    H(admin).move({ assetId: v.id, toLocationId: taller, purpose: 'reparacion' }),
  ]);
  assert.equal(moves.filter((x) => x.status === 'fulfilled').length, 1, 'un solo traslado a la vez');
  assert.ok(moves.filter((x) => x.status === 'rejected').every((x) => x.reason.status === 409));
  // Two receptions of the same movement: one wins, no second assignment.
  const m = moves.find((x) => x.status === 'fulfilled').value.movement.id;
  const recv = await Promise.allSettled([H(admin).receive(m), H(admin).receive(m)]);
  assert.equal(recv.filter((x) => x.status === 'fulfilled').length, 1);
  assert.ok((await db.query('SELECT count(*)::int n FROM inventory.asset_assignments WHERE asset_id=$1 AND ended_at IS NULL', [v.id])).rows[0].n <= 1);
  // The same Idempotency-Key sent twice at once: one movement, same answer.
  const w = await newAsset(tipoLaser, { name: 'Láser doble toque' });
  const k = idem();
  const twice = await Promise.all([H(admin).move({ assetId: w.id, toProjectId: casa }, k), H(admin).move({ assetId: w.id, toProjectId: casa }, k)]);
  assert.equal(twice[0].movement.id, twice[1].movement.id);
});
