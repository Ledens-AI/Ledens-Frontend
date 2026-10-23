import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';

// Needs a real Postgres, same as db.test.js:
//   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm test
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

const post = (path, body, cookie) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

// The test server has no browser to store the cookie for us, so tests do it
// by hand: grab it from Set-Cookie, resend it as Cookie on the next request.
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

const cleanupUser = (email) => getPool().query('DELETE FROM users WHERE lower(email) = lower($1)', [email]);

test('register creates an account, sets a session cookie, and hides the password hash', { skip }, async () => {
  const email = `t1-${Date.now()}@example.com`;
  try {
    const res = await post('/api/auth/register', { name: 'Test User', email, password: 'password123' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user.email, email);
    assert.ok(!('password_hash' in body.user), 'the hash must never be sent to the client');
    assert.match(res.headers.get('set-cookie') || '', /ledens_session=/);
  } finally {
    await cleanupUser(email);
  }
});

test('the same email cannot register twice, case-insensitively', { skip }, async () => {
  const email = `t2-${Date.now()}@example.com`;
  try {
    const r1 = await post('/api/auth/register', { name: 'A', email, password: 'password123' });
    assert.equal(r1.status, 201);
    const r2 = await post('/api/auth/register', { name: 'A', email: email.toUpperCase(), password: 'password123' });
    assert.equal(r2.status, 409);
  } finally {
    await cleanupUser(email);
  }
});

test('short passwords are rejected before anything is created', { skip }, async () => {
  const email = `t3-${Date.now()}@example.com`;
  const res = await post('/api/auth/register', { name: 'A', email, password: '123' });
  assert.equal(res.status, 400);
});

test('full cycle: register → login → me → logout → me fails', { skip }, async () => {
  const email = `t4-${Date.now()}@example.com`;
  try {
    await post('/api/auth/register', { name: 'A', email, password: 'password123' });

    const loginRes = await post('/api/auth/login', { email, password: 'password123' });
    assert.equal(loginRes.status, 200);
    const cookie = cookieFrom(loginRes);

    const meRes = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(meRes.status, 200);
    assert.equal((await meRes.json()).user.email, email);

    const logoutRes = await post('/api/auth/logout', {}, cookie);
    assert.equal(logoutRes.status, 200);

    const meAfterLogout = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(meAfterLogout.status, 401, 'the session must be dead once logged out');
  } finally {
    await cleanupUser(email);
  }
});

test('wrong password and unknown email get the same error', { skip }, async () => {
  const email = `t5-${Date.now()}@example.com`;
  try {
    await post('/api/auth/register', { name: 'A', email, password: 'password123' });

    const wrongPassword = await post('/api/auth/login', { email, password: 'not-the-password' });
    const unknownEmail = await post('/api/auth/login', { email: `nobody-${Date.now()}@example.com`, password: 'not-the-password' });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal((await wrongPassword.json()).error, (await unknownEmail.json()).error);
  } finally {
    await cleanupUser(email);
  }
});

test('/me with no cookie at all is rejected', { skip }, async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assert.equal(res.status, 401);
});
