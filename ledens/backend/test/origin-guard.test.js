import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/passwords.js';
import { createSession, readSessionCredential, SESSION_COOKIE } from '../src/auth/sessions.js';
import { requireSameOrigin, requireSameOriginBeforeAuth } from '../src/auth/origin.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
import { createObrasRouter } from '../src/routes/obras.js';
import { createInvitacionesRouter } from '../src/routes/invitaciones.js';
import { createHerramientasRouter } from '../src/routes/herramientas.js';
import { createFinanzasRouter } from '../src/routes/finanzas.js';
import { createFinanceRouter } from '../src/routes/finance.js';
import { createBridgeRouter } from '../src/routes/bridge.js';

// PR 6 of Ledens Mobile: one origin (CSRF) guard for every router with writes
// (src/auth/origin.js). Cookie and anonymous writes keep today's exact rule;
// the only exception is a write with no Origin that requireAuth authenticated
// through a Bearer token while MOBILE_AUTH_ENABLED=true.
// Sections 1 and 2 need no database; section 3 needs a real Postgres:
//   DATABASE_URL=postgres://ledens:ledens_dev_password@localhost:5432/ledens npm test
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

const ORIGIN = 'https://ledens.test';
const EVIL = 'https://evil.example';
const FLAG = 'MOBILE_AUTH_ENABLED';
const TOKEN = 'a'.repeat(64);
const GUARD_BODIES = [{ error: 'Origen no permitido' }, { error: 'invalid_origin' }];

async function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env[name]; else process.env[name] = prev;
  }
}
const withFlag = (value, fn) => withEnv(FLAG, value, fn);

// ── 1. The middleware alone ─────────────────────────────────────────────────

const fakeReq = ({ method = 'POST', origin, authorization, cookie, authTransport, user } = {}) => ({
  method,
  cookies: cookie === undefined ? {} : { [SESSION_COOKIE]: cookie },
  authTransport,
  user,
  get: (name) => ({ origin, authorization })[name.toLowerCase()],
});
function run(mw, req) {
  const out = { next: false, status: null, body: null };
  const res = { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
  mw(req, res, () => { out.next = true; });
  return out;
}
const USER = { id: 'u1', role: 'admin' };
const passes = (out) => out.next === true && out.status === null;

test('GET, HEAD and OPTIONS always pass, whatever the Origin', async () => {
  const mw = requireSameOrigin({ origin: ORIGIN });
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    for (const origin of [undefined, EVIL, ORIGIN]) assert.ok(passes(run(mw, fakeReq({ method, origin }))), `${method} ${origin}`);
  }
});

test('cookie (or no credential) writes: Origin must equal CORS_ORIGIN, else 403 with the router\'s body', async () => {
  for (const flag of [undefined, 'true']) {
    await withFlag(flag, () => {
      for (const body of [undefined, { error: 'invalid_origin' }]) {
        const mw = requireSameOrigin({ origin: ORIGIN, ...(body ? { body } : {}) });
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          for (const transport of [undefined, 'cookie']) {
            const user = transport ? USER : undefined;
            for (const origin of [undefined, EVIL, 'null', `${ORIGIN}.evil.example`, `${ORIGIN}/`, ORIGIN.toUpperCase()]) {
              const out = run(mw, fakeReq({ method, origin, authTransport: transport, user }));
              assert.equal(out.status, 403, `${method} ${transport} ${origin} flag=${flag}`);
              assert.deepEqual(out.body, body || { error: 'Origen no permitido' });
              assert.equal(out.next, false);
            }
            assert.ok(passes(run(mw, fakeReq({ method, origin: ORIGIN, authTransport: transport, user }))));
          }
        }
      }
    });
  }
});

test('no origin configured: every write is refused, even from a validated Bearer with our Origin', async () => {
  await withFlag('true', async () => {
    for (const mw of [requireSameOrigin({ origin: undefined }), requireSameOrigin({ origin: '' })]) {
      assert.equal(run(mw, fakeReq({ origin: ORIGIN })).status, 403);
      assert.equal(run(mw, fakeReq({ origin: ORIGIN, authTransport: 'bearer', user: USER })).status, 403);
    }
    // Without `origin` the guard reads CORS_ORIGIN on every request (bridge).
    const perRequest = requireSameOrigin();
    await withEnv('CORS_ORIGIN', undefined, () => assert.equal(run(perRequest, fakeReq({})).status, 403));
    await withEnv('CORS_ORIGIN', ORIGIN, () => {
      assert.ok(passes(run(perRequest, fakeReq({ origin: ORIGIN }))));
      assert.equal(run(perRequest, fakeReq({ origin: EVIL })).status, 403);
    });
  });
});

