import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { AlertService } from '../src/notifications/service.js';
import { hashToken } from '../src/auth/sessions.js';
import { hashPassword } from '../src/auth/passwords.js';
import { LIMITS, appUrl, describe, acceptWithPassword, acceptWithSession, checkIdentity, acceptWithIdentity } from '../src/invitaciones/service.js';
import { createInvitacionesRouter } from '../src/routes/invitaciones.js';
// Invitaciones de cliente on PGlite (migrations 020–023, with the users,
// sessions, audit_log and mail-queue tables they hang from): who may invite,
// what happens to new and existing accounts, the one-time link and the queue.
// The session cookie of a login lives in auth: test/invitaciones-auth.test.js.
let db, pool, server, base, admin, jefe, otroJefe, cliente, obraId, otraObraId, ampliacionId;
const ORIGIN = 'https://ledens.test';
const users = {};

const call = (p, who, { method = 'GET', body, as: viewing, origin = ORIGIN } = {}) => fetch(`${base}${p}`, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { origin, 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}), ...(viewing ? { 'x-ledens-view-as': viewing.id } : {}) },
});
const invite = (who, body, id = obraId) => call(`/obras/${id}`, who, { method: 'POST', body });
const userByEmail = async (email) => (await db.query('SELECT * FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
// What the mail sender gets: the message and the token in its link.
async function claimLinks() {
  const { messages } = await new AlertService(pool).claim();
  return messages.map((m) => ({ ...m, token: m.html.match(/\/invitacion#([A-Za-z0-9_-]{43})/)?.[1] }));
}
const pending = () => db.query("UPDATE ledens.transaction_alerts SET delivered_at=now() WHERE delivered_at IS NULL");

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
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql']) {
    await db.exec(await fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8'));
  }
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role,email_verified) VALUES
    ('admin@inv.test','Admin Test','admin',true),('jefe@inv.test','Jefe Test','jefe',true),('jefe2@inv.test','Otro Jefe','jefe',true),
    ('titular@inv.test','Titular Test','client',true) RETURNING id,email,name,role`)).rows;
  const as = (u) => new PresupuestosService(pool, u);
  const content = { title: 'Reforma de cocina', chapters: [{ name: 'Obra', items: [{ name: 'Encimera', unit: 'ud', quantity: '1', unitPrice: '900' }] }] };
  let d = await as(admin).create({ ...content, clientId: cliente.id, jefeId: jefe.id });
  obraId = d.id;
  d = await as(admin).send(obraId);
  await as(cliente).approve(obraId, { versionId: d.version.id });
  await as(jefe).schedule(obraId, { startDate: '2026-11-02' });
  ampliacionId = (await as(jefe).create({ parentId: obraId, ...content, title: 'Ampliación' })).id;
  otraObraId = (await as(admin).create({ ...content, title: 'Obra de otro jefe', clientId: cliente.id, jefeId: otroJefe.id })).id;
  await as(admin).send(otraObraId);

  const app = express(); app.use(express.json());
  app.use('/api/invitaciones', createInvitacionesRouter({ pool, origin: ORIGIN,
    authenticate: async (req, res, next) => {
      const id = req.get('x-test-user');
      const u = id && (await db.query('SELECT id,email,name,role FROM users WHERE id=$1', [id])).rows[0];
      if (!u) return res.status(401).end();
      req.user = u; next();
    },
    findUser: async (id) => (await db.query('SELECT id,email,name,role FROM users WHERE id=$1', [id])).rows[0] || null }));
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/invitaciones`;
});
after(async () => { server?.close(); await db?.close(); });

test('only the jefe assigned or an admin invites, only to the obra principal, never with another role', async () => {
  assert.equal((await invite(null, { email: 'x@inv.test' })).status, 401);
  assert.equal((await invite(cliente, { email: 'x@inv.test' })).status, 403, 'a client cannot invite');
  assert.equal((await invite(otroJefe, { email: 'x@inv.test' })).status, 404, 'another jefe does not even see the obra');
  assert.equal((await invite(jefe, { email: 'x@inv.test' }, otraObraId)).status, 404, 'nor may a jefe invite to an obra that is not theirs');
  assert.equal((await invite(jefe, { email: 'x@inv.test' }, ampliacionId)).status, 400, 'an ampliación is part of its obra');
  assert.equal((await call(`/obras/${obraId}`, jefe, { method: 'POST', body: { email: 'x@inv.test' }, origin: 'https://evil.test' })).status, 403, 'other origins');
  assert.equal((await invite(jefe, { email: 'no es un email' })).status, 400);
  assert.equal(await userByEmail('x@inv.test'), undefined, 'nothing refused created an account');

  const r = await invite(jefe, { email: 'Nuevo@Inv.test', name: 'Cliente Nuevo', role: 'admin' });
  assert.equal(r.status, 201);
  const u = await userByEmail('nuevo@inv.test');
  assert.equal(u.role, 'client', 'the role in the request is ignored');
  assert.equal(u.password_hash, null);
  assert.equal(u.email_verified, false);
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2', [obraId, u.id])).rows[0].n, 1, 'associated to the obra');
  const actions = (await db.query("SELECT action FROM audit_log WHERE target_id=$1 ORDER BY id", [u.id])).rows.map((x) => x.action);
  assert.deepEqual(actions, ['Cuenta de cliente creada por invitación', 'Invitación enviada']);
  assert.equal((await invite(admin, { email: 'otro.nuevo@inv.test' }, otraObraId)).status, 201, 'an admin invites to any obra');
  await pending();
});

test('the answer is the same whether the account exists or not, and existing accounts keep role and data', async () => {
  const shape = async (who, email) => {
    const r = await invite(who, { email, name: 'Nombre escrito' });
    const { invitacion } = await r.json();
    return { status: r.status, keys: Object.keys(invitacion).sort(), state: invitacion.status, name: invitacion.name, can: invitacion.can };
  };
  const fresh = await shape(jefe, 'nadie@inv.test');
  assert.deepEqual(await shape(jefe, 'admin@inv.test'), fresh, 'an admin account');
  assert.deepEqual(await shape(jefe, 'titular@inv.test'), fresh, 'the titular client');
  const a = await userByEmail('admin@inv.test');
  assert.equal(a.role, 'admin');
  assert.equal(a.name, 'Admin Test', 'never the name typed by whoever invites');
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [a.id])).rows[0].n, 0, 'staff get no client access');
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [cliente.id])).rows[0].n, 0, 'the titular needs no row');
  const list = await (await call(`/obras/${obraId}`, jefe)).json();
  assert.ok(list.invitaciones.every((i) => i.status === 'pendiente'));
  assert.ok(!JSON.stringify(list).includes('Admin Test'), 'the list shows what was typed, not the account');
  await pending();
});

