import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { FinanzasService } from '../src/finanzas/service.js';
import { createInvitacionesRouter } from '../src/routes/invitaciones.js';
// «Usuarios con acceso» of an obra and «Compartir» (migration 051) on PGlite:
// who may see and change the roles, the cliente principal (always one) and the
// read-only clients, links to share the obra (join, revoke, expiry) and what a
// client sees of the obra (cobrado without the team's figures).
let db, pool, server, base, admin, jefe, otroJefe, titular, lector, nuevo, obraId, ampliacionId, otraObraId;
const ORIGIN = 'https://ledens.test';

const call = (p, who, { method = 'GET', body, as: viewing, origin = ORIGIN } = {}) => fetch(`${base}${p}`, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { origin, 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}), ...(viewing ? { 'x-ledens-view-as': viewing.id } : {}) },
});
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const as = (u) => new PresupuestosService(pool, u);
const userRow = async (id) => (await db.query('SELECT id,email,name,role FROM users WHERE id=$1', [id])).rows[0] || null;
const tokenOf = (url) => url.match(/\/obra-compartida#([A-Za-z0-9_-]{43})$/)?.[1];

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text NOT NULL, password_hash text,
      email_verified boolean NOT NULL DEFAULT false, role text NOT NULL DEFAULT 'client', access_held boolean NOT NULL DEFAULT false, registered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
    CREATE TABLE auth_identities(id bigint GENERATED ALWAYS AS IDENTITY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, provider text, provider_user_id text);
    CREATE TABLE sessions(id bigint GENERATED ALWAYS AS IDENTITY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, token_hash text);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.transaction_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, event_type text NOT NULL, status text NOT NULL,
      reason text, document_id uuid, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, lease_token uuid,
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text);
    CREATE TABLE ledens.project_statuses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
    CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id text, name text, address text, municipio text, customer_id uuid, status_id uuid);
    CREATE TABLE ledens.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL);
    CREATE TABLE ledens.finance_project_permissions (user_id uuid NOT NULL, project_id uuid NOT NULL, PRIMARY KEY (user_id, project_id));`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql', '023_invitaciones_cliente.sql',
    '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '047_auth_handoffs.sql', '048_partidas_eliminadas.sql', '051_obra_enlaces.sql']) {
    await db.exec(await fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8'));
  }
  [admin, jefe, otroJefe, titular, lector, nuevo] = (await db.query(`INSERT INTO users(email,name,role,email_verified,registered_at) VALUES
    ('admin@acc.test','Admin Test','admin',true,now()),('jefe@acc.test','Jefe Test','jefe',true,now()),('jefe2@acc.test','Otro Jefe','jefe',true,now()),
    ('titular@acc.test','Titular Test','client',true,now()),('lector@acc.test','Lector Test','client',true,now()),('nuevo@acc.test','Nuevo Test','client',true,now())
    RETURNING id,email,name,role`)).rows;
  const content = { title: 'Reforma de cocina', chapters: [{ name: 'Obra', items: [{ name: 'Encimera', unit: 'ud', quantity: '1', unitPrice: '1000' }] }] };
  let d = await as(admin).create({ ...content, clientId: titular.id, jefeId: jefe.id });
  obraId = d.id;
  d = await as(admin).send(obraId);
  await as(titular).approve(obraId, { versionId: d.version.id });
  await as(jefe).schedule(obraId, { startDate: '2026-11-02' });
  ampliacionId = (await as(jefe).create({ parentId: obraId, ...content, title: 'Ampliación' })).id;
  await as(jefe).send(ampliacionId);
  otraObraId = (await as(admin).create({ ...content, title: 'Obra de otro jefe', clientId: titular.id, jefeId: otroJefe.id })).id;
  // A read-only client already in the obra (as an accepted invitation would leave them).
  await db.query('INSERT INTO obra_clientes (presupuesto_id, user_id, added_by) VALUES ($1,$2,$3)', [obraId, lector.id, jefe.id]);

  const app = express(); app.use(express.json());
  app.use('/api/invitaciones', createInvitacionesRouter({ pool, origin: ORIGIN,
    authenticate: async (req, res, next) => {
      const u = await userRow(req.get('x-test-user'));
      if (!u) return res.status(401).json({ error: 'No autenticado' });
      req.user = u; next();
    },
    currentUser: (req) => userRow(req.get('x-test-user')),
    findUser: userRow }));
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/invitaciones`;
});
after(async () => { server?.close(); await db?.close(); });