test('Bearer exemption: only a validated Bearer (req.authTransport + req.user), only with the flag on, only without Origin', async () => {
  const mw = requireSameOrigin({ origin: ORIGIN });
  await withFlag('true', () => {
    assert.ok(passes(run(mw, fakeReq({ authTransport: 'bearer', user: USER }))), 'validated Bearer, no Origin');
    assert.ok(passes(run(mw, fakeReq({ authTransport: 'bearer', user: USER, origin: ORIGIN }))), 'validated Bearer, our Origin');
    for (const origin of [EVIL, 'null', '']) {
      assert.equal(run(mw, fakeReq({ authTransport: 'bearer', user: USER, origin })).status, 403, `Bearer with Origin ${origin}`);
    }
    // The raw header is never enough: requireAuth must have validated it.
    assert.equal(run(mw, fakeReq({ authorization: `Bearer ${TOKEN}` })).status, 403, 'header only');
    assert.equal(run(mw, fakeReq({ authorization: `Bearer ${TOKEN}`, authTransport: 'bearer' })).status, 403, 'no req.user');
    assert.equal(run(mw, fakeReq({ authorization: `Bearer ${TOKEN}`, user: USER })).status, 403, 'no authTransport');
    assert.equal(run(mw, fakeReq({ authorization: `Bearer ${TOKEN}`, authTransport: 'cookie', user: USER })).status, 403, 'cookie transport');
  });
  for (const flag of [undefined, 'false', '1', 'TRUE']) {
    await withFlag(flag, () => {
      assert.equal(run(mw, fakeReq({ authTransport: 'bearer', user: USER })).status, 403, `flag=${flag}`);
    });
  }
});

test('before-auth variant: cookie and anonymous answered exactly as the full guard; only a Bearer-shaped request is deferred', async () => {
  const pre = requireSameOriginBeforeAuth({ origin: ORIGIN });
  const full = requireSameOrigin({ origin: ORIGIN });
  for (const flag of [undefined, 'true']) {
    await withFlag(flag, () => {
      for (const origin of [undefined, EVIL, ORIGIN]) {
        for (const extra of [{}, { cookie: 'c' }, { cookie: 'c', authorization: `Bearer ${TOKEN}` }, { authorization: 'Bearer nope' }, { authorization: `Basic ${TOKEN}` }]) {
          const a = run(pre, fakeReq({ origin, ...extra }));
          const b = run(full, fakeReq({ origin, ...extra }));
          assert.deepEqual(a, b, `${JSON.stringify(extra)} origin=${origin} flag=${flag}`);
        }
      }
    });
  }
  // Flag on, well-formed Bearer, no cookie: deferred to requireAuth + requireSameOrigin.
  await withFlag('true', () => {
    assert.ok(passes(run(pre, fakeReq({ authorization: `Bearer ${TOKEN}` }))));
    // With an Origin, a Bearer request needs ours anyway: decided right here.
    assert.equal(run(pre, fakeReq({ authorization: `Bearer ${TOKEN}`, origin: EVIL })).status, 403);
    assert.ok(passes(run(pre, fakeReq({ authorization: `Bearer ${TOKEN}`, origin: ORIGIN }))));
  });
  // Flag off: the header means nothing, so nothing is deferred.
  await withFlag(undefined, () => assert.equal(run(pre, fakeReq({ authorization: `Bearer ${TOKEN}` })).status, 403));
});

// ── 2. Every router uses it (no database) ──────────────────────────────────

