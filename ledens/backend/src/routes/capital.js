import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireMfaSession } from './mfa.js';
import { CapitalService, CapitalError } from '../capital/service.js';

// Ledens Capital (/api/capital). Toda ruta exige una sesión que haya pasado el
// segundo factor (routes/mfa.js); qué ve cada cual lo decide
// CapitalService, fila a fila.
//   Partícipe: /me, /oportunidades, /proyectos/:id (+ /simular, /solicitudes),
//              /solicitudes/:id/retirar, /cartera
//   Equipo:    /admin/… según capital.staff_roles
// Montado antes del limitador compartido de /api (app.js), con el suyo.
// `pool` y `authenticate` sustituyen la base de datos y la sesión en los tests.
export function createCapitalRouter({ pool, authenticate, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  const db = () => pool || getPool();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Ledens Capital no disponible todavía' });
    next();
  });
  router.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en un minuto.' } }));
  // Escrituras solo desde nuestra propia página (mismo criterio que /api/presupuestos).
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (!origin || req.get('origin') !== origin)) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });
  router.use(authenticate || ((req, res, next) => requireMfaSession({ pool: db() })(req, res, next)));

  const svc = (req) => new CapitalService(db(), req.user);
  const handle = (fn, status = 200) => async (req, res, next) => {
    try { res.status(status).json(await fn(req)); } catch (e) {
      if (e instanceof CapitalError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      next(e);
    }
  };

  router.get('/me', handle((req) => svc(req).me()));
  router.get('/oportunidades', handle((req) => svc(req).opportunities()));
  router.get('/proyectos/:id', handle((req) => svc(req).project(req.params.id)));
  router.post('/proyectos/:id/simular', handle((req) => svc(req).simulate(req.params.id, req.body || {})));
  router.post('/proyectos/:id/solicitudes', handle((req) => svc(req).requestCommitment(req.params.id, {
    ...(req.body || {}), ip: req.ip, userAgent: req.get('user-agent'),
  }), 201));
  router.post('/solicitudes/:id/retirar', handle((req) => svc(req).withdraw(req.params.id)));
  router.get('/cartera', handle((req) => svc(req).portfolio()));

  const admin = Router();
  admin.get('/miembros', handle((req) => svc(req).members()));
  admin.post('/miembros', handle((req) => svc(req).createMember(req.body || {}), 201));
  admin.patch('/miembros/:id/estado', handle((req) => svc(req).setMemberStatus(req.params.id, req.body || {})));
  admin.post('/proyectos', handle((req) => svc(req).createProject(req.body || {}), 201));
  admin.patch('/proyectos/:id/estado', handle((req) => svc(req).setProjectStatus(req.params.id, req.body || {})));
  admin.post('/proyectos/:id/planes', handle((req) => svc(req).createPlanVersion(req.params.id, req.body || {}), 201));
  admin.post('/proyectos/:id/planes/:vid/aprobar', handle((req) => svc(req).approvePlanVersion(req.params.id, req.params.vid)));
  admin.post('/proyectos/:id/accesos', handle((req) => svc(req).grantAccess(req.params.id, req.body?.memberId), 201));
  admin.get('/proyectos/:id/solicitudes', handle((req) => svc(req).commitments(req.params.id)));
  admin.post('/solicitudes/:id/asignacion', handle((req) => svc(req).approveAllocation(req.params.id, req.body || {})));
  admin.post('/solicitudes/:id/rechazar', handle((req) => svc(req).rejectCommitment(req.params.id, req.body || {})));
  admin.post('/solicitudes/:id/firma', handle((req) => svc(req).markSigned(req.params.id, req.body || {})));
  admin.post('/solicitudes/:id/aportaciones', handle((req) => svc(req).recordContribution(req.params.id, req.body || {}), 201));
  admin.post('/solicitudes/:id/confirmar', handle((req) => svc(req).confirm(req.params.id)));
  admin.post('/movimientos/:id/conciliar', handle((req) => svc(req).reconcile(req.params.id, req.body || {})));
  admin.get('/auditoria', handle((req) => svc(req).auditLog()));
  router.use('/admin', admin);
  return router;
}
