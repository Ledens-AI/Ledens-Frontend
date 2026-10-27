import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { hotp, verifyTotp, base32Encode, base32Decode, seal, open, stepAt } from '../src/auth/totp.js';
import { createMfaRouter, requireMfaSession } from '../src/routes/mfa.js';
import { hashToken } from '../src/auth/sessions.js';
import { MAX_FAILURES } from '../src/auth/mfa.js';

// Segundo factor on PGlite (migration 024 over users/sessions/audit_log):
// RFC vectors, enrolment, one use per code, lockout, recovery codes and the
// guard /api/capital relies on.
const ORIGIN = 'https://capital.test';
const env = { MFA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') };
let db, pool, server, base, user;

const login = async () => {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 day')", [user.id, hashToken(token)]);
  return `ledens_session=${token}`;
};
const call = (p, cookie, body) => fetch(`${base}${p}`, {
  method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
  headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
});
const secretOf = async () => open((await db.query('SELECT secret_enc FROM user_mfa_totp WHERE user_id=$1', [user.id])).rows[0].secret_enc, Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64'));
// A code for a step that has not been used yet: the previous or next one is
// also accepted, which keeps the tests independent of the 30 s boundary.
const codeAt = (secret, delta = 0) => hotp(secret, stepAt() + delta);

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text NOT NULL, password_hash text,
      email_verified boolean NOT NULL DEFAULT false, role text NOT NULL DEFAULT 'client', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, user_agent text, ip text);
    CREATE TABLE audit_log(id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  await db.exec(await fs.readFile(new URL('../src/db/migrations/024_mfa_totp.sql', import.meta.url), 'utf8'));
  user = (await db.query("INSERT INTO users (email, name) VALUES ('inversora@capital.test','Inversora') RETURNING id, email")).rows[0];
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/mfa', createMfaRouter({ pool, env, origin: ORIGIN }));
  app.get('/protegida', requireMfaSession({ pool }), (req, res) => res.json({ ok: true, email: req.user.email }));
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await db?.close(); });

test('RFC 4226 / 6238 vectors and base32 round trip', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
  assert.deepEqual([0, 1, 2, 9].map((c) => hotp(secret, c)), ['755224', '287082', '359152', '520489']);
  assert.equal(hotp(secret, Math.floor(59 / 30), 8), '94287082');
  assert.equal(hotp(secret, Math.floor(1111111109 / 30), 8), '07081804');
  assert.equal(verifyTotp(secret, '287082', { now: 59_000 }), 1, 'one step of drift is accepted');
  assert.equal(verifyTotp(secret, '12345'), null);
  const key = crypto.randomBytes(32);
  assert.equal(open(seal('secreto', key), key), 'secreto');
  assert.throws(() => open(seal('secreto', key), crypto.randomBytes(32)));
});

test('enrolment: guarded route says what is missing, then a first code activates it and verifies the session', async () => {
  assert.equal((await call('/protegida')).status, 401);
  const cookie = await login();
  let r = await call('/protegida', cookie);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, 'mfa_alta_requerida');

  r = await call('/mfa/alta', cookie, {});
  const { secret, otpauthUrl } = await r.json();
  assert.match(otpauthUrl, /^otpauth:\/\/totp\/Ledens%3Ainversora%40capital\.test\?secret=[A-Z2-7]+&issuer=Ledens/);
  assert.equal(secret, await secretOf(), 'stored encrypted, opens to the same secret');
  assert.doesNotMatch((await db.query('SELECT secret_enc FROM user_mfa_totp')).rows[0].secret_enc, new RegExp(secret));

  assert.equal((await call('/mfa/alta/confirmar', cookie, { code: '000000' })).status, 401);
  r = await call('/mfa/alta/confirmar', cookie, { code: codeAt(secret) });
  assert.equal(r.status, 200);
  const { recoveryCodes } = await r.json();
  assert.equal(recoveryCodes.length, 10);
  assert.match(recoveryCodes[0], /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  r = await call('/protegida', cookie);
  assert.equal(r.status, 200, 'this session passed the second factor');
  assert.equal((await call('/mfa/alta', cookie, {})).status, 409, 'no silent re-enrolment once active');
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='mfa.enrolled'")).rows[0].n, 1);

  // A new login starts without the second factor.
  const other = await login();
  r = await call('/protegida', other);
  assert.equal((await r.json()).code, 'mfa_requerido');
  assert.equal((await call('/mfa/verificar', other, { code: codeAt(secret) })).status, 401, 'the code used to enrol cannot be replayed');
  r = await call('/mfa/verificar', other, { code: codeAt(secret, 1) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { enrolled: true, verified: true, recoveryCodesLeft: 10 });
  assert.equal((await call('/protegida', other)).status, 200);

  // Recovery codes: each one works once.
  const third = await login();
  assert.equal((await call('/mfa/verificar', third, { recoveryCode: recoveryCodes[0].toLowerCase() })).status, 200);
  const fourth = await login();
  assert.equal((await call('/mfa/verificar', fourth, { recoveryCode: recoveryCodes[0] })).status, 401);
  assert.equal((await (await call('/mfa', third)).json()).recoveryCodesLeft, 9);
});

test('lockout after repeated wrong codes, even for a right one', async () => {
  const secret = await secretOf();
  await db.query('UPDATE user_mfa_totp SET failed_attempts=0'); // the previous test left one wrong recovery code
  const cookie = await login();
  for (let i = 0; i < MAX_FAILURES; i++) assert.equal((await call('/mfa/verificar', cookie, { code: '111111' })).status, 401);
  const r = await call('/mfa/verificar', cookie, { code: hotp(secret, stepAt() - 1) === '111111' ? '222222' : codeAt(secret, -1) });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, 'mfa_bloqueado');
  await db.query('UPDATE user_mfa_totp SET locked_until=NULL');
});

test('writes only from our origin, and nothing without a session', async () => {
  const cookie = await login();
  const r = await fetch(`${base}/mfa/alta`, { method: 'POST', headers: { origin: 'https://evil.test', cookie } });
  assert.equal(r.status, 403);
  assert.equal((await call('/mfa')).status, 401);
});
