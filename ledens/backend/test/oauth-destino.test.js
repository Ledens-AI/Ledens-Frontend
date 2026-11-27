import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
// Where a Google / Microsoft login started outside /auth comes back to
// (routes/oauth.js, `?destino=`): the fixed values only, never a URL from the
// request. No database: only the start and the cancelled callback are run,
// which never reach it (the full callback is in oauth-mobile.test.js).
let server, base;
const saved = { ...process.env };
const cookies = (r) => r.headers.getSetCookie();
const cookie = (r, name) => cookies(r).find((c) => c.startsWith(`${name}=`))?.split(';')[0];
const cleared = (r, name) => cookies(r).some((c) => c.startsWith(`${name}=;`));

before(async () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', // only checked to be set; never connected to here
    GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', GOOGLE_REDIRECT_URI: 'http://127.0.0.1/api/auth/google/callback',
  });
  const { default: oauth } = await import('../src/routes/oauth.js');
  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', oauth);
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(() => { server?.close(); process.env = saved; });

test('?destino=obra: the login comes back to the shared obra page, also when cancelled', async () => {
  const start = await fetch(`${base}/google?destino=obra`, { redirect: 'manual', headers: { Cookie: 'ledens_invitacion=abandoned' } });
  assert.equal(start.status, 302);
  assert.match(start.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
  const dest = cookie(start, 'oauth_destino');
  assert.equal(dest, 'oauth_destino=obra');
  assert.ok(cleared(start, 'ledens_invitacion'), 'an invitation attempt left in the browser cannot take over this login');
  const cancelled = await fetch(`${base}/google/callback?error=access_denied`, { redirect: 'manual', headers: { Cookie: dest } });
  assert.equal(cancelled.headers.get('location'), '/obra-compartida?error=google_cancelled');
  assert.ok(cleared(cancelled, 'oauth_destino'));
  const forged = await fetch(`${base}/google/callback?code=x&state=y`, { redirect: 'manual', headers: { Cookie: dest } });
  assert.equal(forged.headers.get('location'), '/obra-compartida?error=google_failed', 'no state cookie: refused before anything else');
});

test('?destino=movil keeps working; anything else is not a destination', async () => {
  const movil = await fetch(`${base}/google?destino=movil`, { redirect: 'manual' });
  assert.equal(cookie(movil, 'oauth_destino'), 'oauth_destino=movil');
  assert.ok(!cleared(movil, 'ledens_invitacion'));
  const cancelled = await fetch(`${base}/google/callback?error=access_denied`, { redirect: 'manual', headers: { Cookie: 'oauth_destino=movil' } });
  assert.equal(cancelled.headers.get('location'), '/movil/acceso?error=google_cancelled');
  for (const value of ['https://evil.example', '/obra-compartida', 'toString', '__proto__']) {
    const r = await fetch(`${base}/google?destino=${encodeURIComponent(value)}`, { redirect: 'manual' });
    assert.ok(cleared(r, 'oauth_destino'), `«${value}» is not a destination`);
  }
  const cb = await fetch(`${base}/google/callback?error=access_denied`, { redirect: 'manual', headers: { Cookie: 'oauth_destino=toString' } });
  assert.equal(cb.headers.get('location'), '/auth?error=google_cancelled', 'a forged cookie value goes to /auth');
});
