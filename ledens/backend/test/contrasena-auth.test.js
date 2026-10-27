import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/passwords.js';
import { AlertService } from '../src/notifications/service.js';

// Links to create or reset a password (migration 025) on the real app and a
// real Postgres: asking never tells whether the account exists, the mail
// sender gets a message for the person with the link, and using it sets the
// password, proves the email and drops whatever an unverified account had.
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';
const EMAILS = ['sinclave.pwd@auth.test', 'conclave.pwd@auth.test', 'admin.pwd@auth.test'];
let server, base;

const cookieFrom = (res, name) => (res.headers.getSetCookie?.() || []).find((c) => c.startsWith(`${name}=`))?.split(';')[0] || null;
const post = (path, body, cookie) => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
async function linkFor(email) {
  const { messages } = await new AlertService(getPool()).claim();
  const m = messages.find((x) => x.to === email);
  assert.ok(m, `a message for ${email}`);
  return { token: m.html.match(/\/contrasena#([A-Za-z0-9_-]{43})/)[1], subject: m.subject };
}
const cleanup = () => getPool().query('DELETE FROM users WHERE lower(email) = ANY($1)', [EMAILS]);

before(async () => {
  if (skip) return;
  await runMigrations();
  await cleanup();
  server = http.createServer(createApp()); server.listen(0); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (skip) return;
  await cleanup();
  server?.close();
  await closePool();
});

test('a passwordless account asks for a link and creates its password; an unproven Microsoft login goes', { skip }, async () => {
  const u = (await getPool().query("INSERT INTO users (email, name, role) VALUES ('sinclave.pwd@auth.test', 'sinclave.pwd@auth.test', 'client') RETURNING id")).rows[0];
  await getPool().query("INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, 'microsoft', 'ms-sin-probar')", [u.id]);
  await getPool().query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'sesion-sin-probar', now() + interval '1 day')", [u.id]);

  const unknown = await post('/api/auth/contrasena/solicitar', { email: 'nadie.pwd@auth.test' });
  assert.deepEqual([unknown.status, await unknown.json()], [200, { ok: true }], 'same answer without an account');
  assert.equal((await post('/api/auth/contrasena/solicitar', { email: 'no-es-un-email' })).status, 400);

  assert.equal((await post('/api/auth/contrasena/solicitar', { email: 'SinClave.pwd@auth.test', lang: 'es' })).status, 200);
  const { token, subject } = await linkFor('sinclave.pwd@auth.test');
  assert.equal(subject, 'Ledens · Crea tu contraseña');
  const info = await (await post('/api/auth/contrasena/consultar', { token })).json();
  assert.deepEqual([info.email, info.hasPassword], ['sinclave.pwd@auth.test', false]);

  assert.equal((await post('/api/auth/contrasena/establecer', { token, password: 'corta' })).status, 400);
  const set = await post('/api/auth/contrasena/establecer', { token, password: 'mi-clave-nueva-1' });
  assert.equal(set.status, 200);
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieFrom(set, 'ledens_session') } })).json();
  assert.equal(me.user.email_verified, true);
  const row = (await getPool().query(`SELECT registered_at, (SELECT count(*)::int FROM auth_identities WHERE user_id=$1) identities,
    (SELECT count(*)::int FROM sessions WHERE user_id=$1 AND token_hash='sesion-sin-probar') old FROM users WHERE id=$1`, [u.id])).rows[0];
  assert.ok(row.registered_at, 'registered');
  assert.deepEqual([row.identities, row.old], [0, 0], 'the unproven login and its session are gone');
  assert.equal((await post('/api/auth/login', { email: 'sinclave.pwd@auth.test', password: 'mi-clave-nueva-1' })).status, 200);
  assert.equal((await post('/api/auth/contrasena/establecer', { token, password: 'otra-vez-1234' })).status, 410, 'one use');
});

test('a forgotten password: the newest link replaces the older one, the old password stops working, three per hour', { skip }, async () => {
  await getPool().query("INSERT INTO users (email, name, role, password_hash, email_verified, registered_at) VALUES ('conclave.pwd@auth.test', 'Con Clave', 'client', $1, true, now())", [hashPassword('la-de-antes-1')]);
  await post('/api/auth/contrasena/solicitar', { email: 'conclave.pwd@auth.test', lang: 'en' });
  const first = await linkFor('conclave.pwd@auth.test');
  assert.equal(first.subject, 'Ledens · Reset your password');
  await post('/api/auth/contrasena/solicitar', { email: 'conclave.pwd@auth.test' });
  const second = await linkFor('conclave.pwd@auth.test');
  assert.equal((await post('/api/auth/contrasena/consultar', { token: first.token })).status, 410, 'replaced');
  assert.equal((await (await post('/api/auth/contrasena/consultar', { token: second.token })).json()).hasPassword, true);
  await post('/api/auth/contrasena/solicitar', { email: 'conclave.pwd@auth.test' });
  await post('/api/auth/contrasena/solicitar', { email: 'conclave.pwd@auth.test' });
  const n = (await getPool().query("SELECT count(*)::int n FROM password_links l JOIN users u ON u.id=l.user_id WHERE u.email='conclave.pwd@auth.test'")).rows[0].n;
  assert.equal(n, 3, 'the fourth in an hour is not created (same answer though)');
  const third = await linkFor('conclave.pwd@auth.test');
  assert.equal((await post('/api/auth/contrasena/establecer', { token: third.token, password: 'la-de-ahora-1' })).status, 200);
  assert.equal((await post('/api/auth/login', { email: 'conclave.pwd@auth.test', password: 'la-de-antes-1' })).status, 401);
});

test('an admin sends the link from the user page; nobody else can', { skip }, async () => {
  const admin = (await getPool().query("INSERT INTO users (email, name, role, password_hash, email_verified, registered_at) VALUES ('admin.pwd@auth.test', 'Admin Pwd', 'admin', $1, true, now()) RETURNING id", [hashPassword('admin-pwd-1234')])).rows[0];
  const target = (await getPool().query("SELECT id FROM users WHERE email='sinclave.pwd@auth.test'")).rows[0];
  assert.equal((await post(`/api/admin/users/${target.id}/enlace-contrasena`, {})).status, 401);
  const client = cookieFrom(await post('/api/auth/login', { email: 'sinclave.pwd@auth.test', password: 'mi-clave-nueva-1' }), 'ledens_session');
  assert.equal((await post(`/api/admin/users/${admin.id}/enlace-contrasena`, {}, client)).status, 403);
  const cookie = cookieFrom(await post('/api/auth/login', { email: 'admin.pwd@auth.test', password: 'admin-pwd-1234' }), 'ledens_session');
  const sent = await post(`/api/admin/users/${target.id}/enlace-contrasena`, { lang: 'es' }, cookie);
  assert.deepEqual([sent.status, (await sent.json()).email], [200, 'sinclave.pwd@auth.test']);
  const { subject } = await linkFor('sinclave.pwd@auth.test');
  assert.equal(subject, 'Ledens · Restablece tu contraseña');
  const audit = (await getPool().query("SELECT action FROM audit_log WHERE target_id=$1 AND action='Enlace de contraseña enviado'", [target.id])).rows;
  assert.equal(audit.length, 1);
});