test('the link: minted when the mail is claimed, only its hash stored, one use, then gone', async () => {
  await invite(jefe, { email: 'enlace@inv.test', name: 'Eva', lang: 'en' });
  const [m] = await claimLinks();
  assert.equal(m.to, 'enlace@inv.test', 'to the invited person, not the fixed recipients');
  assert.match(m.subject, /Reforma de cocina/);
  assert.match(m.html, /Jefe Test from Ledens/, 'in the language chosen');
  assert.ok(m.token);
  const inv = (await db.query("SELECT * FROM invitaciones WHERE email='enlace@inv.test'")).rows[0];
  assert.equal(inv.token_hash, hashToken(m.token));
  const dump = JSON.stringify((await db.query("SELECT * FROM invitaciones")).rows) + JSON.stringify((await db.query('SELECT * FROM ledens.transaction_alerts')).rows);
  assert.ok(!dump.includes(m.token), 'the token itself is stored nowhere');
  assert.equal((await claimLinks()).length, 0, 'claimed once');

  const info = await describe(pool, m.token);
  assert.equal(info.email, 'enlace@inv.test');
  assert.equal(info.obra, 'Reforma de cocina');
  assert.equal(info.hasPassword, false);
  const r = await call('/aceptacion/consultar', null, { method: 'POST', body: { token: m.token } });
  assert.equal(r.status, 200);
  assert.equal((await call('/aceptacion/consultar', null, { method: 'POST', body: { token: 'x'.repeat(43) } })).status, 410);

  await assert.rejects(acceptWithPassword(pool, m.token, 'corta'), /al menos 8/);
  const user = await acceptWithPassword(pool, m.token, 'una-contraseña-larga');
  const u = await userByEmail('enlace@inv.test');
  assert.equal(u.email_verified, true, 'the link proves the email');
  assert.ok(u.password_hash);
  assert.equal(user.role, 'client');
  await assert.rejects(describe(pool, m.token), (e) => e.status === 410, 'one use only');
  const list = await (await call(`/obras/${obraId}`, jefe)).json();
  assert.equal(list.invitaciones.find((i) => i.email === 'enlace@inv.test').status, 'aceptada');
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='Invitación aceptada' AND target_id=$1", [u.id])).rows.length);

  // An invited client sees the obra and its ampliaciones; only the titular decides.
  const seen = await new PresupuestosService(pool, { id: u.id, role: 'client' }).get(obraId);
  assert.equal(seen.can.decide, false);
  assert.equal(seen.can.comment, false);
  const row = (await new PresupuestosService(pool, { id: u.id, role: 'client' }).list()).find((p) => p.id === obraId);
  assert.equal(row?.decides, false, 'listed, but not as waiting for their decision');
  assert.equal((await new PresupuestosService(pool, { id: cliente.id, role: 'client' }).list()).find((p) => p.id === obraId).decides, true, 'the titular decides');
  await assert.rejects(new PresupuestosService(pool, { id: u.id, role: 'client' }).get(otraObraId), (e) => e.status === 404, 'not other obras');
});

