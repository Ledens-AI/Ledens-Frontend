import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/passwords.js';
import { hashToken, SESSION_COOKIE } from '../src/auth/sessions.js';

// PR 2 of Ledens Mobile: POST /api/auth/mobile/login and /logout. Same users,
// same sessions, same limiter as the web login; token only in the JSON body,
// never a cookie; off unless MOBILE_AUTH_ENABLED is exactly 'true'.
// Needs a real Postgres, same as auth.test.js:
//   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm test
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

const FLAG = 'MOBILE_AUTH_ENABLED';
const ORIGIN = 'https://ledens.test';
const PASSWORD = 'password123';

async function withEnv(vars, fn) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const flagOn = (fn) => withEnv({ [FLAG]: 'true' }, fn);

let prevOrigin;
before(async () => {
  if (skip) return;
  prevOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = ORIGIN;
  await runMigrations();
});
after(async () => {
  if (prevOrigin === undefined) delete process.env.CORS_ORIGIN; else process.env.CORS_ORIGIN = prevOrigin;
  if (!skip) await closePool();
});

// A fresh app per test (the shared /api limiter lives in createApp()). The
// login limiter is one module-level instance shared by web and mobile — on
// purpose — so each test talks from its own client IP (X-Forwarded-For, read
// through `trust proxy`) and never spends another test's budget.
let ipSeq = 0;
async function withServer(fn) {
  const server = http.createServer(createApp());
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const ip = `198.51.100.${++ipSeq}`;
  const call = (path, { method = 'GET', body, auth, cookie, origin, headers = {}, raw } = {}) => fetch(`${base}${path}`, {
    method,
    headers: {
      'X-Forwarded-For': ip,
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(auth !== undefined ? { Authorization: auth } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin !== undefined ? { Origin: origin } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  try { return await fn(call, ip); } finally { await new Promise((r) => server.close(r)); }
}

const created = [];
async function makeUser(role = 'client') {
  const email = `mobile-${role}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const { rows } = await getPool().query(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
    [email, `Mobile ${role}`, role, hashPassword(PASSWORD)],
  );
  created.push(email);
  return rows[0];
}
after(async () => {
  if (!skip && created.length) await getPool().query('DELETE FROM users WHERE email = ANY($1)', [created]).catch(() => {});
});
const sessionCount = async (userId) => Number((await getPool().query('SELECT count(*) FROM sessions WHERE user_id = $1', [userId])).rows[0].count);
const login = (call, u, extra = {}) => call('/api/auth/mobile/login', { method: 'POST', body: { email: u.email, password: PASSWORD }, ...extra });
const assertMobileHeaders = (res, label = '') => {
  assert.equal(res.headers.get('set-cookie'), null, `${label}: a mobile answer never sets a cookie`);
  assert.match(res.headers.get('cache-control') || '', /no-store/, `${label}: Cache-Control no-store`);
};

test('flag off: both endpoints answer 404, set no cookie and create no session', { skip }, async () => {
  const u = await makeUser();
  for (const value of [undefined, '', 'false', '1', 'yes', 'TRUE', ' true']) {
    await withEnv({ [FLAG]: value }, () => withServer(async (call) => {
      const res = await login(call, u);
      assert.equal(res.status, 404, `login with flag=${JSON.stringify(value)}`);
      assert.deepEqual(await res.json(), { error: 'No encontrado' });
      assertMobileHeaders(res, 'login flag off');
      const out = await call('/api/auth/mobile/logout', { method: 'POST', auth: `Bearer ${'a'.repeat(64)}` });
      assert.equal(out.status, 404, `logout with flag=${JSON.stringify(value)}`);
    }));
  }
  assert.equal(await sessionCount(u.id), 0);
});

test('correct login: token only in the JSON body, 30-day expiry, no cookie, no-store', { skip }, async () => {
  const u = await makeUser('jefe');
  await flagOn(() => withServer(async (call) => {
    const before = Date.now();
    const res = await login(call, u);
    assert.equal(res.status, 200);
    assertMobileHeaders(res, 'login');
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'token', 'tokenType', 'user']);
    assert.match(body.token, /^[a-f0-9]{64}$/);
    assert.equal(body.tokenType, 'Bearer');
    const days = (Date.parse(body.expiresAt) - before) / 86400000;
    assert.ok(days > 29.99 && days < 30.01, `expiresAt should be 30 days ahead, got ${days}`);
    // Same user object as the web login answers.
    assert.deepEqual(Object.keys(body.user).sort(), ['created_at', 'email', 'id', 'name', 'role']);
    assert.equal(body.user.id, u.id);
    assert.equal(body.user.role, 'jefe');
    // Only the hash is stored, exactly like a web session.
    const { rows } = await getPool().query('SELECT token_hash, expires_at FROM sessions WHERE user_id = $1', [u.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, hashToken(body.token));
    assert.notEqual(rows[0].token_hash, body.token);
    assert.equal(new Date(rows[0].expires_at).toISOString(), body.expiresAt);
  }));
});

test('wrong password, unknown user and malformed input all get the same 401', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const cases = {
      wrongPassword: { body: { email: u.email, password: 'not-the-password' } },
      unknownUser: { body: { email: `nobody-${Date.now()}@example.com`, password: PASSWORD } },
      upperCaseEmailWrongPassword: { body: { email: u.email.toUpperCase(), password: 'nope-nope' } },
      malformedEmail: { body: { email: 'not-an-email', password: PASSWORD } },
      missingPassword: { body: { email: u.email } },
      emptyBody: { body: {} },
      passwordNotString: { body: { email: u.email, password: ['password123'] } },
      formEncoded: { raw: `email=${encodeURIComponent(u.email)}&password=${PASSWORD}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    };
    for (const [name, opts] of Object.entries(cases)) {
      const res = await call('/api/auth/mobile/login', { method: 'POST', ...opts });
      assert.equal(res.status, 401, name);
      assert.deepEqual(await res.json(), { error: 'Credenciales incorrectas' }, name);
      assertMobileHeaders(res, name);
    }
  }));
  assert.equal(await sessionCount(u.id), 0, 'no failed attempt opens a session');
  // The email is matched case-insensitively, as on the web.
  await flagOn(() => withServer(async (call) => {
    const res = await call('/api/auth/mobile/login', { method: 'POST', body: { email: u.email.toUpperCase(), password: PASSWORD } });
    assert.equal(res.status, 200);
  }));
});

