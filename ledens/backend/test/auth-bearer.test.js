import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/passwords.js';
import {
  createSession, destroySession, readSessionCredential, isMobileAuthEnabled, SESSION_COOKIE,
} from '../src/auth/sessions.js';

// PR 1 of Ledens Mobile: requireAuth also accepts the session token as
// `Authorization: Bearer <token>` when MOBILE_AUTH_ENABLED=true. The cookie
// flow of Ledens Web must not change, the origin (CSRF) guards must not be
// relaxed, and a request carrying both credentials is refused.
// The first block needs no database; the rest needs a real Postgres, same as
// auth.test.js:
//   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm test
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

const ORIGIN = 'https://ledens.test';
const FLAG = 'MOBILE_AUTH_ENABLED';

// The flag is read per request; each test sets it and puts the old value back.
async function withFlag(value, fn) {
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev;
  }
}

// ── 1. Which credential a request carries (no database) ────────────────────

const fakeReq = ({ cookie, authorization } = {}) => ({
  cookies: cookie === undefined ? {} : { [SESSION_COOKIE]: cookie },
  get: (name) => (name.toLowerCase() === 'authorization' ? authorization : undefined),
});
const TOKEN = 'a'.repeat(64);

test('the flag is off by default and only the exact string "true" turns it on', async () => {
  await withFlag(undefined, () => assert.equal(isMobileAuthEnabled(), false));
  for (const v of ['', 'false', '1', 'yes', 'TRUE', 'True', ' true', 'true ']) {
    await withFlag(v, () => assert.equal(isMobileAuthEnabled(), false, `"${v}" must not enable it`));
  }
  await withFlag('true', () => assert.equal(isMobileAuthEnabled(), true));
});

test('flag off: the Authorization header is ignored and the cookie decides, as before', async () => {
  await withFlag(undefined, () => {
    assert.deepEqual(readSessionCredential(fakeReq({ cookie: 'c' })), { transport: 'cookie', token: 'c' });
    assert.deepEqual(readSessionCredential(fakeReq({ authorization: `Bearer ${TOKEN}` })), { transport: 'cookie', token: undefined });
    assert.deepEqual(readSessionCredential(fakeReq({ cookie: 'c', authorization: `Bearer ${TOKEN}` })), { transport: 'cookie', token: 'c' });
    assert.deepEqual(readSessionCredential(fakeReq({ cookie: 'c', authorization: 'garbage' })), { transport: 'cookie', token: 'c' });
  });
});

test('flag on: no header → cookie; well-formed Bearer → bearer', async () => {
  await withFlag('true', () => {
    assert.deepEqual(readSessionCredential(fakeReq({ cookie: 'c' })), { transport: 'cookie', token: 'c' });
    assert.deepEqual(readSessionCredential(fakeReq({})), { transport: 'cookie', token: undefined });
    assert.deepEqual(readSessionCredential(fakeReq({ authorization: `Bearer ${TOKEN}` })), { transport: 'bearer', token: TOKEN });
  });
});

test('flag on: malformed Authorization headers are refused, never treated as absent', async () => {
  const bad = [
    '', 'Bearer', 'Bearer ', `bearer ${TOKEN}`, `BEARER ${TOKEN}`, `Bearer  ${TOKEN}`, `Bearer ${TOKEN} `,
    `Bearer ${'A'.repeat(64)}`, `Bearer ${'a'.repeat(63)}`, `Bearer ${'a'.repeat(65)}`, `Bearer ${'g'.repeat(64)}`,
    `Basic ${Buffer.from('a:b').toString('base64')}`, `Token ${TOKEN}`, `Bearer ${TOKEN},Bearer ${TOKEN}`,
    // The machine token of /api/v1/facturas/ingesta has another shape (base64url).
    `Bearer ${crypto.randomBytes(32).toString('base64url')}`,
  ];
  await withFlag('true', () => {
    for (const authorization of bad) {
      assert.deepEqual(readSessionCredential(fakeReq({ authorization })), { error: 'malformed_bearer' }, JSON.stringify(authorization));
    }
  });
});

test('flag on: a session cookie together with an Authorization header is refused', async () => {
  await withFlag('true', () => {
    assert.deepEqual(readSessionCredential(fakeReq({ cookie: 'c', authorization: `Bearer ${TOKEN}` })), { error: 'cookie_and_bearer' });
    assert.deepEqual(readSessionCredential(fakeReq({ cookie: 'c', authorization: 'garbage' })), { error: 'cookie_and_bearer' });
  });
});

// ── 2. Through the real app and database ────────────────────────────────────

let prevOrigin;
before(async () => {
  if (skip) return;
  // Routers read CORS_ORIGIN when createApp() builds them (bridge, per request).
  prevOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = ORIGIN;
  await runMigrations();
});
after(async () => {
  if (prevOrigin === undefined) delete process.env.CORS_ORIGIN; else process.env.CORS_ORIGIN = prevOrigin;
  if (!skip) await closePool();
});

