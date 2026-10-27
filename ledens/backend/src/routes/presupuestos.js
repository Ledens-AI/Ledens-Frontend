import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { PresupuestosService, PresupuestoError } from '../presupuestos/service.js';
import { pdfDraft, LayoutOcr } from '../presupuestos/pdf.js';
import { translatorFromEnv } from '../presupuestos/translate.js';
import { PropuestasService } from '../presupuestos/propuestas.js';

// Presupuestos para clientes y obras en curso (/api/presupuestos). Every role
// reaches it; what each one sees and may do is decided per row in
// PresupuestosService. «Ver como» answers as the viewed user, read-only.
// `authenticate`/`pool` replace the session lookup and the database in tests.
// `ocr` replaces Azure Document Intelligence (DI_ENDPOINT/DI_KEY) and `translator`
// Azure Translator (AZURE_TRANSLATOR_*) in tests; null turns them off.
export function createPresupuestosRouter({ authenticate, findUser, pool, ocr, translator, origin = process.env.CORS_ORIGIN } = {}) {
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
  // A budget PDF read into chapters and lines (text layer, else OCR). Saves nothing.
  const translate = translator !== undefined ? translator : translatorFromEnv();
  const layout = ocr !== undefined ? ocr : process.env.DI_ENDPOINT && process.env.DI_KEY ? new LayoutOcr(process.env.DI_ENDPOINT, process.env.DI_KEY) : null;
  router.post('/pdf', rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }),
    express.raw({ type: () => true, limit: 20 * 1024 * 1024 }), handle((req) => pdfDraft(req.user, req.body, { ocr: layout, db: pool || getPool(), translator: translate })));
  router.get('/opciones', handle((req) => svc(req).options()));
  // Proposed new partidas for the base (admins decide).
  const propuestas = (req) => new PropuestasService(pool || getPool(), req.user);
  router.get('/propuestas', handle((req) => propuestas(req).list({ status: req.query.estado || 'pending' })));
  router.post('/propuestas/:pid/aprobar', handle((req) => propuestas(req).approve(req.params.pid, req.body || {})));
  router.post('/propuestas/:pid/rechazar', handle((req) => propuestas(req).reject(req.params.pid, req.body || {})));
  router.get('/:id', handle((req) => svc(req).get(req.params.id, { versionId: req.query.version || undefined })));
  router.post('/', handle((req) => svc(req).create(req.body || {})));
  router.put('/:id', handle((req) => svc(req).saveDraft(req.params.id, req.body || {})));
  router.post('/:id/enviar', handle((req) => svc(req).send(req.params.id)));
  router.post('/:id/aprobar', handle((req) => svc(req).approve(req.params.id, req.body || {})));
  router.post('/:id/cambios', handle((req) => svc(req).requestChanges(req.params.id, req.body || {})));
  router.post('/:id/rechazar', handle((req) => svc(req).reject(req.params.id, req.body || {})));
  router.post('/:id/comentarios', handle((req) => svc(req).comment(req.params.id, req.body || {})));
  router.put('/:id/jefe', handle((req) => svc(req).assignJefe(req.params.id, req.body || {})));
  router.put('/:id/fechas', handle((req) => svc(req).schedule(req.params.id, req.body || {})));
  router.put('/:id/produccion', handle((req) => svc(req).declare(req.params.id, req.body || {})));
  router.use((err, _req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El PDF supera el tamaño máximo (20 MB)' });
    next(err);
  });
  return router;
}
