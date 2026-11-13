import rateLimit from 'express-rate-limit';
import { getPool } from '../db/pool.js';
import { verifyPassword } from './passwords.js';

// Email + password checking shared by the web login (routes/auth.js, cookie)
// and the mobile login (routes/mobileAuth.js, Bearer token), so both answer
// exactly the same way and cannot drift apart.

export const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200;

// Slows down password-guessing without affecting normal use — the global
// 30/min limiter in app.js already covers everything else under /api.
// ONE instance mounted on both logins: they share the same per-IP counter,
// so offering a second login endpoint does not double an attacker's budget.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' },
});

// The user (without its password hash) when email and password match, else
// null. Null is the same whether the email doesn't exist or the password is
// wrong — otherwise the answer itself lets someone probe which emails are
// registered. Throws only on a database error.
export async function verifyCredentials(email, password) {
  if (!isEmail(email) || typeof password !== 'string' || !password) return null;
  const { rows } = await getPool().query(
    'SELECT id, email, name, role, password_hash, created_at FROM users WHERE lower(email) = lower($1)',
    [email.trim()],
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at };
}