test('expired, resent and revoked links stop working; revoking withdraws the access it gave', async () => {
  await invite(jefe, { email: 'caduca@inv.test' });
  const [first] = await claimLinks();
  await db.query("UPDATE invitaciones SET expires_at=now()-interval '1 minute' WHERE email='caduca@inv.test'");
  await assert.rejects(describe(pool, first.token), (e) => e.status === 410);
  let list = await (await call(`/obras/${obraId}`, jefe)).json();
  const inv = list.invitaciones.find((i) => i.email === 'caduca@inv.test');
  assert.equal(inv.status, 'caducada');

  assert.equal((await call(`/obras/${obraId}/${inv.id}/reenviar`, jefe, { method: 'POST' })).status, 200);
  assert.equal((await call(`/obras/${obraId}/${inv.id}/reenviar`, jefe, { method: 'POST' })).status, 200);
  const sent = await claimLinks();
  assert.equal(sent.length, 1, 'only the latest send is mailed');
  assert.equal((await db.query("SELECT last_error FROM ledens.transaction_alerts WHERE event_key=$1", [`invitation:${inv.id}:2`])).rows[0].last_error, 'invitation_not_pending');
  assert.equal((await describe(pool, sent[0].token)).email, 'caduca@inv.test');

  const u = await userByEmail('caduca@inv.test');
  assert.equal((await call(`/obras/${obraId}/${inv.id}/revocar`, otroJefe, { method: 'POST' })).status, 404);
  assert.equal((await call(`/obras/${obraId}/${inv.id}/revocar`, jefe, { method: 'POST' })).status, 200);
  await assert.rejects(describe(pool, sent[0].token), (e) => e.status === 410);
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [u.id])).rows[0].n, 0);
  assert.equal((await call(`/obras/${obraId}/${inv.id}/revocar`, jefe, { method: 'POST' })).status, 409);
  list = await (await call(`/obras/${obraId}`, jefe)).json();
  assert.equal(list.invitaciones.find((i) => i.id === inv.id).status, 'revocada');
  const actions = (await db.query("SELECT action FROM audit_log WHERE target_id=$1 ORDER BY id", [u.id])).rows.map((x) => x.action);
  assert.deepEqual(actions, ['Cuenta de cliente creada por invitación', 'Invitación enviada', 'Invitación reenviada', 'Invitación reenviada', 'Invitación revocada']);
});

test('an account with a password nobody proved gets access only through the link, which takes the account back', async () => {
  const intruso = (await db.query(`INSERT INTO users(email,name,password_hash,role) VALUES ('victima@inv.test','Intruso',$1,'client') RETURNING id`, [hashPassword('del-intruso-123')])).rows[0];
  await db.query("INSERT INTO sessions(user_id, token_hash) VALUES ($1,'abierta')", [intruso.id]);
  await invite(jefe, { email: 'victima@inv.test' });
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [intruso.id])).rows[0].n, 0, 'no access yet');
  await assert.rejects(new PresupuestosService(pool, { id: intruso.id, role: 'client' }).get(obraId), (e) => e.status === 404);
  const [m] = await claimLinks();
  assert.equal((await describe(pool, m.token)).hasPassword, false, 'an unproven password does not count');
  await acceptWithPassword(pool, m.token, 'la-de-la-victima');
  const u = await userByEmail('victima@inv.test');
  assert.equal(u.email_verified, true);
  assert.notEqual(u.password_hash, (await db.query('SELECT $1::text h', [intruso.password_hash])).rows[0].h);
  assert.equal((await db.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [u.id])).rows[0].n, 0, 'sessions opened before are closed');
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [u.id])).rows[0].n, 1);
});

test('a proven password or a social login: accept with that account, never with another one', async () => {
  const conClave = (await db.query(`INSERT INTO users(email,name,password_hash,role,email_verified) VALUES ('clave@inv.test','Con Clave',$1,'client',true) RETURNING id,email,role`, [hashPassword('su-clave-de-siempre')])).rows[0];
  await invite(jefe, { email: 'clave@inv.test' });
  const [m] = await claimLinks();
  assert.equal((await describe(pool, m.token)).hasPassword, true);
  await assert.rejects(acceptWithPassword(pool, m.token, 'otra-clave-nueva'), (e) => e.status === 409, 'a link is not a password reset');
  await assert.rejects(acceptWithSession(pool, m.token, { id: cliente.id }), (e) => e.status === 403 && e.code === 'otra_cuenta');
  await acceptWithSession(pool, m.token, conClave);
  assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [conClave.id])).rows[0].password_hash !== null, true);

  await invite(jefe, { email: 'social@inv.test' });
  const [s] = await claimLinks();
  await assert.rejects(checkIdentity(pool, s.token, 'otra@gmail.test'), (e) => e.code === 'otro_email');
  const inv = await checkIdentity(pool, s.token, 'SOCIAL@inv.test');
  await assert.rejects(acceptWithIdentity(pool, s.token, cliente.id, 'Google'), (e) => e.code === 'otro_email', 'the provider account belongs to someone else');
  await acceptWithIdentity(pool, s.token, inv.user_id, 'Google');
  assert.equal((await userByEmail('social@inv.test')).email_verified, true);
});