test('only the jefe of the obra or an admin sees who has access, on the obra principal', async () => {
  assert.equal((await call(`/obras/${obraId}/acceso`, null)).status, 401);
  assert.equal((await call(`/obras/${obraId}/acceso`, titular)).status, 403, 'a client never manages access');
  assert.equal((await call(`/obras/${obraId}/acceso`, otroJefe)).status, 404, 'another jefe does not even see the obra');
  assert.equal((await call(`/obras/${ampliacionId}/acceso`, jefe)).status, 400, 'an ampliación is part of its obra');
  const { status, body } = await json(await call(`/obras/${obraId}/acceso`, jefe));
  assert.equal(status, 200);
  assert.deepEqual(body.jefe, { userId: jefe.id, name: 'Jefe Test', email: 'jefe@acc.test' });
  assert.deepEqual(body.miembros.map((m) => [m.email, m.rol, m.estado, m.via]), [['titular@acc.test', 'principal', 'activo', null], ['lector@acc.test', 'lectura', 'activo', 'equipo']]);
  assert.deepEqual(body.can, { roles: true, jefe: false }, 'only an admin changes the jefe');
  assert.equal((await json(await call(`/obras/${obraId}/acceso`, admin))).body.can.jefe, true);
});

test('a read-only client invited and not accepted yet shows what the invitation says, not the account', async () => {
  const r = await call(`/obras/${obraId}`, jefe, { method: 'POST', body: { email: 'NUEVO@acc.test', name: 'Escrito a mano' } });
  assert.equal(r.status, 201);
  const m = (await json(await call(`/obras/${obraId}/acceso`, jefe))).body.miembros.find((x) => x.userId === nuevo.id);
  assert.deepEqual([m.name, m.email, m.estado, m.via], ['Escrito a mano', 'NUEVO@acc.test', 'invitacion', 'invitacion'], 'never «Nuevo Test»: inviting must not tell who has an account');
  assert.ok(!JSON.stringify((await json(await call(`/obras/${obraId}/acceso`, jefe))).body).includes('Nuevo Test'));
});

test('making a read-only client the principal: the previous one becomes read-only, the ampliaciones follow', async () => {
  assert.equal((await call(`/obras/${obraId}/acceso/${lector.id}`, titular, { method: 'PUT', body: { rol: 'principal' } })).status, 403);
  assert.equal((await call(`/obras/${obraId}/acceso/${lector.id}`, jefe, { method: 'PUT', body: { rol: 'principal' }, origin: 'https://evil.test' })).status, 403, 'other origins');
  assert.equal((await call(`/obras/${obraId}/acceso/${lector.id}`, admin, { method: 'PUT', body: { rol: 'principal' }, as: jefe })).status, 403, '«Ver como» only reads');
  assert.equal((await call(`/obras/${obraId}/acceso/${otroJefe.id}`, jefe, { method: 'PUT', body: { rol: 'principal' } })).status, 404, 'only someone with access');
  assert.equal((await call(`/obras/${obraId}/acceso/${lector.id}`, jefe, { method: 'PUT', body: { rol: 'jefe' } })).status, 400);
  const down = await json(await call(`/obras/${obraId}/acceso/${titular.id}`, jefe, { method: 'PUT', body: { rol: 'lectura' } }));
  assert.equal(down.status, 409, 'the obra always has a principal');

  // Before: the ampliación waits for the titular's decision.
  assert.equal((await as(titular).get(ampliacionId)).can.decide, true);
  const { status, body } = await json(await call(`/obras/${obraId}/acceso/${lector.id}`, jefe, { method: 'PUT', body: { rol: 'principal' } }));
  assert.equal(status, 200);
  assert.deepEqual(body.miembros.filter((m) => m.via !== 'invitacion').map((m) => [m.email, m.rol]), [['lector@acc.test', 'principal'], ['titular@acc.test', 'lectura']]);
  const rows = (await db.query('SELECT id, client_id FROM presupuestos WHERE id=$1 OR parent_id=$1', [obraId])).rows;
  assert.ok(rows.length === 2 && rows.every((r) => r.client_id === lector.id), 'the obra and its ampliación');
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2', [obraId, lector.id])).rows[0].n, 0, 'the principal needs no row');
  // Who decides follows.
  assert.equal((await as(lector).get(ampliacionId)).can.decide, true);
  const old = await as(titular).get(ampliacionId);
  assert.equal(old.can.decide, false);
  assert.equal(old.can.comment, false, 'read-only');
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Cliente principal de la obra cambiado'")).rows[0].n, 1);
  // And back, so the other tests keep the titular.
  assert.equal((await call(`/obras/${obraId}/acceso/${titular.id}`, admin, { method: 'PUT', body: { rol: 'principal' } })).status, 200);
});

