import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireRole, checkRole } from '../auth/sessions.js';
import {FinanceError} from '../finance/service.js';
import { FinanzasService, FinError, TYPES, isUuid } from '../finanzas/service.js';

// Gestión financiera (/api/finanzas). Internal accounting data: admins and
// jefes de obra only — a client never reaches any of it, whatever the
// frontend shows. The browser only ever sends ids and amounts; every query is
// fixed server-side (no SQL or column names come from the request).
export const FINANZAS_ROLES = ['admin', 'jefe'];

// `authenticate` replaces only the session lookup (tests); the role check is
// always the real one.
export function createFinanzasRouter({ service, authenticate, origin=process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    if (!service && !isDbConfigured()) return res.status(503).json({ error: 'Gestión financiera no disponible todavía' });
    next();
  });
  router.use(authenticate ? [authenticate, checkRole(...FINANZAS_ROLES)] : requireRole(...FINANZAS_ROLES));
  // The shared /api limiter (30/min) is too tight for a person working
  // through an inbox; this module gets its own, per IP, after auth.
  router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));

  router.use((req,res,next)=>{if(req.method!=='GET'&&(!origin||req.get('origin')!==origin))return res.status(403).json({error:'Origen no permitido'});next();});
  const svc = (req) => service || new FinanzasService(getPool(),req.user);
  const handle = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  const actor = (req) => ({ id: req.user.id, name: req.user.name, email: req.user.email });
  const typeParam = (req) => { if (!TYPES[req.params.type]) throw new FinError(400, 'Tipo no válido'); return req.params.type; };
  const reasonOf = (b) => {
    if (b.reason !== undefined && (typeof b.reason !== 'string' || b.reason.length > 500)) throw new FinError(400, 'Motivo no válido (máximo 500 caracteres)');
    return b.reason;
  };
  const projectOf = (v, { nullable }) => {
    if (v === null && nullable) return null;
    if (!isUuid(v)) throw new FinError(400, 'Selecciona un proyecto');
    return v;
  };

  router.get('/proyectos', handle(async (req, res) => {
    res.json({ projects: await svc(req).listProjects({ q: String(req.query.q || '').slice(0, 100), limit: req.query.limit }) });
  }));

  router.get('/resumen', handle(async (req, res) => {
    const s = svc(req);
    const [summary, activity] = await Promise.all([s.pendingSummary(), s.recentActivity(15)]);
    res.json({ ...summary, actividad: activity });
  }));

  router.get('/registros', handle(async (req, res) => {
    const q = req.query;
    res.json(await svc(req).listRecords({
      type: q.tipo || undefined, pending: q.pendientes === '1', estado: q.estado || undefined, project: q.proyecto || undefined,
      q: String(q.q || '').slice(0, 100), from: q.desde || undefined, to: q.hasta || undefined, min: q.min, max: q.max,
      sort: q.orden, dir: q.dir, page: q.pagina, pageSize: q.tam,
    }));
  }));

  router.get('/registros/:type/:id', handle(async (req, res) => {
    res.json({ record: await svc(req).getRecord(typeParam(req), req.params.id) });
  }));

  // { projectId: uuid | null, expectedProjectId?: uuid | null, reason? }
  router.put('/registros/:type/:id/proyecto', handle(async (req, res) => {
    const b = req.body || {};
    const s = svc(req);
    const result = await s.assign({ type: typeParam(req), id: req.params.id, projectId: projectOf(b.projectId, { nullable: true }),
      expectedProjectId: b.expectedProjectId === undefined ? undefined : (b.expectedProjectId || null),
      version:b.version,requestId:b.request_id,reason: reasonOf(b), actor: actor(req) });
    res.json({ ...result, record: await s.getRecord(req.params.type, req.params.id) });
  }));

  // { parts: [{ projectId, amount }], reason? }
  router.put('/registros/:type/:id/distribucion', handle(async (req, res) => {
    const b = req.body || {};
    const s = svc(req);
    const result = await s.distribute({ type: typeParam(req), id: req.params.id, parts: b.parts,version:b.version,requestId:b.request_id, reason: reasonOf(b), actor: actor(req) });
    res.json({ ...result, record: await s.getRecord(req.params.type, req.params.id) });
  }));

  // { needsReview: boolean, note? }
  router.put('/registros/:type/:id/revision', handle(async (req, res) => {
    const b = req.body || {};
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) throw new FinError(400, 'Nota no válida');
    const s = svc(req);
    const result = await s.setReview({ type: typeParam(req), id: req.params.id, needsReview: b.needsReview, note: b.note,version:b.version, actor: actor(req) });
    res.json({ ...result, record: await s.getRecord(req.params.type, req.params.id) });
  }));

  // { action: 'assign' | 'review', items: [{ type, id }], projectId?, reason?, note? }
  router.post('/registros/lote', handle(async (req, res) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.map((i) => ({ type: i?.type, id: i?.id,version:i?.version })) : b.items;
    res.json(await svc(req).bulk({ items,requestId:b.request_id, action: b.action, projectId: b.action === 'assign' ? projectOf(b.projectId, { nullable: false }) : undefined,
      reason: reasonOf(b), note: typeof b.note === 'string' ? b.note.slice(0, 500) : undefined, actor: actor(req) }));
  }));

  router.get('/proyectos/:id/rentabilidad', handle(async (req, res) => {
    res.json(await svc(req).profitability(req.params.id));
  }));

  router.get('/conciliacion', handle(async (req, res) => {
    const view = req.query.vista || 'movimientos';
    res.json(await svc(req).reconciliation({ view, page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100), reason:req.query.motivo, from:req.query.desde, to:req.query.hasta }));
  }));

  // Pago a trabajadores. { movementIds: [uuid] } → movements leave Pendiente de
  // conciliación and are split into lines in Pendiente de trabajador.
  router.post('/conciliacion/pago-trabajadores', handle(async (req, res) => {
    res.json(await svc(req).classifyWorkerPayments({ movementIds: req.body?.movementIds }));
  }));

  router.get('/pendiente-trabajador', handle(async (req, res) => {
    res.json(await svc(req).workerQueue({ page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100) }));
  }));

  router.get('/trabajadores', handle(async (req, res) => {
    res.json({ employees: await svc(req).employees() });
  }));

  // { items: [{ splitId, employeeId, projectId }] } — one result per line.
  router.post('/pendiente-trabajador/guardar', handle(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.map((i) => ({ splitId: i?.splitId, employeeId: i?.employeeId, projectId: i?.projectId })) : req.body?.items;
    res.json(await svc(req).saveWorkerSplits({ items }));
  }));

  router.delete('/pendiente-trabajador/:batchId', handle(async (req, res) => {
    res.json(await svc(req).returnWorkerBatch({ batchId: req.params.batchId }));
  }));

  router.use((err, _req, res, next) => {
    if (err instanceof FinanceError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    next(err);
  });
  return router;
}
