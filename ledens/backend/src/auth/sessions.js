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
  // The first session is what makes an account registered (migration 024): a
  // client the team invited or chose for an obra isn't until they get in.
  await getPool().query('UPDATE users SET registered_at = now() WHERE id = $1 AND registered_at IS NULL', [userId]);
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

// Ledens Mobile sends the same opaque session token as an
// `Authorization: Bearer <token>` header instead of the cookie: same sessions
// table, same expiry, same revocation. Off unless MOBILE_AUTH_ENABLED is
// exactly 'true' — while off, the header is ignored and everything behaves
// as it always did (cookie only). Read per request so tests can flip it.
export const isMobileAuthEnabled = () => process.env.MOBILE_AUTH_ENABLED === 'true';

// A session token is 32 random bytes in hex (createSession above). Anything
// else after "Bearer " is refused outright; it never falls back to the cookie.
const BEARER = /^Bearer ([a-f0-9]{64})$/;

// Which credential a request carries, decided before any database lookup:
//  - flag off, or no Authorization header → the cookie, exactly as before;
//  - flag on, Authorization header and no session cookie → the Bearer token,
//    which must be well formed;
//  - flag on, Authorization header AND a session cookie → refused: two
//    credentials could name two different people, and no client of ours
//    sends both (the browser never sets Authorization, the app never stores
//    cookies). Refusing, rather than picking one, keeps the cookie from ever
//    riding along on a request that later checks treat as Bearer.
// Returns { transport, token } or { error } (a reason for tests, never the
// token itself).
export function readSessionCredential(req) {
  const cookie = req.cookies?.[SESSION_COOKIE];
  const header = req.get?.('authorization');
  if (!isMobileAuthEnabled() || header === undefined) return { transport: 'cookie', token: cookie };
  if (cookie) return { error: 'cookie_and_bearer' };
  const match = BEARER.exec(header);
  if (!match) return { error: 'malformed_bearer' };
  return { transport: 'bearer', token: match[1] };
}

// Reusable guard for any route that should require a logged-in user. Every
// router (presupuestos, obras, invitaciones, finanzas, finance, bridge, admin,
// /api/auth/me) authenticates through it: a Bearer token is only accepted once
// it matches a live session row here, and req.authTransport says which
// credential it was — any later check (e.g. an origin exemption for Bearer)
// must rely on that, never on the raw header.
export async function requireAuth(req, res, next) {
  try {
    const credential = readSessionCredential(req);
    if (credential.error) return res.status(401).json({ error: 'No autenticado' });
    const user = await getSessionUser(credential.token);
    if (!user) return res.status(401).json({ error: 'No autenticado' });
    req.user = user;
    req.authTransport = credential.transport;
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