// Stands in for requireAuth without a database: any token is a live session,
// but which credential counts is decided by the real readSessionCredential.
const fakeAuth = (req, res, next) => {
  const c = readSessionCredential(req);
  if (c.error || !c.token) return res.status(401).json({ error: 'No autenticado' });
  req.user = { id: '11111111-1111-1111-1111-111111111111', email: 'admin@example.com', role: 'admin' };
  req.authTransport = c.transport;
  next();
};
const failingPool = { query: async () => { throw new Error('stub pool'); }, connect: async () => { throw new Error('stub pool'); } };
const ID = '00000000-0000-0000-0000-000000000000';
const ROUTERS = [
  ['presupuestos', '/api/presupuestos', () => createPresupuestosRouter({ authenticate: fakeAuth, findUser: async () => null, pool: failingPool, ocr: null, translator: null, anthropic: null, storage: {}, origin: ORIGIN }), 'POST', '/api/presupuestos', 'Origen no permitido'],
  ['obras', '/api/obras', () => createObrasRouter({ authenticate: fakeAuth, findUser: async () => null, pool: failingPool, storage: {}, origin: ORIGIN }), 'POST', `/api/obras/${ID}/archivos`, 'Origen no permitido'],
  ['invitaciones (equipo)', '/api/invitaciones', () => createInvitacionesRouter({ authenticate: fakeAuth, findUser: async () => null, pool: failingPool, origin: ORIGIN }), 'POST', `/api/invitaciones/obras/${ID}`, 'Origen no permitido'],
  ['invitaciones (sesion)', '/api/invitaciones', () => createInvitacionesRouter({ authenticate: fakeAuth, findUser: async () => null, pool: failingPool, origin: ORIGIN }), 'POST', '/api/invitaciones/aceptacion/sesion', 'Origen no permitido'],
  ['herramientas', '/api/herramientas', () => createHerramientasRouter({ authenticate: fakeAuth, findUser: async () => null, pool: failingPool, storage: {}, origin: ORIGIN }), 'POST', '/api/herramientas/tipos', 'Origen no permitido'],
  ['finanzas', '/api/finanzas', () => createFinanzasRouter({ service: {}, authenticate: fakeAuth, findUser: async () => null, origin: ORIGIN }), 'PUT', '/api/finanzas/pagos-trabajadores/periodo', 'Origen no permitido'],
  ['finance', '/api', () => createFinanceRouter({ service: { bulk: async () => ({ ok: true }) }, authorize: fakeAuth, origin: ORIGIN }), 'POST', '/api/finance/allocations/bulk', 'invalid_origin'],
  ['bridge', '/api/bridge', () => createBridgeRouter({ service: { pool: failingPool }, authorize: fakeAuth }), 'POST', `/api/bridge/${ID}/confirm`, 'invalid_origin'],
];

async function withRouter(mount, build, fn) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(mount, build());
  app.use((err, _req, res, _next) => res.status(500).json({ error: 'stub' }));
  const server = http.createServer(app);
  server.listen(0);
  await once(server, 'listening');
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}
const call = (base, method, path, { origin, auth, cookie } = {}) => fetch(`${base}${path}`, {
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(origin ? { Origin: origin } : {}),
    ...(auth ? { Authorization: auth } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: '{}',
});
async function isGuarded(res) {
  if (res.status !== 403) return false;
  const body = await res.json().catch(() => null);
  return GUARD_BODIES.some((b) => JSON.stringify(b) === JSON.stringify(body));
}

for (const [name, mount, build, method, path, message] of ROUTERS) {
  test(`${name}: the shared guard, with its own 403 body`, async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      await withEnv('CORS_ORIGIN', ORIGIN, () => withRouter(mount, build, async (base) => {
        for (const flag of [undefined, 'true']) {
          await withFlag(flag, async () => {
            for (const origin of [undefined, EVIL]) {
              const res = await call(base, method, path, { origin, cookie: `${SESSION_COOKIE}=c` });
              assert.equal(res.status, 403, `cookie origin=${origin} flag=${flag}`);
              assert.deepEqual(await res.json(), { error: message }, 'byte-identical body');
            }
            assert.equal(await isGuarded(await call(base, method, path, { origin: ORIGIN, cookie: `${SESSION_COOKIE}=c` })), false, `cookie + our Origin flag=${flag}`);
          });
        }
        await withFlag('true', async () => {
          assert.equal(await isGuarded(await call(base, method, path, { auth: `Bearer ${TOKEN}` })), false, 'Bearer without Origin passes');
          const foreign = await call(base, method, path, { auth: `Bearer ${TOKEN}`, origin: EVIL });
          assert.equal(foreign.status, 403, 'Bearer with a foreign Origin');
          assert.deepEqual(await foreign.json(), { error: message });
          // With our Origin so that only authentication decides (invitaciones
          // checks the Origin first for anything that is not Bearer alone).
          assert.equal((await call(base, method, path, { auth: `Bearer ${TOKEN}`, cookie: `${SESSION_COOKIE}=c`, origin: ORIGIN })).status, 401, 'cookie + Bearer');
          assert.equal((await call(base, method, path, { auth: 'Bearer nope', cookie: `${SESSION_COOKIE}=c`, origin: ORIGIN })).status, 401, 'malformed Bearer + cookie');
        });
        await withFlag(undefined, async () => {
          // Flag off: the header is ignored, so there is no credential at all…
          const res = await call(base, method, path, { auth: `Bearer ${TOKEN}` });
          assert.ok(res.status === 401 || (await isGuarded(res)), `flag off: ${res.status}`);
        });
      }));
    } finally { console.error = quiet; }
  });
}