test('attempts are limited like the web login: 10 per 15 min per IP, one counter shared with the web', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const bad = { email: u.email, password: 'wrong-password' };
    for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/login', { method: 'POST', body: bad })).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/mobile/login', { method: 'POST', body: bad })).status, 401);
    const blocked = await login(call, u);
    assert.equal(blocked.status, 429, 'the 11th attempt from the same IP is refused, even with the right password');
    assert.deepEqual(await blocked.json(), { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' });
    assert.equal(blocked.headers.get('set-cookie'), null);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: u.email, password: PASSWORD } })).status, 429, 'the web login is blocked too');
  }));
  assert.equal(await sessionCount(u.id), 0);
  // Another IP is not affected.
  await flagOn(() => withServer(async (call) => assert.equal((await login(call, u)).status, 200)));
});

test('/api/auth/me authenticates the mobile token as Bearer, with the same roles', { skip }, async () => {
  const admin = await makeUser('admin');
  const client = await makeUser('client');
  await flagOn(() => withServer(async (call) => {
    for (const u of [admin, client]) {
      const { token } = await (await login(call, u)).json();
      const me = await call('/api/auth/me', { auth: `Bearer ${token}` });
      assert.equal(me.status, 200);
      const { user } = await me.json();
      assert.equal(user.id, u.id);
      assert.equal(user.role, u.role);
      assert.equal((await call('/api/admin/users', { auth: `Bearer ${token}` })).status, u.role === 'admin' ? 200 : 403);
      assert.equal((await call('/api/finanzas/resumen', { auth: `Bearer ${token}` })).status === 403, u.role === 'client');
    }
  }));
});

