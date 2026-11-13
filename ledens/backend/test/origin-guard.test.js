import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireSameOrigin } from '../src/auth/origin.js';

// The shared origin (CSRF) guard on its own. Integration through the real
// routers: auth-bearer.test.js and auth-mobile.test.js.
const OURS = 'https://ledens.test';

function run(guard, { method = 'POST', origin, authTransport, authorization } = {}) {
  const headers = { ...(origin !== undefined ? { origin } : {}), ...(authorization ? { authorization } : {}) };
  const req = { method, authTransport, get: (n) => headers[n.toLowerCase()] };
  let status = null, body = null, passed = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  guard(req, res, () => { passed = true; });
  return { passed, status, body };
}
const guard = requireSameOrigin({ origin: OURS });

test('reads always pass, whatever the origin', () => {
  for (const method of ['GET', 'HEAD']) {
    for (const origin of [undefined, 'https://evil.example', OURS]) assert.equal(run(guard, { method, origin }).passed, true);
  }
});

test('cookie writes: only our exact Origin passes (the web rule, unchanged)', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(run(guard, { method, origin: OURS, authTransport: 'cookie' }).passed, true, method);
    for (const origin of [undefined, '', 'null', 'https://evil.example', `${OURS}.evil.example`, `${OURS}/`, OURS.toUpperCase(), 'http://ledens.test']) {
      const r = run(guard, { method, origin, authTransport: 'cookie' });
      assert.equal(r.passed, false, `${method} origin=${JSON.stringify(origin)}`);
      assert.equal(r.status, 403);
      assert.deepEqual(r.body, { error: 'Origen no permitido' });
    }
  }
});

test('a validated Bearer may omit Origin, but a foreign Origin is still refused', () => {
  assert.equal(run(guard, { authTransport: 'bearer' }).passed, true);
  assert.equal(run(guard, { authTransport: 'bearer', origin: OURS }).passed, true);
  for (const origin of ['', 'null', 'https://evil.example', `${OURS}.evil.example`]) {
    assert.equal(run(guard, { authTransport: 'bearer', origin }).status, 403, JSON.stringify(origin));
  }
});

test('fails closed before authentication: a raw Authorization header exempts nothing', () => {
  // Mounted before requireAuth, req.authTransport is not set yet.
  const r = run(guard, { authorization: `Bearer ${'a'.repeat(64)}` });
  assert.equal(r.passed, false);
  assert.equal(r.status, 403);
  // Any other value than the one requireAuth sets exempts nothing either.
  for (const authTransport of ['Bearer', 'BEARER', 'token', true, 1]) assert.equal(run(guard, { authTransport }).passed, false, String(authTransport));
});

test('without a configured origin, cookie writes are refused (fails closed)', () => {
  const unset = requireSameOrigin({ origin: undefined });
  assert.equal(run(unset, { authTransport: 'cookie' }).passed, false, 'no Origin and no CORS_ORIGIN is not a match');
  assert.equal(run(unset, { origin: OURS, authTransport: 'cookie' }).passed, false);
  const fromEnv = requireSameOrigin({ origin: () => undefined, message: 'invalid_origin' });
  assert.deepEqual(run(fromEnv, { authTransport: 'cookie' }).body, { error: 'invalid_origin' });
});

test('the origin can be read per request and the message kept per router', () => {
  let current = OURS;
  const g = requireSameOrigin({ origin: () => current, message: 'invalid_origin' });
  assert.equal(run(g, { origin: OURS, authTransport: 'cookie' }).passed, true);
  current = 'https://other.test';
  const r = run(g, { origin: OURS, authTransport: 'cookie' });
  assert.equal(r.passed, false);
  assert.deepEqual(r.body, { error: 'invalid_origin' });
});
