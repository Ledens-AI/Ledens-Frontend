import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole, getSessionUser, createSession, sessionCookieOptions, SESSION_COOKIE } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { requireSameOrigin } from '../auth/origin.js';
import { PresupuestoError } from '../presupuestos/service.js';
import { isGoogleConfigured } from '../auth/providers/google.js';
import { isMicrosoftConfigured } from '../auth/providers/microsoft.js';
import { InvitacionesService, InvitacionError, describe, acceptWithPassword, acceptWithSession } from '../invitaciones/service.js';
import { AccesoService, describeLink, joinWithLink } from '../invitaciones/acceso.js';

// Invitaciones de cliente (/api/invitaciones):
//  - /obras/:id… — the jefe de obra assigned (or an admin) invites, lists,
//    resends and revokes; checked per obra in InvitacionesService. «Ver como»
//    only reads.
//  - /obras/:id/acceso…, /obras/:id/enlaces… — «Usuarios con acceso» of the
//    obra (jefe de obra, cliente principal, clientes de solo lectura) and the
//    links to share it (invitaciones/acceso.js), same team and checks.
//  - /aceptacion/… — the invited person, with the link's token in the body
//    (never in a URL: it would end up in logs). No session needed, except to
//    accept with the account already logged in.
//  - /enlace/… — whoever opens a link to share an obra (/obra-compartida), with
//    its token in the body: what it is, and joining with the session's account.
// Google / Microsoft with the link: /aceptacion/proveedor keeps the token in
// an httpOnly cookie that only /api/auth sees, and the OAuth callback finishes
// it (routes/oauth.js).
// `authenticate`/`findUser`/`pool`/`currentUser` replace the session lookup and the database in tests.
export const INVITE_COOKIE = 'ledens_invitacion';
const INVITE_COOKIE_MS = 15 * 60 * 1000;

export function createInvitacionesRouter({ authenticate, findUser, pool, currentUser, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  const db = () => pool || getPool();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Invitaciones no disponibles todavía' });
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
  // Public routes that may set a session cookie: always the strict web rule
  // (no requireAuth runs before it, so a Bearer is never exempted here).
  accept.use(requireSameOrigin({ origin }));
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
    return { ...out, session: current ? { email: current.email, matches: current.email.toLowerCase() === out.email.toLowerCase(), verified: !!current.email_verified } : null };
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

  // A link to share an obra: a credential on its own, so the same strict rule
  // and a per-IP limit (the token itself is 256 random bits).
  const shared = Router();
  shared.use(requireSameOrigin({ origin }));
  shared.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' } }));
  const sessionUser = (req) => Promise.resolve().then(() => (currentUser ? currentUser(req) : getSessionUser(req.cookies?.[SESSION_COOKIE]))).catch(() => null);
  shared.post('/consultar', handle(async (req) => describeLink(db(), req.body?.token, await sessionUser(req), { providers: providers() })));
  shared.post('/unirse', authenticate || requireAuth, handle((req) => joinWithLink(db(), req.body?.token, req.user)));
  router.use('/enlace', shared);

  // Mounted before the shared /api limiter (app.js): the team's screen has its
  // own, and sending is limited per person in the service.
  const team = Router();
  team.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en un minuto.' } }));
  team.use(authenticate || requireAuth, viewAs({ findUser }), checkRole('admin', 'jefe'));
  // After requireAuth, so a validated Bearer without Origin may write.
  team.use(requireSameOrigin({ origin }));
  const svc = (req) => new InvitacionesService(db(), req.user);
  team.get('/:id', handle((req) => svc(req).list(req.params.id)));
  team.post('/:id', handle((req) => svc(req).invite(req.params.id, req.body || {}), 201));
  team.post('/:id/:invId/reenviar', handle((req) => svc(req).resend(req.params.id, req.params.invId)));
  team.post('/:id/:invId/revocar', handle((req) => svc(req).revoke(req.params.id, req.params.invId)));
  const acc = (req) => new AccesoService(db(), req.user);
  team.get('/:id/acceso', handle((req) => acc(req).members(req.params.id)));
  team.put('/:id/acceso/:userId', handle((req) => acc(req).setRole(req.params.id, req.params.userId, req.body || {})));
  team.delete('/:id/acceso/:userId', handle((req) => acc(req).removeAccess(req.params.id, req.params.userId)));
  team.post('/:id/enlaces', handle((req) => acc(req).createLink(req.params.id, req.body || {}), 201));
  team.post('/:id/enlaces/:enlaceId/revocar', handle((req) => acc(req).revokeLink(req.params.id, req.params.enlaceId)));
  router.use('/obras', team);
  return router;
}