test('logout revokes the session at once and is idempotent', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const { token } = await (await login(call, u)).json();
    const auth = `Bearer ${token}`;
    assert.equal((await call('/api/auth/me', { auth })).status, 200);
    const out = await call('/api/auth/mobile/logout', { method: 'POST', auth });
    assert.equal(out.status, 200);
    assert.deepEqual(await out.json(), { ok: true });
    assertMobileHeaders(out, 'logout');
    assert.equal(await sessionCount(u.id), 0, 'the row is gone');
    assert.equal((await call('/api/auth/me', { auth })).status, 401, 'the token is dead');
    assert.equal((await call('/api/auth/mobile/logout', { method: 'POST', auth })).status, 200, 'a second logout is still ok');
    const unknown = await call('/api/auth/mobile/logout', { method: 'POST', auth: `Bearer ${crypto.randomBytes(32).toString('hex')}` });
    assert.equal(unknown.status, 200, 'an unknown token is ok too');
  }));
});

test('logout needs a well-formed Bearer token and never accepts or ends a cookie session', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const web = await call('/api/auth/login', { method: 'POST', body: { email: u.email, password: PASSWORD } });
    const cookie = (web.headers.get('set-cookie') || '').split(';')[0];
    const { token } = await (await login(call, u)).json();
    const cases = {
      noHeader: {},
      malformed: { auth: `Bearer ${token.slice(2)}` },
      wrongScheme: { auth: `Token ${token}` },
      cookieOnly: { cookie },
      cookieAndBearer: { cookie, auth: `Bearer ${token}` },
    };
    for (const [name, opts] of Object.entries(cases)) {
      const res = await call('/api/auth/mobile/logout', { method: 'POST', ...opts });
      assert.equal(res.status, 401, name);
      assert.deepEqual(await res.json(), { error: 'No autenticado' }, name);
      assertMobileHeaders(res, name);
    }
    // Neither session was touched by any of those.
    assert.equal((await call('/api/auth/me', { cookie })).status, 200);
    assert.equal((await call('/api/auth/me', { auth: `Bearer ${token}` })).status, 200);
    assert.equal(await sessionCount(u.id), 2);
  }));
});

test('an expired mobile session is refused and its logout is still ok', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const { token } = await (await login(call, u)).json();
    await getPool().query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [hashToken(token)]);
    assert.equal((await call('/api/auth/me', { auth: `Bearer ${token}` })).status, 401);
    assert.equal((await call('/api/auth/mobile/logout', { method: 'POST', auth: `Bearer ${token}` })).status, 200);
    assert.equal(await sessionCount(u.id), 0);
  }));
});

test('a new password (every session deleted) also ends mobile sessions', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const { token } = await (await login(call, u)).json();
    // What auth/passwordLinks.js and the invitation flow do.
    await getPool().query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    assert.equal((await call('/api/auth/me', { auth: `Bearer ${token}` })).status, 401);
  }));
});

test('cookie and Bearer: explicit behaviour on the mobile endpoints and on /me', { skip }, async () => {
  const a = await makeUser();
  const b = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const web = await call('/api/auth/login', { method: 'POST', body: { email: a.email, password: PASSWORD } });
    const cookieA = (web.headers.get('set-cookie') || '').split(';')[0];
    // Mobile login ignores any cookie it receives: it neither reads nor ends
    // nor replaces the cookie session, and answers without Set-Cookie.
    const res = await login(call, b, { cookie: cookieA });
    assert.equal(res.status, 200);
    assertMobileHeaders(res, 'login with a cookie');
    const { token: tokenB } = await res.json();
    const meA = await call('/api/auth/me', { cookie: cookieA });
    assert.equal((await meA.json()).user.id, a.id, 'the cookie session is untouched');
    // Using both credentials together is refused (requireAuth, PR 1).
    assert.equal((await call('/api/auth/me', { cookie: cookieA, auth: `Bearer ${tokenB}` })).status, 401);
    assert.equal((await call('/api/presupuestos', { cookie: cookieA, auth: `Bearer ${tokenB}` })).status, 401);
    // Each one alone still works.
    assert.equal((await call('/api/auth/me', { auth: `Bearer ${tokenB}` })).status, 200);
  }));
});

