import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole, getSessionUser, createSession, sessionCookieOptions, SESSION_COOKIE } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { PresupuestoError } from '../presupuestos/service.js';
import { isGoogleConfigured } from '../auth/providers/google.js';
import { isMicrosoftConfigured } from '../auth/providers/microsoft.js';
import { InvitacionesService, InvitacionError, describe, acceptWithPassword, acceptWithSession } from '../invitaciones/service.js';

// Invitaciones de cliente (/api/invitaciones):
//  - /obras/:id… — the jefe de obra assigned (or an admin) invites, lists,
//    resends and revokes; checked per obra in InvitacionesService. «Ver como»
//    only reads.
//  - /aceptacion/… — the invited person, with the link's token in the body
//    (never in a URL: it would end up in logs). No session needed, except to
//    accept with the account already logged in.
// Google / Microsoft with the link: /aceptacion/proveedor keeps the token in
// an httpOnly cookie that only /api/auth sees, and the OAuth callback finishes
// it (routes/oauth.js).
// `authenticate`/`findUser`/`pool` replace the session lookup and the database in tests.
export const INVITE_COOKIE = 'ledens_invitacion';
const INVITE_COOKIE_MS = 15 * 60 * 1000;

export function createInvitacionesRouter({ authenticate, findUser, pool, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  const db = () => pool || getPool();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Invitaciones no disponibles todavía' });
    next();
  });
  // Same CSRF guard as /api/presupuestos: writes only from our own page.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (!origin || req.get('origin') !== origin)) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });
  const handle = (fn, status = 200) => async (req, res, next) => {
    try { res.status(status).json(await fn(req, res)); } catch (e) {
      if (e instanceof InvitacionError || e instanceof PresupuestoError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      next(e);
    }
  };

  // The link: a few tries per address are plenty (the token itself is 256 random bits).
  const accept = Router();
  accept.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' } }));
  const providers = () => ({ google: isGoogleConfigured(), microsoft: isMicrosoftConfigured() });
  const login = async (req, res, user) => {
    const { token } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
    return { user };
  };
  accept.post('/consultar', handle(async (req) => {
    const out = await describe(db(), req.body?.token, { providers: providers() });
    const current = await getSessionUser(req.cookies?.[SESSION_COOKIE]).catch(() => null);
    return { ...out, session: current ? { email: current.email, matches: current.email.toLowerCase() === out.email.toLowerCase() } : null };
  }));
  accept.post('/contrasena', handle(async (req, res) => login(req, res, await acceptWithPassword(db(), req.body?.token, req.body?.password))));
  accept.post('/sesion', authenticate || requireAuth, handle((req) => acceptWithSession(db(), req.body?.token, req.user).then((user) => ({ user }))));
  accept.post('/proveedor', handle(async (req, res) => {
    const provider = req.body?.provider;
    const ok = { google: isGoogleConfigured, microsoft: isMicrosoftConfigured }[provider];
    if (!ok) throw new InvitacionError(400, 'Proveedor no válido');
    if (!ok()) throw new InvitacionError(503, `Login con ${provider === 'google' ? 'Google' : 'Microsoft'} no disponible todavía`);
    await describe(db(), req.body?.token); // only a usable link gets a cookie
    res.cookie(INVITE_COOKIE, req.body.token, { ...sessionCookieOptions(req), maxAge: INVITE_COOKIE_MS, path: '/api/auth' });
    return { url: `/api/auth/${provider}` };
  }));
  router.use('/aceptacion', accept);

  const team = Router();
  team.use(authenticate || requireAuth, viewAs({ findUser }), checkRole('admin', 'jefe'));
  const svc = (req) => new InvitacionesService(db(), req.user);
  team.get('/:id', handle((req) => svc(req).list(req.params.id)));
  team.post('/:id', handle((req) => svc(req).invite(req.params.id, req.body || {}), 201));
  team.post('/:id/:invId/reenviar', handle((req) => svc(req).resend(req.params.id, req.params.invId)));
  team.post('/:id/:invId/revocar', handle((req) => svc(req).revoke(req.params.id, req.params.invId)));
  router.use('/obras', team);
  return router;
}
