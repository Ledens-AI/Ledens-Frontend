import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import {FinanceError} from '../finance/service.js';
import { FinanzasService, FinError, TYPES, isUuid } from '../finanzas/service.js';
import { ProjectsService } from '../finanzas/projects.js';
import { WorkersService } from '../finanzas/workers.js';
import { traced, RunLogService } from '../logs/runs.js';

// Gestión financiera (/api/finanzas). Internal accounting data: admins and
// jefes de obra only — a client never reaches any of it, whatever the
// frontend shows. The browser only ever sends ids and amounts; every query is
// fixed server-side (no SQL or column names come from the request).
export const FINANZAS_ROLES = ['admin', 'jefe'];

// `authenticate` replaces only the session lookup (tests); the role check is
// always the real one.
export function createFinanzasRouter({ service, projects, workers, runLogs, authenticate, findUser, origin=process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    if (!service && !isDbConfigured()) return res.status(503).json({ error: 'Gestión financiera no disponible todavía' });
    next();
  });
  // An admin «viewing as» someone (read-only) is checked as that user from here on.
  router.use(authenticate ? authenticate : requireAuth, viewAs({ findUser }), checkRole(...FINANZAS_ROLES));
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
  router.put('/registros/:type/:id/proyecto', traced('imputacion', 'Asignación de proyecto', { entity: (req) => ({ type: req.params.type, id: req.params.id }), summary: (b) => ({ message: b.record?.project_label ? 'Asignado a ' + b.record.project_label : 'Proyecto quitado' }) })(async (req, res) => {
    const b = req.body || {};
    const s = svc(req);
    const result = await s.assign({ type: typeParam(req), id: req.params.id, projectId: projectOf(b.projectId, { nullable: true }),
      expectedProjectId: b.expectedProjectId === undefined ? undefined : (b.expectedProjectId || null),
      version:b.version,requestId:b.request_id,reason: reasonOf(b), actor: actor(req) });
    res.json({ ...result, record: await s.getRecord(req.params.type, req.params.id) });
  }));

  // { parts: [{ projectId, amount }], reason? }
  router.put('/registros/:type/:id/distribucion', traced('imputacion', 'Distribución entre proyectos', { entity: (req) => ({ type: req.params.type, id: req.params.id }), summary: (b) => ({ message: b.exact === false ? 'Distribución parcial guardada' : 'Distribución guardada' }) })(async (req, res) => {
    const b = req.body || {};
    const s = svc(req);
    const result = await s.distribute({ type: typeParam(req), id: req.params.id, parts: b.parts,version:b.version,requestId:b.request_id, reason: reasonOf(b), actor: actor(req) });
    res.json({ ...result, record: await s.getRecord(req.params.type, req.params.id) });
  }));

  // { needsReview: boolean, note? }
  router.put('/registros/:type/:id/revision', traced('imputacion', 'Marca de revisión', { entity: (req) => ({ type: req.params.type, id: req.params.id }), summary: (b, req) => ({ message: req.body?.needsReview ? 'Marcado para revisión' : 'Revisión cerrada' }) })(async (req, res) => {
    const b = req.body || {};
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) throw new FinError(400, 'Nota no válida');
    const s = svc(req);
    const result = await s.setReview({ type: typeParam(req), id: req.params.id, needsReview: b.needsReview, note: b.note,version:b.version, actor: actor(req) });
    res.json({ ...result, record: await s.getRecord(req.params.type, req.params.id) });
  }));

  // { action: 'assign' | 'review', items: [{ type, id }], projectId?, reason?, note? }
  router.post('/registros/lote', traced('imputacion', 'Operación masiva', { summary: b=>({status:b.ok===0&&b.failed?'rechazado':'ok',message:`${b.ok} correctos · ${b.failed} con error`,detail:{correctos:b.ok,errores:b.failed}}) })(async (req, res) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.map((i) => ({ type: i?.type, id: i?.id,version:i?.version })) : b.items;
    res.json(await svc(req).bulk({ items,requestId:b.request_id, action: b.action, projectId: b.action === 'assign' ? projectOf(b.projectId, { nullable: false }) : undefined,
      reason: reasonOf(b), note: typeof b.note === 'string' ? b.note.slice(0, 500) : undefined, actor: actor(req) }));
  }));

  router.get('/proyectos/:id/rentabilidad', handle(async (req, res) => {
    res.json(await svc(req).profitability(req.params.id));
  }));

  // Movimientos conciliados: how each reconciled record is classified, and the
  // change of class (category only; audited with its reason).
  router.get('/conciliados', handle(async (req, res) => {
    res.json(await svc(req).reconciled({ page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100), clase: req.query.clase || '', from: req.query.desde, to: req.query.hasta }));
  }));
  router.put('/conciliados/:recordId/clasificacion', traced('imputacion', 'Cambio de clasificación', { entity: (req) => ({ type: 'registro', id: req.params.recordId }), summary: (b) => ({ message: 'Clasificado como ' + b.clase, detail: { clase: b.clase, categoria: b.category } }) })(async (req, res) => {
    const b = req.body || {};
    res.json(await svc(req).reclassify({ recordId: req.params.recordId, clase: b.clase, version: b.version, reason: b.reason }));
  }));

  router.get('/conciliacion', handle(async (req, res) => {
    const view = req.query.vista || 'movimientos';
    res.json(await svc(req).reconciliation({ view, page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100), reason:req.query.motivo, from:req.query.desde, to:req.query.hasta }));
  }));

  // Pago a trabajadores. { movementIds: [uuid] } → movements leave Pendiente de
  // conciliación and are split into lines in Pendiente de trabajador.
  router.post('/conciliacion/pago-trabajadores', traced('pago_trabajadores', 'Envío desde conciliación', { summary: b=>({status:b.ok===0&&b.failed?'rechazado':'ok',message:`${b.ok} correctos · ${b.failed} con error`,detail:{correctos:b.ok,errores:b.failed}}) })(async (req, res) => {
    res.json(await svc(req).classifyWorkerPayments({ movementIds: req.body?.movementIds }));
  }));

  // Pagos y cobros en efectivo (admins). They wait in Pendiente de conciliación;
  // a pago goes to trabajadores through /conciliacion/pago-trabajadores above.
  router.post('/conciliacion/efectivo', traced('efectivo', 'Alta de efectivo', { summary: b=>({ message: `${b.kind==='pago'?'Pago':'Cobro'} de ${b.amount} €`, detail: { tipo: b.kind, importe: b.amount, fecha: b.fecha } }) })(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await svc(req).createCash({ kind: b.kind, amount: b.amount, date: b.date, concept: b.concept, counterparty: b.counterparty }));
  }));
  router.post('/conciliacion/efectivo/:id/asignar', traced('efectivo', 'Asignación de efectivo', { entity: (req) => ({ type: 'efectivo', id: req.params.id }), summary: b=>({ message: b.assigned==='materiales'?'Asignado a Pagos de materiales':'Asignado a Pagos de clientes', detail: { destino: b.assigned } }) })(async (req, res) => {
    const b = req.body || {};
    res.json(await svc(req).assignCash({ id: req.params.id, target: b.target, projectId: b.projectId || null, description: b.description }));
  }));
  router.delete('/conciliacion/efectivo/:id', traced('efectivo', 'Eliminación de efectivo', { entity: (req) => ({ type: 'efectivo', id: req.params.id }), summary: () => ({ message: 'Efectivo eliminado' }) })(async (req, res) => {
    res.json(await svc(req).deleteCash(req.params.id));
  }));

  router.get('/pendiente-trabajador', handle(async (req, res) => {
    res.json(await svc(req).workerQueue({ page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100) }));
  }));

  router.get('/trabajadores', handle(async (req, res) => {
    res.json({ employees: await svc(req).employees() });
  }));

  // { items: [{ splitId, employeeId, projectId }] } — one result per line.
  router.post('/pendiente-trabajador/guardar', traced('pago_trabajadores', 'Guardar pagos', { summary: b=>({status:b.ok===0&&b.failed?'rechazado':'ok',message:`${b.ok} correctos · ${b.failed} con error`,detail:{correctos:b.ok,errores:b.failed}}) })(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.map((i) => ({ splitId: i?.splitId, employeeId: i?.employeeId, projectId: i?.projectId })) : req.body?.items;
    res.json(await svc(req).saveWorkerSplits({ items }));
  }));

  router.delete('/pendiente-trabajador/:batchId', traced('pago_trabajadores', 'Devolver a conciliación', { entity: (req) => ({ type: 'lote', id: req.params.batchId }), summary: () => ({ message: 'Movimiento devuelto a conciliación' }) })(async (req, res) => {
    res.json(await svc(req).returnWorkerBatch({ batchId: req.params.batchId }));
  }));

  // Proyectos: list for everyone with finance access, create/edit for admins.
  const projectsSvc = (req) => projects || new ProjectsService(getPool(), req.user);
  router.get('/gestion-proyectos', handle(async (req, res) => {
    res.json(await projectsSvc(req).list({ q: req.query.q || '', estado: req.query.estado || '', page: req.query.pagina, pageSize: req.query.tam }));
  }));
  router.get('/gestion-proyectos/opciones', handle(async (req, res) => {
    res.json(await projectsSvc(req).options());
  }));
  router.get('/gestion-proyectos/:id', handle(async (req, res) => {
    res.json({ project: await projectsSvc(req).one(req.params.id) });
  }));
  router.post('/gestion-proyectos', traced('proyectos', 'Alta de proyecto', { summary: (b) => ({ message: 'Creado: ' + (b.project?.name || ''), detail: { proyecto_id: b.project?.id } }) })(async (req, res) => {
    res.status(201).json({ project: await projectsSvc(req).create(req.body || {}) });
  }));
  router.put('/gestion-proyectos/:id', traced('proyectos', 'Edición de proyecto', { entity: (req) => ({ type: 'proyecto', id: req.params.id }), summary: (b) => ({ message: b.project?.changed ? 'Cambios guardados' : 'Sin cambios' }) })(async (req, res) => {
    res.json({ project: await projectsSvc(req).update(req.params.id, req.body || {}) });
  }));

  // Trabajadores: list for everyone with finance access (pay only for admins);
  // alta, edición, baja and reactivación for admins.
  const workersSvc = (req) => workers || new WorkersService(getPool(), req.user);
  router.get('/gestion-trabajadores', handle(async (req, res) => {
    res.json(await workersSvc(req).list({ q: req.query.q || '', estado: req.query.estado || 'activos', puesto: req.query.puesto || '', page: req.query.pagina, pageSize: req.query.tam }));
  }));
  router.get('/gestion-trabajadores/opciones', handle(async (req, res) => {
    res.json(await workersSvc(req).options());
  }));
  router.get('/gestion-trabajadores/:id', handle(async (req, res) => {
    res.json({ worker: await workersSvc(req).one(req.params.id) });
  }));
  router.post('/gestion-trabajadores', traced('trabajadores', 'Alta de trabajador', { summary: (b) => ({ message: 'Alta: ' + (b.worker?.name || ''), detail: { trabajador_id: b.worker?.id } }) })(async (req, res) => {
    res.status(201).json({ worker: await workersSvc(req).create(req.body || {}) });
  }));
  router.put('/gestion-trabajadores/:id', traced('trabajadores', 'Edición de trabajador', { entity: (req) => ({ type: 'trabajador', id: req.params.id }), summary: (b) => ({ message: b.worker?.changed ? 'Cambios guardados' : 'Sin cambios' }) })(async (req, res) => {
    res.json({ worker: await workersSvc(req).update(req.params.id, req.body || {}) });
  }));
  // { activo: boolean, version, reason? }
  router.put('/gestion-trabajadores/:id/estado', traced('trabajadores', 'Baja o reactivación', { entity: (req) => ({ type: 'trabajador', id: req.params.id }), summary: (b) => ({ message: b.worker?.activo ? 'Reactivado' : 'Dado de baja' }) })(async (req, res) => {
    const b = req.body || {};
    res.json({ worker: await workersSvc(req).setActive(req.params.id, { activo: b.activo, version: b.version, reason: b.reason }) });
  }));

  // Logs de transacciones (admins). RunLogService errors carry an HTTP status.
  const logsSvc = (req) => runLogs || new RunLogService(getPool(), req.user);
  const statusErrors = (fn) => handle(async (req, res) => {
    try { await fn(req, res); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
  });
  router.get('/logs', statusErrors(async (req, res) => {
    const q = req.query;
    res.json(await logsSvc(req).list({ process: q.proceso || '', status: q.estado || '', from: q.desde || '', to: q.hasta || '', q: q.q || '',
      empty: q.vacios === '1', page: q.pagina, pageSize: q.tam }));
  }));
  router.get('/logs/resumen', statusErrors(async (req, res) => {
    res.json(await logsSvc(req).summary());
  }));

  router.use((err, _req, res, next) => {
    if (err instanceof FinanceError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    next(err);
  });
  return router;
}