test('no browser may use the mobile endpoints: any Origin header is 403 before credentials are read', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    for (const origin of [ORIGIN, 'https://evil.example', 'null', '']) {
      const res = await login(call, u, { origin });
      assert.equal(res.status, 403, `login origin=${JSON.stringify(origin)}`);
      assert.deepEqual(await res.json(), { error: 'Origen no permitido' });
      assertMobileHeaders(res, 'login with origin');
    }
    assert.equal(await sessionCount(u.id), 0, 'no token was minted for a browser');
    const { token } = await (await login(call, u)).json();
    const out = await call('/api/auth/mobile/logout', { method: 'POST', auth: `Bearer ${token}`, origin: 'https://evil.example' });
    assert.equal(out.status, 403);
    assert.equal((await call('/api/auth/me', { auth: `Bearer ${token}` })).status, 200, 'the refused logout ended nothing');
  }));
});

test('a mobile token may write without Origin, never with a foreign one, and keeps its role limits', { skip }, async () => {
  const admin = await makeUser('admin');
  const client = await makeUser('client');
  await flagOn(() => withServer(async (call) => {
    const { token } = await (await login(call, admin)).json();
    const { token: clientToken } = await (await login(call, client)).json();
    const guardError = async (res) => res.status === 403 && /^(Origen no permitido|invalid_origin)$/.test((await res.clone().json()).error || '');
    for (const [method, path] of [['POST', '/api/presupuestos'], ['PUT', '/api/finanzas/pagos-trabajadores/periodo']]) {
      const native = await call(path, { method, auth: `Bearer ${token}`, body: {} });
      assert.ok(!(await guardError(native)), `${method} ${path} without Origin passes the guard (${native.status})`);
      const foreign = await call(path, { method, auth: `Bearer ${token}`, origin: 'https://evil.example', body: {} });
      assert.ok(await guardError(foreign), `${method} ${path} with a foreign Origin is refused`);
    }
    // Passing the guard grants nothing else: a client is still refused by role.
    const res = await call('/api/finanzas/pagos-trabajadores/periodo', { method: 'PUT', auth: `Bearer ${clientToken}`, body: {} });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'No tienes permiso para esto');
    // Public invitation routes stay strict even with a valid token.
    assert.ok(await guardError(await call('/api/invitaciones/aceptacion/consultar', { method: 'POST', auth: `Bearer ${token}`, body: {} })));
  }));
});

