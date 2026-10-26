import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { PresupuestosService, PresupuestoError } from '../presupuestos/service.js';

// Presupuestos para clientes y obras en curso (/api/presupuestos). Every role
// reaches it; what each one sees and may do is decided per row in
// PresupuestosService. «Ver como» answers as the viewed user, read-only.
// `authenticate`/`pool` replace the session lookup and the database in tests.
export function createPresupuestosRouter({ authenticate, findUser, pool, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Presupuestos no disponibles todavía' });
    next();
  });
  router.use(authenticate || requireAuth, viewAs({ findUser }), checkRole('admin', 'jefe', 'client'));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (!origin || req.get('origin') !== origin)) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });

  const svc = (req) => new PresupuestosService(pool || getPool(), req.user);
  const handle = (fn) => async (req, res, next) => {
    try { res.json(await fn(req)); } catch (e) {
      if (e instanceof PresupuestoError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };

  router.get('/', handle(async (req) => ({ presupuestos: await svc(req).list() })));
  router.get('/opciones', handle((req) => svc(req).options()));
  router.get('/:id', handle((req) => svc(req).get(req.params.id, { versionId: req.query.version || undefined })));
  router.post('/', handle((req) => svc(req).create(req.body || {})));
  router.put('/:id', handle((req) => svc(req).saveDraft(req.params.id, req.body || {})));
  router.post('/:id/enviar', handle((req) => svc(req).send(req.params.id)));
  router.post('/:id/aprobar', handle((req) => svc(req).approve(req.params.id, req.body || {})));
  router.post('/:id/cambios', handle((req) => svc(req).requestChanges(req.params.id, req.body || {})));
  router.post('/:id/rechazar', handle((req) => svc(req).reject(req.params.id, req.body || {})));
  router.post('/:id/comentarios', handle((req) => svc(req).comment(req.params.id, req.body || {})));
  router.put('/:id/fechas', handle((req) => svc(req).schedule(req.params.id, req.body || {})));
  router.put('/:id/produccion', handle((req) => svc(req).declare(req.params.id, req.body || {})));
  return router;
}
