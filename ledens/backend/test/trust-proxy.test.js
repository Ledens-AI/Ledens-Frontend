import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp, trustProxyHops } from '../src/app.js';

// req.ip — the key of every rate limiter — must be the client's address as
// Static Web Apps saw it, not the SWA hop shared by all users, and must not be
// something the client can set. Production X-Forwarded-For shape (verified
// with /api/auth/mobile/diagnostico): "<client>, <SWA hop>". No database needed.
const SWA = '198.51.100.200';

async function withServer(fn) {
  const server = http.createServer(createApp());
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const remaining = (res) => Number(res.headers.get('ratelimit-remaining'));
const health = (base, xff) => fetch(`${base}/api/health`, { headers: { 'X-Forwarded-For': xff } });

test('TRUST_PROXY_HOPS: 2 by default, an integer 0–5 overrides it, anything else falls back to 2', () => {
  assert.equal(trustProxyHops(undefined), 2);
  assert.equal(trustProxyHops(''), 2);
  assert.equal(trustProxyHops('1'), 1);
  assert.equal(trustProxyHops('0'), 0);
  for (const bad of ['true', '-1', '6', '1.5', 'x']) assert.equal(trustProxyHops(bad), 2, bad);
});

test('two clients behind the same SWA hop get separate rate-limit counters', async () => {
  await withServer(async (base) => {
    const a = [];
    for (let i = 0; i < 3; i++) a.push(remaining(await health(base, `203.0.113.1, ${SWA}`)));
    assert.deepEqual(a, [29, 28, 27], 'client A spends its own budget');
    assert.equal(remaining(await health(base, `203.0.113.2, ${SWA}`)), 29, 'client B starts fresh: the SWA hop is not the key');
  });
});

test('an entry prepended by the client does not change the key', async () => {
  await withServer(async (base) => {
    assert.equal(remaining(await health(base, `203.0.113.1, ${SWA}`)), 29);
    assert.equal(remaining(await health(base, `192.0.2.10, 203.0.113.1, ${SWA}`)), 28, 'same client, same counter');
    assert.equal(remaining(await health(base, `192.0.2.11, 203.0.113.1, ${SWA}`)), 27, 'a new fake entry still lands on the same counter');
  });
});

test('the 30/min limiter blocks one client without blocking the others', async () => {
  await withServer(async (base) => {
    for (let i = 0; i < 30; i++) assert.equal((await health(base, `203.0.113.5, ${SWA}`)).status, 200);
    assert.equal((await health(base, `203.0.113.5, ${SWA}`)).status, 429);
    assert.equal((await health(base, `203.0.113.6, ${SWA}`)).status, 200, 'another client is unaffected');
  });
});
