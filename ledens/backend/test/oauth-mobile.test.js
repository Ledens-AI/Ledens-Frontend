import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { getPool, closePool, isDbConfigured } from '../src/db/pool.js';
import { dropUnproven } from '../src/invitaciones/service.js';

// Google / Microsoft login for Ledens Mobile (routes/oauth.js + auth/handoffs.js
// + POST /api/auth/mobile/exchange), end to end against a local stand-in for
// Google, like oauth-google.test.js. Also the web version of the app
// (/movil/, ?destino=movil). Needs the local Postgres.
const skip = !isDbConfigured() && 'DATABASE_URL not set — start the local db to run these';

let appServer, appBase, fakeGoogle, fakeGoogleBase;
let nextUserinfo;
const EMAIL = 'oauth-mobile-test@example.com';

before(async () => {
  if (skip) return;
  await runMigrations();
  fakeGoogle = http.createServer(async (req, res) => {
    for await (const _chunk of req);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/token')) return res.end(JSON.stringify({ access_token: 'fake-token' }));
    if (req.url.startsWith('/userinfo')) return res.end(JSON.stringify(nextUserinfo));
    res.statusCode = 404;
    res.end('{}');
  });
  fakeGoogle.listen(0);
  await once(fakeGoogle, 'listening');
  fakeGoogleBase = `http://127.0.0.1:${fakeGoogle.address().port}`;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback',
    GOOGLE_AUTH_URL: `${fakeGoogleBase}/authorize`,
    GOOGLE_TOKEN_URL: `${fakeGoogleBase}/token`,
    GOOGLE_USERINFO_URL: `${fakeGoogleBase}/userinfo`,
  });
});

after(async () => {
  delete process.env.MOBILE_AUTH_ENABLED;
  if (fakeGoogle) await new Promise((r) => fakeGoogle.close(r));
  if (!skip) await getPool().query('DELETE FROM users WHERE lower(email) = lower($1)', [EMAIL]);
  await closePool();
});

// A fresh app per test: each has its own 30/min API limiter, and these tests
// make more requests than that between them.
beforeEach(async () => {
  if (skip) return;
  appServer = http.createServer(createApp());
  appServer.listen(0);
  await once(appServer, 'listening');
  appBase = `http://127.0.0.1:${appServer.address().port}`;
});
afterEach(async () => {
  if (appServer) await new Promise((r) => appServer.close(r));
  appServer = null;
});

beforeEach(() => {
  process.env.MOBILE_AUTH_ENABLED = 'true';
  nextUserinfo = { sub: 'google-oauth-mobile-1', email: EMAIL, email_verified: true, name: 'Prueba Móvil' };
});

const setCookies = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : []);
const cookie = (res, name) => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? null;
const cleared = (res, name) => setCookies(res).some((c) => c.startsWith(`${name}=;`));
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

