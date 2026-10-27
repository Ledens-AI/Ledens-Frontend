import crypto from 'node:crypto';
import { audit } from '../db/audit.js';
import { newSecret, verifyTotp, otpauthUrl, seal, open, encryptionKey, base32Encode } from './totp.js';

// Segundo factor (migración 024). El alta es en dos pasos: `start` genera un
// secreto sin confirmar (se puede repetir mientras no se confirme) y `confirm`
// lo da por bueno con un primer código, entrega los códigos de recuperación
// —una única vez— y marca la sesión. Después, cada sesión nueva pasa por
// `verify`. Tras MAX_FAILURES fallos seguidos la cuenta queda bloqueada
// LOCK_MINUTES para el segundo factor (el código tiene un millón de valores).
export const ISSUER = 'Ledens';
export const RECOVERY_CODES = 10;
export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

export class MfaError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new MfaError(status, message, code); };

const hashCode = (c) => crypto.createHash('sha256').update(normalizeRecovery(c)).digest('hex');
const normalizeRecovery = (c) => String(c).toUpperCase().replace(/[^A-Z2-7]/g, '');
// 10 caracteres base32 (50 bits) en dos grupos: «K7P2Q-M4XWZ».
const newRecoveryCode = () => base32Encode(crypto.randomBytes(7)).slice(0, 10).replace(/^(.{5})/, '$1-');

function key(env) {
  const k = encryptionKey(env);
  if (!k) fail(503, 'Segundo factor no disponible todavía', 'mfa_no_configurado');
  return k;
}

async function row(db, userId) {
  return (await db.query('SELECT * FROM user_mfa_totp WHERE user_id=$1', [userId])).rows[0] || null;
}

async function markSession(db, sessionId) {
  await db.query('UPDATE sessions SET mfa_verified_at=now() WHERE id=$1', [sessionId]);
}

async function issueRecoveryCodes(db, userId) {
  await db.query('DELETE FROM user_mfa_recovery_codes WHERE user_id=$1', [userId]);
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  for (const c of codes) await db.query('INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)', [userId, hashCode(c)]);
  return codes;
}

export async function status(db, session) {
  const r = await row(db, session.user.id);
  const left = r?.confirmed_at
    ? Number((await db.query('SELECT count(*)::int AS n FROM user_mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL', [session.user.id])).rows[0].n)
    : 0;
  return { enrolled: Boolean(r?.confirmed_at), verified: Boolean(session.mfaVerifiedAt), recoveryCodesLeft: left };
}

export async function start(db, session, { env } = {}) {
  const k = key(env);
  const r = await row(db, session.user.id);
  if (r?.confirmed_at) fail(409, 'El segundo factor ya está activado', 'mfa_activo');
  const secret = newSecret();
  await db.query(
    `INSERT INTO user_mfa_totp (user_id, secret_enc) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc=EXCLUDED.secret_enc, failed_attempts=0, locked_until=NULL, last_step=NULL, updated_at=now()`,
    [session.user.id, seal(secret, k)],
  );
  return { secret, otpauthUrl: otpauthUrl({ secret, account: session.user.email, issuer: ISSUER }) };
}

// Fallo o acierto de un código: lleva la cuenta y el bloqueo.
async function checkCode(db, r, code, k, now) {
  if (r.locked_until && new Date(r.locked_until) > new Date(now)) fail(429, 'Demasiados intentos. Inténtalo de nuevo más tarde.', 'mfa_bloqueado');
  const step = verifyTotp(open(r.secret_enc, k), code, { now });
  if (step == null || (r.last_step != null && step <= Number(r.last_step))) {
    const failures = r.failed_attempts + 1;
    const lock = failures >= MAX_FAILURES;
    await db.query(
      `UPDATE user_mfa_totp SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
      [r.user_id, lock ? 0 : failures, lock ? new Date(now + LOCK_MINUTES * 60_000) : null],
    );
    fail(401, 'Código incorrecto', 'mfa_codigo_incorrecto');
  }
  await db.query('UPDATE user_mfa_totp SET last_step=$2, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1', [r.user_id, step]);
}

export async function confirm(db, session, code, { env, now = Date.now() } = {}) {
  const k = key(env);
  const r = await row(db, session.user.id);
  if (!r) fail(409, 'Empieza el alta del segundo factor', 'mfa_sin_alta');
  if (r.confirmed_at) fail(409, 'El segundo factor ya está activado', 'mfa_activo');
  await checkCode(db, r, code, k, now);
  await db.query('UPDATE user_mfa_totp SET confirmed_at=now() WHERE user_id=$1', [r.user_id]);
  const recoveryCodes = await issueRecoveryCodes(db, r.user_id);
  await markSession(db, session.sessionId);
  await audit({ actor: session.user, action: 'mfa.enrolled', target: session.user, detail: 'TOTP activado' }, db);
  return { recoveryCodes };
}

export async function verify(db, session, { code, recoveryCode } = {}, { env, now = Date.now() } = {}) {
  const k = key(env);
  const r = await row(db, session.user.id);
  if (!r?.confirmed_at) fail(409, 'Activa primero el segundo factor', 'mfa_sin_alta');
  if (recoveryCode) {
    if (r.locked_until && new Date(r.locked_until) > new Date(now)) fail(429, 'Demasiados intentos. Inténtalo de nuevo más tarde.', 'mfa_bloqueado');
    const used = await db.query(
      'UPDATE user_mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id',
      [r.user_id, hashCode(recoveryCode)],
    );
    if (!used.rows.length) {
      const failures = r.failed_attempts + 1;
      const lock = failures >= MAX_FAILURES;
      await db.query('UPDATE user_mfa_totp SET failed_attempts=$2, locked_until=$3 WHERE user_id=$1',
        [r.user_id, lock ? 0 : failures, lock ? new Date(now + LOCK_MINUTES * 60_000) : null]);
      fail(401, 'Código de recuperación no válido', 'mfa_codigo_incorrecto');
    }
    await db.query('UPDATE user_mfa_totp SET failed_attempts=0, locked_until=NULL WHERE user_id=$1', [r.user_id]);
    await audit({ actor: session.user, action: 'mfa.recovery_code_used', target: session.user }, db);
  } else {
    await checkCode(db, r, code, k, now);
  }
  await markSession(db, session.sessionId);
  return status(db, { ...session, mfaVerifiedAt: new Date() });
}

export async function regenerateRecoveryCodes(db, session, code, opts = {}) {
  if (!session.mfaVerifiedAt) fail(401, 'Verifica primero el segundo factor', 'mfa_requerido');
  const k = key(opts.env);
  const r = await row(db, session.user.id);
  if (!r?.confirmed_at) fail(409, 'Activa primero el segundo factor', 'mfa_sin_alta');
  await checkCode(db, r, code, k, opts.now ?? Date.now());
  const recoveryCodes = await issueRecoveryCodes(db, r.user_id);
  await audit({ actor: session.user, action: 'mfa.recovery_codes_regenerated', target: session.user }, db);
  return { recoveryCodes };
}