test('invitaciones: the public /aceptacion routes keep requiring the web Origin, Bearer or not', async () => {
  await withRouter('/api/invitaciones', ROUTERS[2][2], async (base) => {
    for (const flag of [undefined, 'true']) {
      await withFlag(flag, async () => {
        for (const route of ['consultar', 'contrasena', 'proveedor']) {
          for (const opts of [{}, { origin: EVIL }, { auth: `Bearer ${TOKEN}` }, { auth: `Bearer ${TOKEN}`, origin: EVIL }, { cookie: `${SESSION_COOKIE}=c` }]) {
            const res = await call(base, 'POST', `/api/invitaciones/aceptacion/${route}`, opts);
            assert.equal(res.status, 403, `${route} ${JSON.stringify(opts)} flag=${flag}`);
            assert.deepEqual(await res.json(), { error: 'Origen no permitido' });
          }
        }
      });
    }
  });
});

test('bridge: an unset CORS_ORIGIN now refuses writes, like every other router', async () => {
  await withEnv('CORS_ORIGIN', undefined, () => withRouter('/api/bridge', ROUTERS[7][2], async (base) => {
    const res = await call(base, 'POST', `/api/bridge/${ID}/confirm`, { cookie: `${SESSION_COOKIE}=c` });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'invalid_origin' });
  }));
});

// ── 3. Through the real app and database ────────────────────────────────────

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

