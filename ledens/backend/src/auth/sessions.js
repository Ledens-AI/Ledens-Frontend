import crypto from 'node:crypto';
import { getPool } from '../db/pool.js';

export const SESSION_COOKIE = 'ledens_session';
const SESSION_DAYS = 30;

// Only a hash of the session token is stored in the database — same reasoning
// as password hashing: a leak of the `sessions` table alone should not let
// anyone log in as someone else. Invitation links (invitaciones/service.js)
// store their tokens the same way.
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(userId, { userAgent, ip } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await getPool().query(
    'INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)',
    [userId, hashToken(token), expiresAt, userAgent || null, ip || null],
  );
  return { token, expiresAt };
}

export async function getSessionUser(token) {
  if (!token) return null;
  const { rows } = await getPool().query(
    `SELECT u.id, u.email, u.name, u.role, u.email_verified, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

// The session itself, not only its user: whether it has passed the second
// factor (src/auth/mfa.js) belongs to this login, not to the account.
// `db` lets tests pass their own database.
export async function getSession(token, db = getPool()) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.mfa_verified_at,
            u.id, u.email, u.name, u.role, u.email_verified, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!rows[0]) return null;
  const { session_id: sessionId, mfa_verified_at: mfaVerifiedAt, ...user } = rows[0];
  return { sessionId, mfaVerifiedAt, user };
}

export async function destroySession(token) {
  if (!token) return;
  await getPool().query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

// `req` decides `secure`: `trust proxy` (set in app.js) makes Express read the
// X-Forwarded-Proto header from Azure's proxy, so this is correct in
// production (HTTPS) and in local http:// dev without an env var to remember.
export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

// Reusable guard for any route that should require a logged-in user —
// the budget agent's CEO screen (#8) will also use this.
export async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
    if (!user) return res.status(401).json({ error: 'No autenticado' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const ROLES = ['admin', 'jefe', 'client'];
export const ROLE_LABEL = { admin: 'Administrador', jefe: 'Jefe de obra', client: 'Cliente' };

// requireAuth plus a role check: `app.use('/api/admin', requireRole('admin'))`.
// Logged-out → 401, logged-in with the wrong role → 403.
export function requireRole(...roles) {
  return [requireAuth, checkRole(...roles)];
}

// The role half of requireRole, for routers whose tests supply req.user
// without a database session.
export function checkRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esto' });
    next();
  };
}
