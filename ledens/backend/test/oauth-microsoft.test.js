import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';

const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

let appServer, appBase;
let fakeIdp, fakeIdpBase;
let nextTokenResponse, nextUserinfoResponse;

before(async () => {
  if (skip) return;
  await runMigrations();

  // One stand-in server plays both Microsoft and Google — routed by path —
  // so the last test here can prove cross-provider account linking through
  // the real HTTP routes, not just by calling the shared function directly
  // the way oauth-google.test.js's equivalent test does.
  fakeIdp = http.createServer(async (req, res) => {
    for await (const _chunk of req); // drain the request body
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/token')) {
      res.end(JSON.stringify(nextTokenResponse ?? { access_token: 'fake-token' }));
    } else if (req.url.endsWith('/userinfo')) {
      res.end(JSON.stringify(nextUserinfoResponse ?? {}));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  fakeIdp.listen(0);
  await once(fakeIdp, 'listening');
  fakeIdpBase = `http://127.0.0.1:${fakeIdp.address().port}`;

  process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-client-secret';
  process.env.MICROSOFT_REDIRECT_URI = 'http://localhost/api/auth/microsoft/callback';
  process.env.MICROSOFT_AUTH_URL = `${fakeIdpBase}/microsoft/authorize`;
  process.env.MICROSOFT_TOKEN_URL = `${fakeIdpBase}/microsoft/token`;
  process.env.MICROSOFT_USERINFO_URL = `${fakeIdpBase}/microsoft/userinfo`;

  // Only needed for the last, cross-provider test.
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/auth/google/callback';
  process.env.GOOGLE_AUTH_URL = `${fakeIdpBase}/google/authorize`;
  process.env.GOOGLE_TOKEN_URL = `${fakeIdpBase}/google/token`;
  process.env.GOOGLE_USERINFO_URL = `${fakeIdpBase}/google/userinfo`;

  appServer = http.createServer(createApp());
  appServer.listen(0);
  await once(appServer, 'listening');
  appBase = `http://127.0.0.1:${appServer.address().port}`;
});

after(async () => {
  if (appServer) await new Promise((resolve) => appServer.close(resolve));
  if (fakeIdp) await new Promise((resolve) => fakeIdp.close(resolve));
  await closePool();
});

function cookieFrom(res, name) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const match = all.find((c) => c.startsWith(`${name}=`));
  return match ? match.split(';')[0] : null;
}

async function startLogin(provider) {
  const res = await fetch(`${appBase}/api/auth/${provider}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  const state = location.searchParams.get('state');
  const stateCookie = cookieFrom(res, 'oauth_state');
  assert.ok(state && stateCookie, 'the redirect must carry a state and set a matching cookie');
  return { state, stateCookie, location };
}

const cleanupByEmail = (email) => getPool().query('DELETE FROM users WHERE lower(email) = lower($1)', [email]);

test('GET /api/auth/microsoft redirects to the authorize URL with the right params', { skip }, async () => {
  const { location } = await startLogin('microsoft');
  assert.equal(location.origin + location.pathname, `${fakeIdpBase}/microsoft/authorize`);
  assert.equal(location.searchParams.get('client_id'), 'test-client-id');
  assert.equal(location.searchParams.get('scope'), 'openid email profile');
});

test('callback creates a new user on first Microsoft login', { skip }, async () => {
  const email = `m1-${Date.now()}@example.com`;
  try {
    const { state, stateCookie } = await startLogin('microsoft');
    nextUserinfoResponse = { sub: `ms-${Date.now()}`, email, email_verified: true, name: 'Microsoft User' };

    const cb = await fetch(`${appBase}/api/auth/microsoft/callback?code=abc&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie },
    });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/');
    const sessionCookie = cookieFrom(cb, 'ledens_session');
    assert.ok(sessionCookie);

    const me = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: sessionCookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, email);
  } finally {
    await cleanupByEmail(email);
  }
});

test('logging in again with the same Microsoft account reuses the same user, not a second one', { skip }, async () => {
  const email = `m2-${Date.now()}@example.com`;
  const sub = `ms-${Date.now()}`;
  try {
    nextUserinfoResponse = { sub, email, email_verified: true, name: 'Repeat User' };

    let { state, stateCookie } = await startLogin('microsoft');
    const first = await fetch(`${appBase}/api/auth/microsoft/callback?code=abc&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie },
    });
    const firstMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(first, 'ledens_session') } });
    const firstId = (await firstMe.json()).user.id;

    ({ state, stateCookie } = await startLogin('microsoft'));
    const second = await fetch(`${appBase}/api/auth/microsoft/callback?code=def&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie },
    });
    const secondMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(second, 'ledens_session') } });
    const secondId = (await secondMe.json()).user.id;

    assert.equal(secondId, firstId);
  } finally {
    await cleanupByEmail(email);
  }
});

test('Microsoft reporting a cancelled consent screen redirects to /auth, no session created', { skip }, async () => {
  const res = await fetch(`${appBase}/api/auth/microsoft/callback?error=access_denied`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/auth?error=microsoft_cancelled');
  assert.equal(cookieFrom(res, 'ledens_session'), null);
});

test('a missing or mismatched state is rejected, not trusted', { skip }, async () => {
  const res = await fetch(`${appBase}/api/auth/microsoft/callback?code=abc&state=not-the-real-state`, {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/auth?error=microsoft_failed');
});

test('a Google-verified account can also log in with Microsoft on the same email — through the real routes', { skip }, async () => {
  const email = `cross-${Date.now()}@example.com`;
  try {
    // First: Google, verified — establishes the account as proven.
    let { state, stateCookie } = await startLogin('google');
    nextUserinfoResponse = { sub: `google-${Date.now()}`, email, email_verified: true, name: 'Cross Provider User' };
    const googleCb = await fetch(`${appBase}/api/auth/google/callback?code=abc&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie },
    });
    const googleMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(googleCb, 'ledens_session') } });
    const googleUserId = (await googleMe.json()).user.id;

    // Second: Microsoft, same email — must join the same account, not create
    // a second one or (worse) get rejected.
    ({ state, stateCookie } = await startLogin('microsoft'));
    nextUserinfoResponse = { sub: `ms-${Date.now()}`, email, email_verified: true, name: 'Cross Provider User' };
    const msCb = await fetch(`${appBase}/api/auth/microsoft/callback?code=def&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: stateCookie },
    });
    const msMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(msCb, 'ledens_session') } });
    const msUserId = (await msMe.json()).user.id;

    assert.equal(msUserId, googleUserId);
  } finally {
    await cleanupByEmail(email);
  }
});
