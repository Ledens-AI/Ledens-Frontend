import { Router } from 'express';
import { isDbConfigured } from '../db/pool.js';
import { loginLimiter, verifyCredentials } from '../auth/credentials.js';
import {
  createSession, destroySession, getSessionUser, isMobileAuthEnabled, readSessionCredential,
} from '../auth/sessions.js';

// Login and logout for Ledens Mobile (/api/auth/mobile). Same users, same
// `sessions` rows, same 30-day expiry and same brute-force limit as the web
// login (auth/credentials.js) — only the transport differs: the token goes
// back in the JSON body, once, and the app sends it as
// `Authorization: Bearer <token>` (see readSessionCredential in sessions.js).
//
// Rules, all checked before any credential or database work:
//  - MOBILE_AUTH_ENABLED must be exactly 'true', else 404 as if the routes
//    did not exist;
//  - never a browser: any request carrying an `Origin` header is refused.
//    A native app sends none; a page that could read the token from a
//    response would defeat the httpOnly cookie, so no web origin (ours
//    included) gets one. This also closes login CSRF;
//  - HTTPS only in production (req.secure, from X-Forwarded-Proto behind
//    `trust proxy`), so the token never travels in clear;
//  - no Set-Cookie, ever, and `Cache-Control: no-store` on every answer;
//  - no token, password or email in logs; the token never in a URL.
export function createMobileAuthRouter() {
  const router = Router();

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    if (!isMobileAuthEnabled()) return res.status(404).json({ error: 'No encontrado' });
    if (req.get('origin') !== undefined) return res.status(403).json({ error: 'Origen no permitido' });
    if (process.env.NODE_ENV === 'production' && !req.secure) return res.status(403).json({ error: 'Se requiere HTTPS' });
    if (!isDbConfigured()) return res.status(503).json({ error: 'Login no disponible todavía' });
    next();
  });

  // { email, password } → { token, tokenType, expiresAt, user }. Wrong
  // password and unknown email get the same 401; the limiter is the web
  // login's own instance (one shared counter per IP).
  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    try {
      const user = await verifyCredentials(email, password);
      if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
      const { token, expiresAt } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
      console.info('[auth] mobile login', { user: user.id });
      res.json({ token, tokenType: 'Bearer', expiresAt: expiresAt.toISOString(), user });
    } catch (err) {
      console.error('[auth] mobile login failed', err.code || err.name);
      res.status(500).json({ error: 'No se pudo iniciar sesión' });
    }
  });

  // Ends the Bearer session that sends it. Idempotent: an unknown, expired
  // or already-ended token also gets { ok: true }, so the app can always
  // clear its stored token. A missing or malformed header, or a session
  // cookie (with or without a header), is 401 — this route never touches a
  // cookie session; the web keeps POST /api/auth/logout.
  router.post('/logout', async (req, res) => {
    const credential = readSessionCredential(req);
    if (credential.error || credential.transport !== 'bearer') return res.status(401).json({ error: 'No autenticado' });
    try {
      const user = await getSessionUser(credential.token);
      await destroySession(credential.token);
      if (user) console.info('[auth] mobile logout', { user: user.id });
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth] mobile logout failed', err.code || err.name);
      res.status(500).json({ error: 'No se pudo cerrar la sesión' });
    }
  });

  return router;
}
