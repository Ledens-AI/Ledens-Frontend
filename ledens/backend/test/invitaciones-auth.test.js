import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/passwords.js';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { AlertService } from '../src/notifications/service.js';

// Invitaciones de cliente end to end on the real app and a real Postgres
// (same database as auth.test.js / oauth-google.test.js, with the accounting
// fixture of CI): the jefe logs in and invites, the mail sender claims the
// message, and the client opens the link and gets in with a new password or
// with Google — ending in a session, a verified email and the obra in sight.
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';
const ORIGIN = 'http://ledens.local';
const EMAILS = ['jefe.inv@auth.test', 'admin.inv@auth.test', 'titular.inv@auth.test', 'clave.inv@auth.test', 'google.inv@auth.test', 'registro.inv@auth.test', 'ascendido.inv@auth.test'];
let server, base, google, googleBase, obraId, nextUserinfo;

const cookieFrom = (res, name) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith(`${name}=`))?.split(';')[0] || null;
const post = (path, body, cookie) => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
async function linkFor(email) {
  const { messages } = await new AlertService(getPool()).claim();
  const m = messages.find((x) => x.to === email);
  assert.ok(m, `a message for ${email}`);
  return m.html.match(/\/invitacion#([A-Za-z0-9_-]{43})/)[1];
}
const cleanup = () => getPool().query(`DELETE FROM presupuestos WHERE title='Obra de invitación'`)
  .then(() => getPool().query('DELETE FROM users WHERE lower(email) = ANY($1)', [EMAILS]));

before(async () => {
  if (skip) return;
  await runMigrations();
  await cleanup();
  google = http.createServer(async (req, res) => {
    for await (const _ of req);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.startsWith('/token') ? { access_token: 'fake' } : nextUserinfo));
  });
  google.listen(0); await once(google, 'listening');
  googleBase = `http://127.0.0.1:${google.address().port}`;
  Object.assign(process.env, {
    CORS_ORIGIN: ORIGIN, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
    GOOGLE_AUTH_URL: `${googleBase}/authorize`, GOOGLE_TOKEN_URL: `${googleBase}/token`, GOOGLE_USERINFO_URL: `${googleBase}/userinfo`,
  });
  server = http.createServer(createApp()); server.listen(0); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;

  const q = (sql, args) => getPool().query(sql, args);
  const [admin] = (await q(`INSERT INTO users (email, name, role, email_verified) VALUES ('admin.inv@auth.test','Admin Inv','admin',true) RETURNING id, email, name, role`)).rows;
  const [jefe] = (await q(`INSERT INTO users (email, name, role, email_verified, password_hash) VALUES ('jefe.inv@auth.test','Jefe Inv','jefe',true,$1) RETURNING id`, [hashPassword('jefe-de-obra-1')])).rows;
  const [titular] = (await q(`INSERT INTO users (email, name, role, email_verified) VALUES ('titular.inv@auth.test','Titular Inv','client',true) RETURNING id`)).rows;
  const svc = new PresupuestosService(getPool(), admin);
  obraId = (await svc.create({ title: 'Obra de invitación', clientId: titular.id, jefeId: jefe.id,
    chapters: [{ name: 'Baño', items: [{ name: 'Alicatado', unit: 'm2', quantity: '10', unitPrice: '40' }] }] })).id;
  await svc.send(obraId);
});
after(async () => {
  if (skip) return;
  await cleanup();
  server?.close(); google?.close();
  await closePool();
});

async function jefeCookie() {
  const res = await post('/api/auth/login', { email: 'jefe.inv@auth.test', password: 'jefe-de-obra-1' });
  assert.equal(res.status, 200);
  return cookieFrom(res, 'ledens_session');
}