// A fresh app per test: the shared /api limiter (30/min) lives in createApp(),
// so no test eats another one's budget.
async function withServer(fn) {
  const server = http.createServer(createApp());
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

const created = [];
async function makeUser(role) {
  const email = `bearer-${role}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const { rows } = await getPool().query(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
    [email, `Bearer ${role}`, role, hashPassword('password123')],
  );
  created.push(email);
  const { token } = await createSession(rows[0].id, { userAgent: 'test' });
  return { ...rows[0], token, cookie: `${SESSION_COOKIE}=${token}`, bearer: `Bearer ${token}` };
}
after(async () => {
  if (skip || !created.length) return;
  const pool = getPool();
  await pool.query('DELETE FROM presupuestos WHERE client_id IN (SELECT id FROM users WHERE email = ANY($1))', [created]).catch(() => {});
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [created]);
});

const req = (base, path, { method = 'GET', cookie, auth, origin, headers = {}, body } = {}) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(auth !== undefined ? { Authorization: auth } : {}),
    ...(origin ? { Origin: origin } : {}),
    ...headers,
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});
const meEmail = async (res) => (await res.json()).user?.email;

test('cookie authentication works as before, with the flag off and on', { skip }, async () => {
  const u = await makeUser('client');
  for (const flag of [undefined, 'true']) {
    await withFlag(flag, () => withServer(async (base) => {
      const res = await req(base, '/api/auth/me', { cookie: u.cookie });
      assert.equal(res.status, 200, `flag=${flag}`);
      assert.equal(await meEmail(res), u.email);
    }));
  }
});

test('Bearer authentication works with the flag on and is ignored with it off', { skip }, async () => {
  const u = await makeUser('jefe');
  await withFlag('true', () => withServer(async (base) => {
    const res = await req(base, '/api/auth/me', { auth: u.bearer });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, u.email);
    assert.equal(body.user.role, 'jefe');
    // Same /me contract as the cookie: same keys, nothing about the session.
    assert.deepEqual(Object.keys(body.user).sort(), ['created_at', 'email', 'email_verified', 'id', 'name', 'role']);
    assert.equal(res.headers.get('set-cookie'), null, 'a Bearer request never gets a cookie');
  }));
  for (const flag of [undefined, 'false', '1']) {
    await withFlag(flag, () => withServer(async (base) => {
      assert.equal((await req(base, '/api/auth/me', { auth: u.bearer })).status, 401, `flag=${flag}`);
    }));
  }
});

test('flag off: a Bearer header next to the cookie changes nothing (today\'s behaviour)', { skip }, async () => {
  const a = await makeUser('client');
  const b = await makeUser('admin');
  await withFlag(undefined, () => withServer(async (base) => {
    const res = await req(base, '/api/auth/me', { cookie: a.cookie, auth: b.bearer });
    assert.equal(res.status, 200);
    assert.equal(await meEmail(res), a.email, 'the cookie decides; the header is not read');
    assert.equal((await req(base, '/api/admin/users', { cookie: a.cookie, auth: b.bearer })).status, 403);
  }));
});

test('missing, unknown, malformed, expired and revoked tokens get the same 401', { skip }, async () => {
  const u = await makeUser('client');
  const expired = await makeUser('client');
  await getPool().query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [expired.id]);
  const revoked = await makeUser('client');
  await destroySession(revoked.token);
  const passwordReset = await makeUser('client');
  // What a new password (passwordLinks.js) or an invitation does: every session goes.
  await getPool().query('DELETE FROM sessions WHERE user_id = $1', [passwordReset.id]);

  await withFlag('true', () => withServer(async (base) => {
    const cases = {
      missing: {},
      unknown: { auth: `Bearer ${crypto.randomBytes(32).toString('hex')}` },
      malformedShort: { auth: `Bearer ${u.token.slice(1)}` },
      malformedUpper: { auth: `Bearer ${u.token.toUpperCase()}` },
      malformedScheme: { auth: `bearer ${u.token}` },
      malformedEmpty: { auth: '' },
      ingestShape: { auth: `Bearer ${crypto.randomBytes(32).toString('base64url')}` },
      expired: { auth: expired.bearer },
      revoked: { auth: revoked.bearer },
      revokedByPasswordReset: { auth: passwordReset.bearer },
    };
    for (const [name, opts] of Object.entries(cases)) {
      const res = await req(base, '/api/auth/me', opts);
      assert.equal(res.status, 401, name);
      assert.deepEqual(await res.json(), { error: 'No autenticado' }, `${name}: one message for every failure`);
    }
    // The same token still works when sent properly.
    assert.equal((await req(base, '/api/auth/me', { auth: u.bearer })).status, 200);
    // The expired/revoked cookie is refused too, as before.
    assert.equal((await req(base, '/api/auth/me', { cookie: expired.cookie })).status, 401);
    assert.equal((await req(base, '/api/auth/me', { cookie: revoked.cookie })).status, 401);
  }));
});

test('flag on: cookie and Bearer together are refused, whoever they belong to', { skip }, async () => {
  const a = await makeUser('client');
  const b = await makeUser('admin');
  await withFlag('true', () => withServer(async (base) => {
    const combos = {
      differentUsers: { cookie: a.cookie, auth: b.bearer },
      sameUser: { cookie: a.cookie, auth: a.bearer },
      deadCookieLiveBearer: { cookie: `${SESSION_COOKIE}=${'0'.repeat(64)}`, auth: b.bearer },
      liveCookieMalformedBearer: { cookie: a.cookie, auth: 'Bearer nope' },
    };
    for (const [name, opts] of Object.entries(combos)) {
      for (const path of ['/api/auth/me', '/api/admin/users', '/api/presupuestos']) {
        assert.equal((await req(base, path, opts)).status, 401, `${name} on ${path}`);
      }
    }
    // Other cookies (not the session one) do not count as a second credential.
    const res = await req(base, '/api/auth/me', { cookie: 'oauth_state=x; theme=dark', auth: b.bearer });
    assert.equal(res.status, 200);
    assert.equal(await meEmail(res), b.email);
  }));
});

test('roles and permissions are the same through Bearer as through the cookie', { skip }, async () => {
  const admin = await makeUser('admin');
  const jefe = await makeUser('jefe');
  const client = await makeUser('client');
  await withFlag('true', () => withServer(async (base) => {
    const expect = [
      // path, admin, jefe, client
      ['/api/admin/users', 200, 403, 403],
      ['/api/finanzas/resumen', null, null, 403],
      ['/api/projects', null, null, 403],
      // Team status not asserted: it reads ledens.customers, absent from the
      // auth CI schema (prepare-accounting-ci.js). Parity still is.
      ['/api/presupuestos/proyectos', null, null, 403],
      ['/api/presupuestos', 200, 200, 200],
    ];
    for (const [path, ...statuses] of expect) {
      for (const [u, status] of [[admin, statuses[0]], [jefe, statuses[1]], [client, statuses[2]]]) {
        const viaCookie = (await req(base, path, { cookie: u.cookie })).status;
        const viaBearer = (await req(base, path, { auth: u.bearer })).status;
        assert.equal(viaBearer, viaCookie, `${path} as ${u.role}: Bearer ${viaBearer} vs cookie ${viaCookie}`);
        if (status !== null) assert.equal(viaBearer, status, `${path} as ${u.role}`);
      }
    }
  }));
});

test('obras visible through Bearer are exactly those visible through the cookie', { skip }, async () => {
  const jefe = await makeUser('jefe');
  const otherJefe = await makeUser('jefe');
  const owner = await makeUser('client');
  const stranger = await makeUser('client');
  const pool = getPool();
  const { rows: [p] } = await pool.query(
    'INSERT INTO presupuestos (title, client_id, jefe_id, created_by) VALUES ($1, $2, $3, $3) RETURNING id',
    ['Obra de prueba Bearer', owner.id, jefe.id],
  );
  await pool.query(`INSERT INTO presupuesto_versiones (presupuesto_id, number, status, sent_at) VALUES ($1, 1, 'sent', now())`, [p.id]);

  await withFlag('true', () => withServer(async (base) => {
    const ids = async (opts) => {
      const res = await req(base, '/api/presupuestos', opts);
      assert.equal(res.status, 200);
      return (await res.json()).presupuestos.map((x) => x.id).filter((id) => id === p.id);
    };
    for (const [u, sees] of [[jefe, true], [otherJefe, false], [owner, true], [stranger, false]]) {
      const viaCookie = await ids({ cookie: u.cookie });
      const viaBearer = await ids({ auth: u.bearer });
      assert.deepEqual(viaBearer, viaCookie, u.email);
      assert.deepEqual(viaBearer, sees ? [p.id] : [], u.email);
      const detail = await req(base, `/api/presupuestos/${p.id}`, { auth: u.bearer });
      assert.equal(detail.status, sees ? 200 : 404, `detail for ${u.email}`);
    }
  }));
});

test('«Ver como» through Bearer: only an admin, only reading', { skip }, async () => {
  const admin = await makeUser('admin');
  const client = await makeUser('client');
  await withFlag('true', () => withServer(async (base) => {
    const asClient = await req(base, '/api/presupuestos', { auth: client.bearer, headers: { 'X-Ledens-View-As': admin.id } });
    assert.equal(asClient.status, 403, 'a client cannot view as anyone');
    const asAdmin = await req(base, '/api/presupuestos', { auth: admin.bearer, headers: { 'X-Ledens-View-As': client.id } });
    assert.equal(asAdmin.status, 200);
    const write = await req(base, '/api/presupuestos', {
      method: 'POST', auth: admin.bearer, origin: ORIGIN, headers: { 'X-Ledens-View-As': client.id }, body: {},
    });
    assert.equal(write.status, 403, 'viewing as someone stays read-only');
  }));
});

test('origin (CSRF) guards are not relaxed: no Origin or a foreign one is 403 for cookie and for Bearer', { skip }, async () => {
  const admin = await makeUser('admin');
  // One write per router that carries the guard. Bodies are irrelevant: the
  // guard answers before the handler runs.
  const writes = [
    ['POST', '/api/presupuestos'],
    ['POST', '/api/obras/00000000-0000-0000-0000-000000000000/archivos'],
    ['POST', '/api/invitaciones/obras/00000000-0000-0000-0000-000000000000'],
    ['POST', '/api/invitaciones/aceptacion/consultar'],
    ['PUT', '/api/finanzas/pagos-trabajadores/periodo'],
    ['POST', '/api/finance/allocations/bulk'],
    ['POST', '/api/bridge/00000000-0000-0000-0000-000000000000/dismiss'],
  ];
  const guardBody = async (res) => (await res.json()).error;
  for (const flag of [undefined, 'true']) {
    await withFlag(flag, () => withServer(async (base) => {
      for (const [method, path] of writes) {
        for (const origin of [undefined, 'https://evil.example', 'null', `${ORIGIN}.evil.example`]) {
          const viaCookie = await req(base, path, { method, cookie: admin.cookie, origin, body: {} });
          assert.equal(viaCookie.status, 403, `cookie ${method} ${path} origin=${origin} flag=${flag}`);
          assert.match(await guardBody(viaCookie), /Origen no permitido|invalid_origin/);
          if (flag === 'true') {
            const viaBearer = await req(base, path, { method, auth: admin.bearer, origin, body: {} });
            assert.equal(viaBearer.status, 403, `bearer ${method} ${path} origin=${origin}`);
            assert.match(await guardBody(viaBearer), /Origen no permitido|invalid_origin/);
          }
        }
      }
    }));
  }
});

test('the CORS policy never allows a foreign origin to send Authorization', { skip }, async () => {
  await withFlag('true', () => withServer(async (base) => {
    const res = await fetch(`${base}/api/auth/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    assert.notEqual(res.headers.get('access-control-allow-origin'), 'https://evil.example');
    assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
  }));
});

