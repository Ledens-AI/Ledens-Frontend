import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { getSession, SESSION_COOKIE } from '../auth/sessions.js';
import { MfaError, status, start, confirm, verify, regenerateRecoveryCodes } from '../auth/mfa.js';

// /api/auth/mfa — segundo factor de la sesión actual (src/auth/mfa.js).
//   GET  /                     ¿activado?, ¿verificado en esta sesión?, códigos que quedan
//   POST /alta                 empieza el alta: secreto + URL otpauth para el QR
//   POST /alta/confirmar       { code } → códigos de recuperación (solo esta vez)
//   POST /verificar            { code } o { recoveryCode } → sesión verificada
//   POST /recuperacion         { code } → códigos de recuperación nuevos
// Montado antes de routes/auth.js (app.js). `pool`/`env` sustituyen la base de
// datos y las variables en los tests.
export function createMfaRouter({ pool, env, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  const db = () => pool || getPool();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Base de datos no configurada' });
    next();
  });
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (!origin || req.get('origin') !== origin)) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });
  router.use(async (req, res, next) => {
    try {
      req.session = await getSession(req.cookies?.[SESSION_COOKIE], db());
      if (!req.session) return res.status(401).json({ error: 'No autenticado' });
      next();
    } catch (e) { next(e); }
  });
  // Además del bloqueo por cuenta (mfa.js), un límite por dirección.
  const tries = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' } });
  const handle = (fn) => async (req, res, next) => {
    try { res.json(await fn(req)); } catch (e) {
      if (e instanceof MfaError) return res.status(e.status).json({ error: e.message, code: e.code });
      next(e);
    }
  };
  router.get('/', handle((req) => status(db(), req.session)));
  router.post('/alta', handle((req) => start(db(), req.session, { env })));
  router.post('/alta/confirmar', tries, handle((req) => confirm(db(), req.session, req.body?.code, { env })));
  router.post('/verificar', tries, handle((req) => verify(db(), req.session, req.body || {}, { env })));
  router.post('/recuperacion', tries, handle((req) => regenerateRecoveryCodes(db(), req.session, req.body?.code, { env })));
  return router;
}

/**
 * Guard for routes that need a logged-in session that has passed the second
 * factor (all of /api/capital). 401 with a `code` the frontend uses to send
 * the person to the right step: login, MFA enrolment or MFA verification.
 */
export function requireMfaSession({ pool } = {}) {
  return async (req, res, next) => {
    try {
      const db = pool || getPool();
      const s = await getSession(req.cookies?.[SESSION_COOKIE], db);
      if (!s) return res.status(401).json({ error: 'No autenticado', code: 'login_requerido' });
      if (!s.mfaVerifiedAt) {
        const enrolled = (await db.query('SELECT 1 FROM user_mfa_totp WHERE user_id=$1 AND confirmed_at IS NOT NULL', [s.user.id])).rows.length > 0;
        return res.status(401).json(enrolled
          ? { error: 'Introduce el código de tu app de autenticación', code: 'mfa_requerido' }
          : { error: 'Activa el segundo factor para continuar', code: 'mfa_alta_requerida' });
      }
      req.session = s;
      req.user = s.user;
      next();
    } catch (e) { next(e); }
  };
}
