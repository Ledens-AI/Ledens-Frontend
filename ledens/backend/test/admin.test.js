import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/passwords.js';

// Needs a real Postgres, same as auth.test.js.
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

let server;
let base;

before(async () => {
  if (skip) return;
  await runMigrations();
  server = http.createServer(createApp());
  server.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closePool();
});

const call = (method, path, body, cookie) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

// Creates a user with the given role straight in the DB and logs it in.
async function loginAs(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { rows } = await getPool().query(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, `Test ${role}`, role, hashPassword('password123')],
  );
  const res = await call('POST', '/api/auth/login', { email, password: 'password123' });
  assert.equal(res.status, 200);
  return { id: rows[0].id, email, cookie: cookieFrom(res) };
}
const cleanup = (...emails) => getPool().query('DELETE FROM users WHERE lower(email) = ANY($1)', [emails.map((e) => e.toLowerCase())]);

test('migration 004 seeds the named accounts with their roles', { skip }, async () => {
  const { rows } = await getPool().query(
    `SELECT lower(email) AS email, role FROM users
      WHERE lower(email) IN ('ajnavarrosilva@gmail.com', 'alvaro.navarro@ledens.es', 'ana.anzola@ledens.es', 'alvaronavarrosilva@outlook.es')`,
  );
  const roles = Object.fromEntries(rows.map((r) => [r.email, r.role]));
  assert.deepEqual(roles, {
    'ajnavarrosilva@gmail.com': 'admin',
    'alvaro.navarro@ledens.es': 'admin',
    'ana.anzola@ledens.es': 'jefe',
    'alvaronavarrosilva@outlook.es': 'client',
  });
});

test('a seeded email cannot be taken over by registering it with a password', { skip }, async () => {
  const res = await call('POST', '/api/auth/register', { name: 'Intruso', email: 'Alvaro.Navarro@ledens.es', password: 'password123' });
  assert.equal(res.status, 409);
  const login = await call('POST', '/api/auth/login', { email: 'alvaro.navarro@ledens.es', password: 'password123' });
  assert.equal(login.status, 401, 'a seeded account without a password must not accept any password');
});

test('new registrations are clients, and /me reports the role', { skip }, async () => {
  const email = `reg-${Date.now()}@example.com`;
  try {
    const res = await call('POST', '/api/auth/register', { name: 'Nuevo Cliente', email, password: 'password123' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).user.role, 'client');
    const me = await call('GET', '/api/auth/me', null, cookieFrom(res));
    assert.equal((await me.json()).user.role, 'client');
  } finally {
    await cleanup(email);
  }
});

test('/api/admin is 401 logged out and 403 for clients and jefes de obra', { skip }, async () => {
  const client = await loginAs('client');
  const jefe = await loginAs('jefe');
  try {
    assert.equal((await call('GET', '/api/admin/users')).status, 401);
    assert.equal((await call('GET', '/api/admin/users', null, client.cookie)).status, 403);
    assert.equal((await call('GET', '/api/admin/users', null, jefe.cookie)).status, 403);
    assert.equal((await call('GET', '/api/admin/audit', null, jefe.cookie)).status, 403);
    assert.equal((await call('PATCH', `/api/admin/users/${client.id}/role`, { role: 'admin', reason: 'x' }, client.cookie)).status, 403);
  } finally {
    await cleanup(client.email, jefe.email);
  }
});

test('/api/finanzas is 401 logged out and 403 for clients, open to jefes and admins', { skip }, async () => {
  const client = await loginAs('client');
  const jefe = await loginAs('jefe');
  const admin = await loginAs('admin');
  try {
    assert.equal((await call('GET', '/api/finanzas/registros')).status, 401);
    assert.equal((await call('GET', '/api/finanzas/registros', null, client.cookie)).status, 403);
    assert.equal((await call('POST', '/api/finanzas/registros/lote', { action: 'review', items: [] }, client.cookie)).status, 403);
    // 200 with the accounting tables imported, 503 on a local auth-only database.
    for (const u of [jefe, admin]) {
      const s = (await call('GET', '/api/finanzas/resumen', null, u.cookie)).status;
      assert.ok([200, 503].includes(s), `got ${s}`);
    }
  } finally {
    await cleanup(client.email, jefe.email, admin.email);
  }
});

test('an admin lists users without password hashes', { skip }, async () => {
  const admin = await loginAs('admin');
  try {
    const res = await call('GET', '/api/admin/users', null, admin.cookie);
    assert.equal(res.status, 200);
    const { users } = await res.json();
    const me = users.find((u) => u.id === admin.id);
    assert.equal(me.role, 'admin');
    assert.equal(me.has_password, true);
    assert.deepEqual(me.providers, []);
    assert.ok(me.last_seen, 'the login just made counts as last access');
    assert.ok(users.every((u) => !('password_hash' in u)));
  } finally {
    await cleanup(admin.email);
  }
});

test('an admin changes a role with a reason, and it lands in the audit log', { skip }, async () => {
  const admin = await loginAs('admin');
  const target = await loginAs('client');
  try {
    const noReason = await call('PATCH', `/api/admin/users/${target.id}/role`, { role: 'jefe', reason: ' ' }, admin.cookie);
    assert.equal(noReason.status, 400);
    const badRole = await call('PATCH', `/api/admin/users/${target.id}/role`, { role: 'root', reason: 'x' }, admin.cookie);
    assert.equal(badRole.status, 400);
    const self = await call('PATCH', `/api/admin/users/${admin.id}/role`, { role: 'client', reason: 'x' }, admin.cookie);
    assert.equal(self.status, 400, 'an admin must not be able to demote themselves');
    const missing = await call('PATCH', '/api/admin/users/not-a-uuid/role', { role: 'jefe', reason: 'x' }, admin.cookie);
    assert.equal(missing.status, 404);

    const ok = await call('PATCH', `/api/admin/users/${target.id}/role`, { role: 'jefe', reason: 'Nueva incorporación' }, admin.cookie);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.role, 'jefe');

    // The target's existing session sees the new role on its next request.
    const me = await call('GET', '/api/auth/me', null, target.cookie);
    assert.equal((await me.json()).user.role, 'jefe');

    const audit = await (await call('GET', '/api/admin/audit', null, admin.cookie)).json();
    const entry = audit.entries.find((e) => e.target_label === target.email && e.action === 'Rol cambiado');
    assert.ok(entry);
    assert.equal(entry.actor_label, 'Test admin');
    assert.match(entry.detail, /Cliente → Jefe de obra · Nueva incorporación/);
  } finally {
    await cleanup(admin.email, target.email);
  }
});