async function withServer(fn) {
  const server = http.createServer(createApp());
  server.listen(0);
  await once(server, 'listening');
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

const created = [];
async function makeUser(role) {
  const email = `origin-${role}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const { rows } = await getPool().query(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, role',
    [email, `Origin ${role}`, role, hashPassword('password123')],
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

const req = (base, path, { method = 'POST', cookie, auth, origin, body = {} } = {}) => fetch(`${base}${path}`, {
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(auth !== undefined ? { Authorization: auth } : {}),
    ...(origin ? { Origin: origin } : {}),
  },
  body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body),
});

// One write per router; bodies that stop in validation, so nothing is written.
const WRITES = [
  ['POST', '/api/presupuestos', 'Origen no permitido'],
  ['POST', `/api/obras/${ID}/archivos`, 'Origen no permitido'],
  ['POST', `/api/invitaciones/obras/${ID}`, 'Origen no permitido'],
  ['POST', '/api/herramientas/tipos', 'Origen no permitido'],
  ['PUT', '/api/finanzas/pagos-trabajadores/periodo', 'Origen no permitido'],
  ['POST', '/api/finance/allocations/bulk', 'invalid_origin'],
  ['POST', `/api/bridge/${ID}/confirm`, 'invalid_origin'],
];

test('real app, cookie: no Origin → 403, foreign Origin → 403, our Origin → passes (flag off and on)', { skip }, async () => {
  const admin = await makeUser('admin');
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const flag of [undefined, 'true']) {
      await withFlag(flag, () => withServer(async (base) => {
        for (const [method, path, message] of WRITES) {
          for (const origin of [undefined, EVIL]) {
            const res = await req(base, path, { method, cookie: admin.cookie, origin });
            assert.equal(res.status, 403, `${method} ${path} origin=${origin} flag=${flag}`);
            assert.deepEqual(await res.json(), { error: message });
          }
          assert.equal(await isGuarded(await req(base, path, { method, cookie: admin.cookie, origin: ORIGIN })), false, `${path} with our Origin`);
        }
      }));
    }
  } finally { console.error = quiet; }
});

test('real app, Bearer: no Origin passes with the flag on; foreign Origin 403; flag off 401', { skip }, async () => {
  const admin = await makeUser('admin');
  const quiet = console.error;
  console.error = () => {};
  try {
    await withFlag('true', () => withServer(async (base) => {
      for (const [method, path, message] of WRITES) {
        assert.equal(await isGuarded(await req(base, path, { method, auth: admin.bearer })), false, `${path}: Bearer, no Origin`);
        assert.equal(await isGuarded(await req(base, path, { method, auth: admin.bearer, origin: ORIGIN })), false, `${path}: Bearer, our Origin`);
        for (const origin of [EVIL, 'null']) {
          const res = await req(base, path, { method, auth: admin.bearer, origin });
          assert.equal(res.status, 403, `${path}: Bearer, Origin ${origin}`);
          assert.deepEqual(await res.json(), { error: message });
        }
      }
    }));
    for (const flag of [undefined, 'false']) {
      await withFlag(flag, () => withServer(async (base) => {
        for (const [method, path] of WRITES) {
          // As today: no credential → 401, or 403 where the guard runs first (invitaciones).
          const res = await req(base, path, { method, auth: admin.bearer });
          assert.ok(res.status === 401 || (await isGuarded(res)), `${path} flag=${flag}: ${res.status}`);
          if (!path.startsWith('/api/invitaciones')) assert.equal(res.status, 401, path);
        }
      }));
    }
  } finally { console.error = quiet; }
});

test('real app: a validated Bearer write really runs, with the same role rules as the cookie', { skip }, async () => {
  const jefe = await makeUser('jefe');
  const client = await makeUser('client');
  const body = { title: 'Presupuesto por Bearer', clientId: client.id };
  await withFlag('true', () => withServer(async (base) => {
    const ok = await req(base, '/api/presupuestos', { auth: jefe.bearer, body });
    assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
    const { rows } = await getPool().query('SELECT jefe_id FROM presupuestos WHERE id = $1', [(await ok.json()).id]);
    assert.equal(rows[0]?.jefe_id, jefe.id);
    // A client cannot create one, whatever the transport: same 403 as with the cookie.
    const viaBearer = await req(base, '/api/presupuestos', { auth: client.bearer, body });
    const viaCookie = await req(base, '/api/presupuestos', { cookie: client.cookie, origin: ORIGIN, body });
    assert.equal(viaBearer.status, 403);
    assert.deepEqual(await viaBearer.json(), await viaCookie.json());
  }));
});

test('real app: cookie and Bearer together, or a malformed Bearer next to a valid cookie, are 401 on a write', { skip }, async () => {
  const a = await makeUser('admin');
  const b = await makeUser('admin');
  await withFlag('true', () => withServer(async (base) => {
    for (const [method, path] of WRITES) {
      for (const origin of [undefined, ORIGIN]) {
        for (const opts of [{ cookie: a.cookie, auth: b.bearer }, { cookie: a.cookie, auth: a.bearer }, { cookie: a.cookie, auth: 'Bearer nope' }, { cookie: a.cookie, auth: `Bearer ${a.token.toUpperCase()}` }]) {
          const res = await req(base, path, { method, origin, ...opts });
          // Without Origin, invitaciones' guard (before auth) answers 403 first,
          // exactly as for any cookie request today; blocked either way.
          if (origin === undefined && path.startsWith('/api/invitaciones')) {
            assert.ok(await isGuarded(res), path);
            continue;
          }
          assert.equal(res.status, 401, `${path} ${opts.auth.slice(0, 12)} origin=${origin}`);
          assert.deepEqual(await res.json(), { error: 'No autenticado' });
        }
      }
    }
  }));
});

test('real app: anonymous writes to the public invitation routes without Origin stay 403', { skip }, async () => {
  for (const flag of [undefined, 'true']) {
    await withFlag(flag, () => withServer(async (base) => {
      for (const route of ['consultar', 'contrasena', 'proveedor', 'sesion']) {
        for (const opts of [{}, { origin: EVIL }, { auth: `Bearer ${crypto.randomBytes(32).toString('hex')}`, origin: EVIL }]) {
          const res = await req(base, `/api/invitaciones/aceptacion/${route}`, { body: { token: 'x' }, ...opts });
          assert.equal(res.status, 403, `${route} ${JSON.stringify(opts)} flag=${flag}`);
          assert.deepEqual(await res.json(), { error: 'Origen no permitido' });
        }
      }
      // A Bearer-shaped header on a public route: the web Origin is still required.
      for (const route of ['consultar', 'contrasena', 'proveedor']) {
        const res = await req(base, `/api/invitaciones/aceptacion/${route}`, { body: { token: 'x' }, auth: `Bearer ${TOKEN}` });
        assert.equal(res.status, 403, `${route} Bearer-shaped flag=${flag}`);
      }
      // …and on /sesion an unknown token never gets past requireAuth.
      const sesion = await req(base, '/api/invitaciones/aceptacion/sesion', { body: { token: 'x' }, auth: `Bearer ${TOKEN}` });
      assert.equal(sesion.status, flag === 'true' ? 401 : 403);
    }));
  }
});

test('real app: a CORS preflight from a foreign origin asking for Authorization gets no ACAO for it', { skip }, async () => {
  await withFlag('true', () => withServer(async (base) => {
    for (const [method, path] of [...WRITES, ['POST', '/api/invitaciones/aceptacion/sesion']]) {
      const res = await fetch(`${base}${path}`, {
        method: 'OPTIONS',
        headers: { Origin: EVIL, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      const acao = res.headers.get('access-control-allow-origin');
      assert.notEqual(acao, EVIL, path);
      assert.notEqual(acao, '*', path);
    }
  }));
});