async function mobileLogin(challenge, { error } = {}) {
  const start = await fetch(`${appBase}/api/auth/google/mobile?code_challenge=${challenge}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const jar = [cookie(start, 'oauth_state'), cookie(start, 'oauth_mobile')];
  assert.ok(jar[0] && jar[1], 'sets the state and the mobile cookie');
  const qs = error ? `error=${error}` : `code=provider-code&state=${state}`;
  const cb = await fetch(`${appBase}/api/auth/google/callback?${qs}`, { redirect: 'manual', headers: { Cookie: jar.join('; ') } });
  return cb;
}
const exchange = (body, headers = {}) =>
  fetch(`${appBase}/api/auth/mobile/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('flag off: the mobile start and the exchange do not exist', { skip }, async () => {
  delete process.env.MOBILE_AUTH_ENABLED;
  const { challenge } = pkce();
  const start = await fetch(`${appBase}/api/auth/google/mobile?code_challenge=${challenge}`, { redirect: 'manual' });
  assert.equal(start.status, 404);
  assert.equal(cookie(start, 'oauth_mobile'), null);
  assert.equal((await exchange({ code: 'a'.repeat(64), codeVerifier: 'b'.repeat(43) })).status, 404);
});

test('a malformed or non-S256 challenge is refused before going to the provider', { skip }, async () => {
  for (const q of ['', '?code_challenge=short', `?code_challenge=${'a'.repeat(43)}&code_challenge_method=plain`]) {
    const res = await fetch(`${appBase}/api/auth/google/mobile${q}`, { redirect: 'manual' });
    assert.equal(res.status, 400, q);
    assert.equal(cookie(res, 'oauth_state'), null);
  }
});

test('mobile login: the browser gets a one-time code on the app scheme, never a session', { skip }, async () => {
  const { verifier, challenge } = pkce();
  const cb = await mobileLogin(challenge);
  assert.equal(cb.status, 302);
  const to = new URL(cb.headers.get('location'));
  assert.equal(`${to.protocol}//${to.host}${to.pathname}`, 'ledens://auth/callback');
  const code = to.searchParams.get('code');
  assert.match(code, /^[a-f0-9]{64}$/);
  assert.equal(cookie(cb, 'ledens_session'), null, 'no cookie session for the browser');
  assert.ok(cleared(cb, 'oauth_mobile'));

  const ok = await exchange({ code, codeVerifier: verifier });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(cookie(ok, 'ledens_session'), null);
  const body = await ok.json();
  assert.equal(body.tokenType, 'Bearer');
  assert.match(body.token, /^[a-f0-9]{64}$/);
  assert.equal(body.user.email, EMAIL);
  assert.equal(body.user.role, 'client');

  const me = await fetch(`${appBase}/api/auth/me`, { headers: { Authorization: `Bearer ${body.token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, EMAIL);

  assert.equal((await exchange({ code, codeVerifier: verifier })).status, 401, 'a code is used once');
});

test('the wrong verifier gets 401 and spends the code', { skip }, async () => {
  const { verifier, challenge } = pkce();
  const code = new URL((await mobileLogin(challenge)).headers.get('location')).searchParams.get('code');
  assert.equal((await exchange({ code, codeVerifier: pkce().verifier })).status, 401);
  assert.equal((await exchange({ code, codeVerifier: verifier })).status, 401);
});

test('an expired code gets 401', { skip }, async () => {
  const { verifier, challenge } = pkce();
  const code = new URL((await mobileLogin(challenge)).headers.get('location')).searchParams.get('code');
  await getPool().query("UPDATE auth_handoffs SET expires_at = now() - interval '1 second' WHERE code_hash = encode(sha256($1::bytea), 'hex')", [code]);
  assert.equal((await exchange({ code, codeVerifier: verifier })).status, 401);
});

test('reclaiming the account (identities and sessions dropped) also ends a login still in flight', { skip }, async () => {
  const { verifier, challenge } = pkce();
  const code = new URL((await mobileLogin(challenge)).headers.get('location')).searchParams.get('code');
  const { rows } = await getPool().query('SELECT id FROM users WHERE lower(email) = lower($1)', [EMAIL]);
  // As an invitation or password link does for an account whose email is not proven yet.
  await getPool().query('UPDATE users SET email_verified = false WHERE id = $1', [rows[0].id]);
  assert.equal(await dropUnproven(getPool(), rows[0].id), true);
  assert.equal((await getPool().query('SELECT count(*)::int AS n FROM auth_handoffs WHERE user_id = $1', [rows[0].id])).rows[0].n, 0);
  assert.equal((await exchange({ code, codeVerifier: verifier })).status, 401);
  await getPool().query('UPDATE users SET email_verified = true WHERE id = $1', [rows[0].id]);
});

test('a handoff whose identity is no longer linked to the account is refused', { skip }, async () => {
  const { verifier, challenge } = pkce();
  const code = new URL((await mobileLogin(challenge)).headers.get('location')).searchParams.get('code');
  await getPool().query("DELETE FROM auth_identities WHERE provider = 'google' AND provider_user_id = $1", ['google-oauth-mobile-1']);
  assert.equal((await exchange({ code, codeVerifier: verifier })).status, 401);
});

test('the exchange is never for a browser: any Origin is 403', { skip }, async () => {
  const { verifier, challenge } = pkce();
  const code = new URL((await mobileLogin(challenge)).headers.get('location')).searchParams.get('code');
  assert.equal((await exchange({ code, codeVerifier: verifier }, { Origin: 'https://ledens.es' })).status, 403);
  assert.equal((await exchange({ code, codeVerifier: verifier })).status, 200, 'the refused request did not spend the code');
});

test('a cancelled or failed provider login goes back to the app with an error, never a code', { skip }, async () => {
  const cancelled = await mobileLogin(pkce().challenge, { error: 'access_denied' });
  assert.equal(cancelled.headers.get('location'), 'ledens://auth/callback?error=google_cancelled');
  nextUserinfo = { sub: 'x', email: EMAIL, email_verified: false };
  const unverified = await mobileLogin(pkce().challenge);
  assert.match(unverified.headers.get('location'), /^ledens:\/\/auth\/callback\?error=google_/);
});

test('web: a start clears a mobile cookie left in the same browser; ?destino=movil comes back to /movil/', { skip }, async () => {
  const web = await fetch(`${appBase}/api/auth/google?destino=movil`, { redirect: 'manual' });
  assert.ok(cleared(web, 'oauth_mobile'), 'an abandoned mobile attempt cannot hijack this web login');
  const dest = cookie(web, 'oauth_destino');
  assert.equal(dest, 'oauth_destino=movil');
  const state = new URL(web.headers.get('location')).searchParams.get('state');
  const cb = await fetch(`${appBase}/api/auth/google/callback?code=c&state=${state}`, {
    redirect: 'manual', headers: { Cookie: [cookie(web, 'oauth_state'), dest].join('; ') },
  });
  assert.equal(cb.headers.get('location'), '/movil/');
  assert.ok(cookie(cb, 'ledens_session'), 'the web version uses the ordinary cookie session');

  const fail = await fetch(`${appBase}/api/auth/google/callback?error=access_denied`, { redirect: 'manual', headers: { Cookie: dest } });
  assert.equal(fail.headers.get('location'), '/movil/acceso?error=google_cancelled');

  const plain = await fetch(`${appBase}/api/auth/google?destino=https://evil.example`, { redirect: 'manual' });
  assert.ok(cleared(plain, 'oauth_destino'), 'only the fixed value is accepted: anything else clears it');
});

test('microsoft: from another host of the site, the mobile start moves to the callback host keeping only the challenge', { skip }, async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    MICROSOFT_CLIENT_ID: 'ms-id', MICROSOFT_CLIENT_SECRET: 'ms-secret',
    MICROSOFT_REDIRECT_URI: 'https://ledens.example/api/auth/microsoft/callback',
  });
  // Own app instance: its own 30/min API limiter (this file makes more requests than that).
  const server = http.createServer(createApp());
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { challenge } = pkce();
    const res = await fetch(`${base}/api/auth/microsoft/mobile?code_challenge=${challenge}&evil=1`, {
      redirect: 'manual', headers: { 'X-Forwarded-Host': 'otro.example' },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `https://ledens.example/api/auth/microsoft/mobile?code_challenge=${challenge}`);
    assert.equal(cookie(res, 'oauth_mobile'), null, 'cookies are set on the callback host, not here');
    const here = await fetch(`${base}/api/auth/microsoft/mobile?code_challenge=${challenge}`, { redirect: 'manual' });
    assert.equal(here.status, 302);
    assert.equal(cookie(here, 'oauth_mobile'), `oauth_mobile=${challenge}`);
  } finally {
    await new Promise((r) => server.close(r));
    for (const k of ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});