test('HTTPS only in production: without X-Forwarded-Proto https the token is never issued', { skip }, async () => {
  const u = await makeUser();
  await withEnv({ [FLAG]: 'true', NODE_ENV: 'production' }, () => withServer(async (call) => {
    const plain = await login(call, u);
    assert.equal(plain.status, 403);
    assert.deepEqual(await plain.json(), { error: 'Se requiere HTTPS' });
    assert.equal(await sessionCount(u.id), 0);
    const secure = await login(call, u, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(secure.status, 200);
    assertMobileHeaders(secure, 'https login');
  }));
});

test('web sessions are unchanged and independent of mobile ones', { skip }, async () => {
  const u = await makeUser();
  await flagOn(() => withServer(async (call) => {
    const web = await call('/api/auth/login', { method: 'POST', body: { email: u.email, password: PASSWORD } });
    assert.equal(web.status, 200);
    const webBody = await web.json();
    assert.ok(!('token' in webBody), 'the web login never returns the token');
    assert.deepEqual(Object.keys(webBody.user).sort(), ['created_at', 'email', 'id', 'name', 'role']);
    const setCookie = web.headers.get('set-cookie') || '';
    assert.match(setCookie, /^ledens_session=[a-f0-9]{64};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    const { token } = await (await login(call, u)).json();
    assert.notEqual(cookie, `${SESSION_COOKIE}=${token}`, 'two distinct sessions');
    // Mobile logout leaves the web session alive…
    assert.equal((await call('/api/auth/mobile/logout', { method: 'POST', auth: `Bearer ${token}` })).status, 200);
    assert.equal((await call('/api/auth/me', { cookie })).status, 200);
    // …and the web logout leaves a mobile session alive.
    const { token: token2 } = await (await login(call, u)).json();
    assert.equal((await call('/api/auth/logout', { method: 'POST', cookie, body: {} })).status, 200);
    assert.equal((await call('/api/auth/me', { cookie })).status, 401);
    assert.equal((await call('/api/auth/me', { auth: `Bearer ${token2}` })).status, 200);
  }));
});

test('tokens, passwords and emails never reach the logs', { skip }, async () => {
  const u = await makeUser();
  const lines = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  let token;
  try {
    await flagOn(() => withServer(async (call) => {
      await call('/api/auth/mobile/login', { method: 'POST', body: { email: u.email, password: 'wrong-password' } });
      ({ token } = await (await login(call, u)).json());
      await call('/api/auth/me', { auth: `Bearer ${token}` });
      await call('/api/auth/mobile/logout', { method: 'POST', auth: `Bearer ${token}` });
    }));
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(token);
  for (const secret of [token, PASSWORD, 'wrong-password', u.email]) {
    assert.ok(!lines.some((l) => l.includes(secret)), `"${secret.slice(0, 6)}…" was written to the logs`);
  }
  assert.ok(lines.some((l) => l.includes('[auth] mobile login') && l.includes(u.id)), 'the login is logged by user id');
});

test('diagnóstico: answers with the flag off and on, and exposes only booleans and counts', { skip }, async () => {
  for (const flag of [undefined, 'true']) {
    await withEnv({ [FLAG]: flag }, () => withServer(async (call, ip) => {
      const secret = 'a'.repeat(64);
      const res = await call('/api/auth/mobile/diagnostico', {
        auth: `Bearer ${secret}`, cookie: `${SESSION_COOKIE}=${secret}`, origin: 'https://evil.example',
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(res.status, 200, `flag=${flag}`);
      assert.match(res.headers.get('cache-control') || '', /no-store/);
      assert.equal(res.headers.get('set-cookie'), null);
      const raw = await res.text();
      for (const leak of [secret, ip, 'evil.example', '127.0.0.1']) assert.ok(!raw.includes(leak), `diagnóstico leaked ${leak}`);
      const body = JSON.parse(raw);
      assert.deepEqual(Object.keys(body).sort(), ['authorizationHeader', 'cookieHeader', 'forwardedFor', 'https', 'ipIsInternal', 'mobileAuthEnabled', 'originHeader', 'replica']);
      assert.equal(body.mobileAuthEnabled, flag === 'true');
      assert.equal(body.https, true);
      assert.equal(body.authorizationHeader, true);
      assert.equal(body.originHeader, true);
      assert.equal(body.cookieHeader, true);
      // Behind `trust proxy 1` with one X-Forwarded-For entry, req.ip is that entry.
      assert.deepEqual(body.forwardedFor, { entries: 1, ipIsFirstEntry: true, ipIsLastEntry: true });
      assert.equal(body.ipIsInternal, false, '198.51.100.x is a public (documentation) address');
      assert.match(body.replica, /^[a-f0-9]{8}$/);
    }));
  }
  // Nothing sent: everything false, and a spoofed extra entry is visible as such.
  await flagOn(() => withServer(async (call) => {
    const plain = await (await call('/api/auth/mobile/diagnostico')).json();
    assert.equal(plain.authorizationHeader, false);
    assert.equal(plain.originHeader, false);
    assert.equal(plain.cookieHeader, false);
    assert.equal(plain.https, false, 'plain http in the test server');
    const spoofed = await (await call('/api/auth/mobile/diagnostico', { headers: { 'X-Forwarded-For': '203.0.113.9, 198.51.100.200' } })).json();
    assert.deepEqual(spoofed.forwardedFor, { entries: 2, ipIsFirstEntry: false, ipIsLastEntry: true });
  }));
});