test('withdrawing a read-only access ends their open invitation too; never the principal', async () => {
  assert.equal((await call(`/obras/${obraId}/acceso/${titular.id}`, jefe, { method: 'DELETE' })).status, 409);
  const { status, body } = await json(await call(`/obras/${obraId}/acceso/${nuevo.id}`, jefe, { method: 'DELETE' }));
  assert.equal(status, 200);
  assert.ok(!body.miembros.some((m) => m.userId === nuevo.id));
  const inv = (await db.query('SELECT revoked_at FROM invitaciones WHERE presupuesto_id=$1 AND user_id=$2', [obraId, nuevo.id])).rows[0];
  assert.ok(inv.revoked_at, 'its link no longer gives the access back');
  assert.equal((await call(`/obras/${obraId}/acceso/${nuevo.id}`, jefe, { method: 'DELETE' })).status, 404);
  assert.equal((await as(nuevo).list()).length, 0);
});

test('a link to share the obra: whoever opens it joins as read-only with their own account', async () => {
  assert.equal((await call(`/obras/${obraId}/enlaces`, titular, { method: 'POST', body: {} })).status, 403);
  assert.equal((await call(`/obras/${obraId}/enlaces`, jefe, { method: 'POST', body: { dias: 5 } })).status, 400);
  const created = await json(await call(`/obras/${obraId}/enlaces`, jefe, { method: 'POST', body: { dias: 7 } }));
  assert.equal(created.status, 201);
  const token = tokenOf(created.body.url);
  assert.ok(token, 'the token travels in the fragment');
  const stored = (await db.query('SELECT token_hash, expires_at FROM obra_enlaces WHERE id=$1', [created.body.enlace.id])).rows[0];
  assert.notEqual(stored.token_hash, token, 'only its hash is kept');
  assert.ok(new Date(stored.expires_at) - Date.now() > 6.9 * 864e5 && new Date(stored.expires_at) - Date.now() < 7.1 * 864e5);
  assert.ok(!JSON.stringify((await json(await call(`/obras/${obraId}/acceso`, jefe))).body).includes(token), 'never shown again');

  // What the page shows, with and without a session.
  let d = await json(await call('/enlace/consultar', null, { method: 'POST', body: { token } }));
  assert.deepEqual([d.status, d.body.obra, d.body.sharedBy, d.body.session], [200, 'Reforma de cocina', 'Jefe Test', null]);
  d = await json(await call('/enlace/consultar', nuevo, { method: 'POST', body: { token } }));
  assert.deepEqual(d.body.session, { email: 'nuevo@acc.test', client: true, member: false });
  assert.equal((await call('/enlace/consultar', null, { method: 'POST', body: { token }, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/enlace/unirse', null, { method: 'POST', body: { token } })).status, 401, 'joining needs an account');

  const joined = await json(await call('/enlace/unirse', nuevo, { method: 'POST', body: { token } }));
  assert.deepEqual(joined, { status: 200, body: { joined: true, obra: 'Reforma de cocina', held: false } });
  assert.equal((await call('/enlace/unirse', nuevo, { method: 'POST', body: { token } }).then(json)).body.joined, false, 'once');
  assert.equal((await call('/enlace/unirse', titular, { method: 'POST', body: { token } }).then(json)).body.joined, false, 'the principal is already in');
  assert.equal((await call('/enlace/unirse', jefe, { method: 'POST', body: { token } }).then(json)).body.code, 'cuenta_equipo', 'staff never join as clients');
  assert.equal((await db.query('SELECT uses FROM obra_enlaces WHERE id=$1', [created.body.enlace.id])).rows[0].uses, 1);
  const row = (await db.query('SELECT enlace_id FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2', [obraId, nuevo.id])).rows[0];
  assert.equal(row.enlace_id, created.body.enlace.id);
  const m = (await json(await call(`/obras/${obraId}/acceso`, jefe))).body.miembros.find((x) => x.userId === nuevo.id);
  assert.deepEqual([m.rol, m.via, m.name], ['lectura', 'enlace', 'Nuevo Test']);

  // Read-only: the obra, its progress and the ampliación, deciding nothing.
  const seen = await as(nuevo).list();
  assert.deepEqual(seen.map((p) => [p.id, p.decides]).sort(), [[obraId, false], [ampliacionId, false]].sort());
  const doc = await as(nuevo).get(obraId);
  assert.ok(doc.obra.chapters[0].items[0].executionPct === 0, 'the progress of each line');
  assert.deepEqual([doc.can.decide, doc.can.comment, doc.can.declare, doc.can.invite], [false, false, false, false]);
  assert.equal('project' in doc, false);
});

test('a revoked, expired or unknown link answers the same; the accesses it gave stay', async () => {
  const { body } = await json(await call(`/obras/${obraId}/enlaces`, admin, { method: 'POST', body: {} }));
  const token = tokenOf(body.url);
  assert.equal((await db.query('SELECT expires_at - created_at > interval \'29 days\' ok FROM obra_enlaces WHERE id=$1', [body.enlace.id])).rows[0].ok, true, '30 days by default');
  const revoked = await json(await call(`/obras/${obraId}/enlaces/${body.enlace.id}/revocar`, jefe, { method: 'POST' }));
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.enlaces.find((e) => e.id === body.enlace.id).status, 'revocado');
  assert.equal((await call(`/obras/${obraId}/enlaces/${body.enlace.id}/revocar`, jefe, { method: 'POST' })).status, 409);
  for (const t of [token, 'x'.repeat(43), 'corto']) {
    const r = await json(await call('/enlace/consultar', null, { method: 'POST', body: { token: t } }));
    assert.deepEqual([r.status, r.body.code], [410, 'enlace_no_valido']);
    assert.equal((await call('/enlace/unirse', lector, { method: 'POST', body: { token: t } })).status, 410);
  }
  const old = (await db.query('SELECT id FROM obra_enlaces WHERE presupuesto_id=$1 AND revoked_at IS NULL', [obraId])).rows[0];
  await db.query("UPDATE obra_enlaces SET expires_at = now() - interval '1 minute' WHERE id=$1", [old.id]);
  const list = (await json(await call(`/obras/${obraId}/acceso`, jefe))).body;
  assert.equal(list.enlaces.find((e) => e.id === old.id).status, 'caducado');
  assert.ok(list.miembros.some((m) => m.userId === nuevo.id), 'who joined keeps the access until the team withdraws it');
  assert.equal((await call(`/obras/${otraObraId}/enlaces/${old.id}/revocar`, admin, { method: 'POST' })).status, 404, 'a link of another obra');
});

test('an account that took a prepared row without proving its email joins, held', async () => {
  const held = (await db.query("INSERT INTO users(email,name,role,access_held,registered_at) VALUES ('held@acc.test','Held','client',true,now()) RETURNING id,email,name,role")).rows[0];
  const { body } = await json(await call(`/obras/${obraId}/enlaces`, jefe, { method: 'POST', body: {} }));
  const r = await json(await call('/enlace/unirse', held, { method: 'POST', body: { token: tokenOf(body.url) } }));
  assert.deepEqual(r.body, { joined: true, obra: 'Reforma de cocina', held: true });
  assert.equal((await as(held).list()).length, 0, 'it sees nothing until the email is proven');
  const m = (await json(await call(`/obras/${obraId}/acceso`, jefe))).body.miembros.find((x) => x.userId === held.id);
  assert.equal(m.estado, 'sin_verificar');
});

test('a client sees what has been paid for the obra only when that figure is the obra\'s alone', async () => {
  const original = FinanzasService.prototype.projectCollections;
  const asked = [];
  FinanzasService.prototype.projectCollections = async function (projectId) { asked.push([projectId, this.user.role]); return { cobrado: '605.00', sinCobrar: '0.00', cobros: 1 }; };
  try {
    assert.equal((await as(titular).get(obraId)).obra.cobrado, null, 'no project, no figure');
    const project = (await db.query("INSERT INTO ledens.projects(project_id,name) VALUES ('P2026-099','Casa') RETURNING id")).rows[0].id;
    await db.query('UPDATE presupuestos SET project_id=$2 WHERE id=$1', [obraId, project]);
    assert.equal((await as(titular).get(obraId)).obra.cobrado, '605.00');
    assert.equal((await as(lector).get(obraId)).obra.cobrado, '605.00', 'read-only clients too');
    assert.deepEqual(asked[0], [project, 'admin'], 'read on the team side: a client never reaches Gestión financiera');
    assert.equal((await as(admin).get(obraId)).obra.cobrado, undefined, 'the team has it on the project page');
    // Another client's presupuesto in the same project: the project's money is not this obra's.
    const x = await as(admin).create({ title: 'Otra', clientId: nuevo.id, projectId: project, chapters: [] });
    assert.equal((await as(titular).get(obraId)).obra.cobrado, null);
    await db.query('DELETE FROM presupuestos WHERE id=$1', [x.id]);
    assert.equal((await as(titular).get(obraId)).obra.cobrado, '605.00');
  } finally {
    FinanzasService.prototype.projectCollections = original;
    await db.query('UPDATE presupuestos SET project_id=NULL WHERE id=$1', [obraId]);
  }
});
