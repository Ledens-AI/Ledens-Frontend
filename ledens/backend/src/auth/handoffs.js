import crypto from 'node:crypto';
import { getPool } from '../db/pool.js';
import { hashToken } from './sessions.js';

// One-time codes that hand a Google / Microsoft login over from the phone's
// browser to Ledens Mobile (docs: MOBILE-AUTH.md, «OAuth móvil»). The browser
// only ever sees this code — never a session token — and the code is useless
// without the PKCE verifier that stays inside the app.

export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url(sha256(verifier)), no padding
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/; // RFC 7636 §4.1
const CODE_RE = /^[a-f0-9]{64}$/;
const HANDOFF_TTL_SECONDS = 60;

export const isChallenge = (v) => typeof v === 'string' && CHALLENGE_RE.test(v);

export async function createHandoff(userId, challenge, provider) {
  const code = crypto.randomBytes(32).toString('hex');
  const pool = getPool();
  // Housekeeping: expired codes are worthless; keep a day for diagnostics.
  await pool.query("DELETE FROM auth_handoffs WHERE expires_at < now() - interval '1 day'");
  await pool.query(
    `INSERT INTO auth_handoffs (code_hash, user_id, code_challenge, provider, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [hashToken(code), userId, challenge, provider, HANDOFF_TTL_SECONDS],
  );
  return code;
}

// The user id when `code` is a live, unused handoff and `verifier` matches its
// challenge; null otherwise. The code is spent by the first attempt (atomic
// UPDATE … WHERE used_at IS NULL), right or wrong, so it can't be guessed at.
// Every operation that closes all of a user's sessions (new password, account
// reclaimed by a verified login, invitation link) also deletes their pending
// handoffs; on top of that, the identity that started the login must still be
// linked to the account (an unproven identity dropped meanwhile can't finish).
export async function redeemHandoff(code, verifier) {
  if (typeof code !== 'string' || !CODE_RE.test(code) || typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return null;
  const { rows } = await getPool().query(
    `UPDATE auth_handoffs h SET used_at = now()
      WHERE h.code_hash = $1 AND h.used_at IS NULL AND h.expires_at > now()
        AND EXISTS (SELECT 1 FROM auth_identities i WHERE i.user_id = h.user_id AND i.provider = h.provider)
      RETURNING h.user_id, h.code_challenge`,
    [hashToken(code)],
  );
  const row = rows[0];
  if (!row) return null;
  const expected = Buffer.from(row.code_challenge);
  const actual = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return row.user_id;
}