test('a jefe invites, the client sets a password through the link and lands with the obra in sight', { skip }, async () => {
  const jefe = await jefeCookie();
  assert.equal((await post(`/api/invitaciones/obras/${obraId}`, { email: 'clave.inv@auth.test' })).status, 401, 'logged out');
  const r = await post(`/api/invitaciones/obras/${obraId}`, { email: 'clave.inv@auth.test', name: 'Clara' }, jefe);
  assert.equal(r.status, 201);
  const created = (await getPool().query("SELECT role, password_hash, email_verified, registered_at FROM users WHERE email='clave.inv@auth.test'")).rows[0];
  assert.deepEqual(created, { role: 'client', password_hash: null, email_verified: false, registered_at: null }, 'invited is not registered');
  // No password yet: nobody can log in with one (registering it on their own
  // is the next test: the row is taken, held until the link).
  assert.equal((await post('/api/auth/login', { email: 'clave.inv@auth.test', password: 'cualquiera-123' })).status, 401);

  const token = await linkFor('clave.inv@auth.test');
  const info = await (await post('/api/invitaciones/aceptacion/consultar', { token })).json();
  assert.equal(info.email, 'clave.inv@auth.test');
  assert.equal(info.obra, 'Obra de invitación');
  assert.equal(info.providers.google, true);

  const accepted = await post('/api/invitaciones/aceptacion/contrasena', { token, password: 'mi-clave-nueva-1' });
  assert.equal(accepted.status, 200);
  const session = cookieFrom(accepted, 'ledens_session');
  assert.ok(session);
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).json();
  assert.equal(me.user.email_verified, true);
  assert.equal(me.user.role, 'client');
  assert.ok((await getPool().query("SELECT registered_at FROM users WHERE email='clave.inv@auth.test'")).rows[0].registered_at, 'registered once they get in');
  const list = await (await fetch(`${base}/api/presupuestos`, { headers: { cookie: session } })).json();
  assert.ok(list.presupuestos.some((p) => p.id === obraId), 'the obra is in their area');
  assert.equal((await post('/api/invitaciones/aceptacion/contrasena', { token, password: 'otra-vez-123' })).status, 410, 'one use');
  assert.equal((await post('/api/auth/login', { email: 'clave.inv@auth.test', password: 'mi-clave-nueva-1' })).status, 200, 'the password works from now on');

  const audit = (await getPool().query("SELECT a.action FROM audit_log a JOIN users u ON u.id=a.target_id WHERE u.email='clave.inv@auth.test' ORDER BY a.id")).rows.map((x) => x.action);
  assert.deepEqual(audit, ['Cuenta de cliente creada por invitación', 'Invitación enviada', 'Invitación aceptada']);
});

test('with Google: the provider account must carry the invited email, and the link makes it verified', { skip }, async () => {
  const jefe = await jefeCookie();
  assert.equal((await post(`/api/invitaciones/obras/${obraId}`, { email: 'google.inv@auth.test' }, jefe)).status, 201);
  const token = await linkFor('google.inv@auth.test');

  const viaGoogle = async (email) => {
    const start = await post('/api/invitaciones/aceptacion/proveedor', { token, provider: 'google' });
    assert.equal(start.status, 200);
    assert.equal((await start.json()).url, '/api/auth/google');
    const invite = cookieFrom(start, 'ledens_invitacion');
    assert.match(start.headers.getSetCookie().find((c) => c.startsWith('ledens_invitacion=')), /Path=\/api\/auth/);
    const login = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    // Google does not vouch for this email: only the link does.
    nextUserinfo = { sub: `google-${email}`, email, email_verified: false, name: 'Gina' };
    return fetch(`${base}/api/auth/google/callback?code=c&state=${state}`, { redirect: 'manual', headers: { cookie: `${cookieFrom(login, 'oauth_state')}; ${invite}` } });
  };

  // Cancelling at Google goes back to the invitation page, not to /auth.
  const started = await post('/api/invitaciones/aceptacion/proveedor', { token, provider: 'google' });
  const cancelled = await fetch(`${base}/api/auth/google/callback?error=access_denied`, { redirect: 'manual', headers: { cookie: cookieFrom(started, 'ledens_invitacion') } });
  assert.equal(cancelled.headers.get('location'), '/invitacion?error=google_cancelled');
  assert.match(cancelled.headers.getSetCookie().find((c) => c.startsWith('ledens_invitacion=')) || '', /Expires=Thu, 01 Jan 1970/, 'the invitation cookie is cleared');

  const wrong = await viaGoogle('otra.persona@auth.test');
  assert.equal(wrong.status, 302);
  assert.equal(wrong.headers.get('location'), '/invitacion?error=otro_email');
  assert.equal(cookieFrom(wrong, 'ledens_session'), null, 'no session with another account');
  assert.equal((await getPool().query("SELECT count(*)::int n FROM users WHERE email='otra.persona@auth.test'")).rows[0].n, 0);

  const ok = await viaGoogle('google.inv@auth.test');
  assert.equal(ok.headers.get('location'), '/plataforma');
  const session = cookieFrom(ok, 'ledens_session');
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).json();
  assert.equal(me.user.email, 'google.inv@auth.test');
  assert.equal(me.user.email_verified, true);
  assert.equal(me.user.name, 'Gina', 'the provider name replaces the email standing in for one');
  assert.equal((await getPool().query("SELECT count(*)::int n FROM auth_identities ai JOIN users u ON u.id=ai.user_id WHERE u.email='google.inv@auth.test'")).rows[0].n, 1);
  assert.equal((await post('/api/invitaciones/aceptacion/consultar', { token })).status, 410, 'used');
});

