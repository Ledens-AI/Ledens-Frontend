import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { findOrCreateUserFromIdentity, EmailInUseError } from '../src/auth/identities.js';

// Needs a real Postgres, same as db.test.js / auth.test.js.
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

let appServer, appBase;
let fakeGoogle, fakeGoogleBase;
// Each test sets these before making its request — this is the "mock
// Google's response" the issue asks for: a real local server stands in for
// Google's token + userinfo endpoints, so the actual route code runs
// end-to-end, not just the parts we choose to unit-test.
let nextTokenResponse, nextUserinfoResponse;

before(async () => {
  if (skip) return;
  await runMigrations();

  fakeGoogle = http.createServer(async (req, res) => {
    for await (const _chunk of req); // drain the request body
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/token')) {
      res.end(JSON.stringify(nextTokenResponse ?? { access_token: 'fake-token' }));
    } else if (req.url.startsWith('/userinfo')) {
      res.end(JSON.stringify(nextUserinfoResponse ?? {}));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  fakeGoogle.listen(0);
  await once(fakeGoogle, 'listening');
  fakeGoogleBase = `http://127.0.0.1:${fakeGoogle.address().port}`;

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/auth/google/callback';
  process.env.GOOGLE_AUTH_URL = `${fakeGoogleBase}/authorize`;
  process.env.GOOGLE_TOKEN_URL = `${fakeGoogleBase}/token`;
  process.env.GOOGLE_USERINFO_URL = `${fakeGoogleBase}/userinfo`;

  appServer = http.createServer(createApp());
  appServer.listen(0);
  await once(appServer, 'listening');
  appBase = `http://127.0.0.1:${appServer.address().port}`;
});

after(async () => {
  if (appServer) await new Promise((resolve) => appServer.close(resolve));
  if (fakeGoogle) await new Promise((resolve) => fakeGoogle.close(resolve));
  await closePool();
});

function cookieFrom(res, name) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const match = all.find((c) => c.startsWith(`${name}=`));
  return match ? match.split(';')[0] : null;
}

async function startLogin() {
  const res = await fetch(`${appBase}/api/auth/google`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  const state = location.searchParams.get('state');
  const stateCookie = cookieFrom(res, 'oauth_state');
  assert.ok(state && stateCookie, 'the redirect must carry a state and set a matching cookie');
  return { state, stateCookie, location };
}

const cleanupByEmail = (email) => getPool().query('DELETE FROM users WHERE lower(email) = lower($1)', [email]);

test('GET /api/auth/google redirects to the authorize URL with the right params', { skip }, async () => {
  const { location } = await startLogin();
  assert.equal(location.origin + location.pathname, `${fakeGoogleBase}/authorize`);
  assert.equal(location.searchParams.get('client_id'), 'test-client-id');
  assert.equal(location.searchParams.get('scope'), 'openid email profile');
});

test('callback creates a new user on first Google login', { skip }, async () => {
  const email = `g1-${Date.now()}@example.com`;
  try {
    const { state, stateCookie } = await startLogin();
    nextUserinfoResponse = { sub: `google-${Date.now()}`, email, email_verified: true, name: 'Google User' };

    const cb = await fetch(`${appBase}/api/auth/google/callback?code=abc&state=${state}`, {
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

test('logging in again with the same Google account reuses the same user, not a second one', { skip }, async () => {
  const email = `g2-${Date.now()}@example.com`;
  const sub = `google-${Date.now()}`;
  try {
    nextUserinfoResponse = { sub, email, email_verified: true, name: 'Repeat User' };

    let { state, stateCookie } = await startLogin();
    const first = await fetch(`${appBase}/api/auth/google/callback?code=abc&state=${state}`, {
      redirect: 'manual', headers: { Cookie: stateCookie },
    });
    const firstMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(first, 'ledens_session') } });
    const firstId = (await firstMe.json()).user.id;

    ({ state, stateCookie } = await startLogin());
    const second = await fetch(`${appBase}/api/auth/google/callback?code=def&state=${state}`, {
      redirect: 'manual', headers: { Cookie: stateCookie },
    });
    const secondMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(second, 'ledens_session') } });
    const secondId = (await secondMe.json()).user.id;

    assert.equal(secondId, firstId);
  } finally {
    await cleanupByEmail(email);
  }
});

test('a verified Google login reclaims a pre-existing unverified password account — killing the old password and session', { skip }, async () => {
  // Security regression test. Password registration never proves anyone
  // owns the email they typed in (#10 left verification out of scope), so
  // an attacker could pre-register someone else's email. The account ends
  // up reclaimed by the real (Google-verified) owner — same account id,
  // since emails are unique and a duplicate isn't possible — but the
  // attacker's password and any session they already held must both die,
  // or "reclaimed" would be meaningless.
  const email = `g3-${Date.now()}@example.com`;
  try {
    const reg = await fetch(`${appBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Attacker-Registered', email, password: 'password123' }),
    });
    const attackerUserId = (await reg.json()).user.id;
    const attackerSessionCookie = cookieFrom(reg, 'ledens_session');

    const { state, stateCookie } = await startLogin();
    nextUserinfoResponse = { sub: `google-${Date.now()}`, email, email_verified: true, name: 'Real Owner' };
    const cb = await fetch(`${appBase}/api/auth/google/callback?code=abc&state=${state}`, {
      redirect: 'manual', headers: { Cookie: stateCookie },
    });
    const me = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(cb, 'ledens_session') } });
    const googleUserId = (await me.json()).user.id;

    assert.equal(googleUserId, attackerUserId, 'reclaimed, not duplicated — emails are unique');

    const oldSession = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: attackerSessionCookie } });
    assert.equal(oldSession.status, 401, "the attacker's prior session must be dead");

    const oldPassword = await fetch(`${appBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    assert.equal(oldPassword.status, 401, "the attacker's password must no longer work");
  } finally {
    await cleanupByEmail(email);
  }
});

test('a second verified provider on the same email links to an already-verified account', { skip }, async () => {
  // The safe version of linking: once an account has proven its email via
  // one social login, a second one (here simulated as a second Google login,
  // standing in for #12's Microsoft) is allowed to attach to it — this is
  // the actual feature auth_identities (#9) was built for.
  const email = `g4-${Date.now()}@example.com`;
  try {
    const { state, stateCookie } = await startLogin();
    nextUserinfoResponse = { sub: `google-first-${Date.now()}`, email, email_verified: true, name: 'Verified User' };
    const first = await fetch(`${appBase}/api/auth/google/callback?code=abc&state=${state}`, {
      redirect: 'manual', headers: { Cookie: stateCookie },
    });
    const firstMe = await fetch(`${appBase}/api/auth/me`, { headers: { Cookie: cookieFrom(first, 'ledens_session') } });
    const firstId = (await firstMe.json()).user.id;

    const user = await findOrCreateUserFromIdentity({
      provider: 'microsoft',
      providerUserId: `ms-${Date.now()}`,
      email,
      emailVerified: true,
      name: 'Verified User',
    });

    assert.equal(user.id, firstId, 'a second verified provider must join the already-verified account, not duplicate it');
  } finally {
    await cleanupByEmail(email);
  }
});

test('an unverified email on an existing account is refused cleanly, not a crash', { skip }, async () => {
  // Code-review-caught bug: when emailVerified is false (a real possibility
  // for Microsoft, per providers/microsoft.js's own comment) AND the email
  // already belongs to someone, the old code skipped straight to INSERT,
  // which collided with the unique index and surfaced as an opaque
  // "login failed" instead of a clear, catchable error.
  const email = `g5-${Date.now()}@example.com`;
  try {
    await fetch(`${appBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Existing User', email, password: 'password123' }),
    });

    await assert.rejects(
      findOrCreateUserFromIdentity({
        provider: 'microsoft',
        providerUserId: `ms-${Date.now()}`,
        email,
        emailVerified: false,
        name: 'Someone',
      }),
      EmailInUseError,
    );
  } finally {
    await cleanupByEmail(email);
  }
});

test('two logins for the same brand-new email racing each other both succeed, same account', { skip }, async () => {
  // Code-review-caught bug: a check-then-act race (look up by email, then
  // insert) meant the loser of two simultaneous first-time logins for the
  // same email got an unhandled unique-violation instead of being linked.
  const email = `g6-${Date.now()}@example.com`;
  try {
    const identity = (sub) => ({ provider: 'google', providerUserId: sub, email, emailVerified: true, name: 'Race User' });
    const [a, b] = await Promise.all([
      findOrCreateUserFromIdentity(identity(`race-a-${Date.now()}`)),
      findOrCreateUserFromIdentity(identity(`race-b-${Date.now()}`)),
    ]);
    assert.equal(a.id, b.id, 'both concurrent first-time logins must resolve to the same account');
  } finally {
    await cleanupByEmail(email);
  }
});

test('Google reporting a cancelled consent screen redirects to /auth, no session created', { skip }, async () => {
  const res = await fetch(`${appBase}/api/auth/google/callback?error=access_denied`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/auth?error=google_cancelled');
  assert.equal(cookieFrom(res, 'ledens_session'), null);
});

test('a missing or mismatched state is rejected, not trusted', { skip }, async () => {
  const res = await fetch(`${appBase}/api/auth/google/callback?code=abc&state=not-the-real-state`, {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/auth?error=google_failed');
});