test('an account created by a provider login that did not vouch for the email waits for the link, which drops that login', async () => {
  const ajeno = (await db.query(`INSERT INTO users(email,name,role) VALUES ('ajeno-ms@inv.test','Social','client') RETURNING id`)).rows[0];
  await db.query("INSERT INTO auth_identities(user_id, provider, provider_user_id) VALUES ($1,'microsoft','ms-ajeno')", [ajeno.id]);
  await db.query("INSERT INTO sessions(user_id, token_hash) VALUES ($1,'abierta-social')", [ajeno.id]);
  await invite(jefe, { email: 'ajeno-ms@inv.test' });
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [ajeno.id])).rows[0].n, 0, 'no access before the link');
  const [m] = await claimLinks();
  await assert.rejects(acceptWithSession(pool, m.token, { id: ajeno.id }), (e) => e.status === 409 && e.code === 'sesion_sin_verificar');
  await acceptWithPassword(pool, m.token, 'la-de-verdad-1');
  assert.equal((await db.query('SELECT count(*)::int n FROM auth_identities WHERE user_id=$1', [ajeno.id])).rows[0].n, 0, 'the unproven login is gone');
  assert.equal((await db.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [ajeno.id])).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [ajeno.id])).rows[0].n, 1);
});

test('accepting proves the email for every open invitation of that person', async () => {
  const persona = (await db.query(`INSERT INTO users(email,name,password_hash,role) VALUES ('dos@inv.test','Dos',$1,'client') RETURNING id`, [hashPassword('sin-verificar-1')])).rows[0];
  await invite(jefe, { email: 'dos@inv.test' });
  await invite(otroJefe, { email: 'dos@inv.test' }, otraObraId);
  const links = await claimLinks();
  assert.equal(links.length, 2);
  await acceptWithPassword(pool, links[0].token, 'ahora-verificada');
  assert.equal((await db.query('SELECT count(*)::int n FROM obra_clientes WHERE user_id=$1', [persona.id])).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int n FROM invitaciones WHERE user_id=$1 AND accepted_at IS NOT NULL", [persona.id])).rows[0].n, 2);
  await assert.rejects(describe(pool, links[1].token), (e) => e.status === 410);
});

test('«Ver como» reads the list of a jefe but changes nothing; the sending limit per person', async () => {
  assert.equal((await call(`/obras/${obraId}`, admin, { as: jefe })).status, 200);
  assert.equal((await call(`/obras/${obraId}`, jefe, { as: admin })).status, 403, 'only admins view as');
  assert.equal((await call(`/obras/${obraId}`, admin, { method: 'POST', as: jefe, body: { email: 'v@inv.test' } })).status, 403);

  await db.query('DELETE FROM invitacion_envios');
  let last;
  for (let i = 0; i <= LIMITS.hour; i += 1) last = await invite(otroJefe, { email: `lote${i}@inv.test` }, otraObraId);
  assert.equal(last.status, 429);
  assert.equal(await userByEmail(`lote${LIMITS.hour}@inv.test`), undefined, 'refused before creating anything');
  assert.equal((await invite(jefe, { email: 'aparte@inv.test' })).status, 201, 'the limit is per person');
});

test('the link opens on the site the backend accepts (CORS_ORIGIN) unless PUBLIC_APP_URL says otherwise', () => {
  const saved = { p: process.env.PUBLIC_APP_URL, c: process.env.CORS_ORIGIN };
  try {
    delete process.env.PUBLIC_APP_URL;
    process.env.CORS_ORIGIN = 'https://app.ledens.test/';
    assert.equal(appUrl(), 'https://app.ledens.test');
    process.env.CORS_ORIGIN = '*';
    assert.equal(appUrl(), 'https://ambitious-island-05d1d8a03.2.azurestaticapps.net', 'no wildcard in a link');
    process.env.PUBLIC_APP_URL = 'https://otra.ledens.test';
    assert.equal(appUrl(), 'https://otra.ledens.test');
  } finally {
    for (const [k, v] of [['PUBLIC_APP_URL', saved.p], ['CORS_ORIGIN', saved.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