test('registering on their own with the invited email takes the pending row, but shows no obra until the link proves the email', { skip }, async () => {
  const jefe = await jefeCookie();
  assert.equal((await post(`/api/invitaciones/obras/${obraId}`, { email: 'registro.inv@auth.test' }, jefe)).status, 201);
  const reg = await post('/api/auth/register', { name: 'Rita Registro', email: 'registro.inv@auth.test', password: 'tecleada-sin-probar' });
  assert.equal(reg.status, 201, 'same answer as any registration');
  const held = cookieFrom(reg, 'ledens_session');
  const list = await (await fetch(`${base}/api/presupuestos`, { headers: { cookie: held } })).json();
  assert.ok(!list.presupuestos.some((p) => p.id === obraId), 'typing an email proves nothing: no obra yet');
  assert.equal((await post('/api/auth/register', { name: 'Otra', email: 'registro.inv@auth.test', password: 'otra-mas-123' })).status, 409, 'registered now');

  const token = await linkFor('registro.inv@auth.test');
  assert.equal((await (await post('/api/invitaciones/aceptacion/consultar', { token })).json()).hasPassword, false, 'an unproven password does not count');
  const accepted = await post('/api/invitaciones/aceptacion/contrasena', { token, password: 'la-buena-de-rita' });
  assert.equal(accepted.status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: held } })).status, 401, 'the session of the unproven registration is closed');
  const now = await (await fetch(`${base}/api/presupuestos`, { headers: { cookie: cookieFrom(accepted, 'ledens_session') } })).json();
  assert.ok(now.presupuestos.some((p) => p.id === obraId), 'the link proves the email: the obra is there');
});

test('a pending row promoted to staff before signing in is never taken by registering its email', { skip }, async () => {
  const jefe = await jefeCookie();
  assert.equal((await post(`/api/invitaciones/obras/${obraId}`, { email: 'ascendido.inv@auth.test' }, jefe)).status, 201);
  await getPool().query("UPDATE users SET role='admin' WHERE email='ascendido.inv@auth.test'"); // as PATCH /api/admin/users/:id/role or the CLI would
  const reg = await post('/api/auth/register', { name: 'Intruso', email: 'ascendido.inv@auth.test', password: 'me-hago-admin-1' });
  assert.equal(reg.status, 409);
  assert.equal(cookieFrom(reg, 'ledens_session'), null);
  const row = (await getPool().query("SELECT role, password_hash, registered_at FROM users WHERE email='ascendido.inv@auth.test'")).rows[0];
  assert.deepEqual(row, { role: 'admin', password_hash: null, registered_at: null }, 'untouched');
});

test('a client never reaches the team routes', { skip }, async () => {
  const login = await post('/api/auth/login', { email: 'clave.inv@auth.test', password: 'mi-clave-nueva-1' });
  const client = cookieFrom(login, 'ledens_session');
  assert.equal((await fetch(`${base}/api/invitaciones/obras/${obraId}`, { headers: { cookie: client } })).status, 403);
  assert.equal((await post(`/api/invitaciones/obras/${obraId}`, { email: 'x@auth.test' }, client)).status, 403);
});
