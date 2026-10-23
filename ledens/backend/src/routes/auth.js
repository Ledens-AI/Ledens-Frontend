import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  createSession,
  destroySession,
  requireAuth,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '../auth/sessions.js';

const router = Router();

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200;
const isName = (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 120;
const isPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 200;

// These routes need the database; without it (e.g. production before #9's
// Azure server exists) fail clearly instead of crashing.
router.use((_req, res, next) => {
  if (!isDbConfigured()) return res.status(503).json({ error: 'Registro/login no disponible todavía' });
  next();
});

// Slows down password-guessing without affecting normal use — the global
// 30/min limiter in app.js already covers everything else under /api.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' },
});

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!isName(name)) return res.status(400).json({ error: 'Nombre requerido' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Email no válido' });
  if (!isPassword(password)) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const passwordHash = hashPassword(password);
    const { rows } = await getPool().query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email.trim(), name.trim(), passwordHash],
    );
    const user = rows[0];
    const { token } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ese email ya está registrado' });
    console.error('[auth] register failed', err);
    res.status(500).json({ error: 'No se pudo crear la cuenta' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || typeof password !== 'string' || !password) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  try {
    const { rows } = await getPool().query(
      'SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()],
    );
    const user = rows[0];
    // Identical response whether the email doesn't exist or the password is
    // wrong — otherwise the error message itself lets someone probe which
    // emails are registered.
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const { token } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
    res.json({ user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at } });
  } catch (err) {
    console.error('[auth] login failed', err);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

router.post('/logout', async (req, res) => {
  await destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