test('Ledens Web: login, cookie attributes, /me and logout are unchanged with the flag on', { skip }, async () => {
  const u = await makeUser('client');
  await withFlag('true', () => withServer(async (base) => {
    const login = await req(base, '/api/auth/login', { method: 'POST', body: { email: u.email, password: 'password123' } });
    assert.equal(login.status, 200);
    const body = await login.json();
    assert.ok(!('token' in body), 'the web login never returns the token in the body');
    assert.deepEqual(Object.keys(body.user).sort(), ['created_at', 'email', 'id', 'name', 'role']);
    const setCookie = login.headers.get('set-cookie') || '';
    assert.match(setCookie, /^ledens_session=[a-f0-9]{64};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\//);
    const cookie = setCookie.split(';')[0];
    assert.equal((await req(base, '/api/auth/me', { cookie })).status, 200);
    assert.equal((await req(base, '/api/auth/logout', { method: 'POST', cookie, body: {} })).status, 200);
    assert.equal((await req(base, '/api/auth/me', { cookie })).status, 401);
  }));
});

test('the web logout only ends the cookie session; a Bearer session is untouched (mobile logout is PR 2)', { skip }, async () => {
  const u = await makeUser('client');
  await withFlag('true', () => withServer(async (base) => {
    assert.equal((await req(base, '/api/auth/logout', { method: 'POST', auth: u.bearer, body: {} })).status, 200);
    assert.equal((await req(base, '/api/auth/me', { auth: u.bearer })).status, 200);
  }));
});

test('tokens never reach the logs on any Bearer path', { skip }, async () => {
  const u = await makeUser('admin');
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  try {
    await withFlag('true', () => withServer(async (base) => {
      await req(base, '/api/auth/me', { auth: u.bearer });
      await req(base, '/api/auth/me', { auth: `Bearer ${u.token}x` });
      await req(base, '/api/auth/me', { auth: u.bearer, cookie: u.cookie });
      await req(base, '/api/presupuestos', { auth: u.bearer });
      await req(base, '/api/presupuestos', { method: 'POST', auth: u.bearer, body: {} });
    }));
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(!lines.some((l) => l.includes(u.token)), 'a session token was written to the logs');
});
