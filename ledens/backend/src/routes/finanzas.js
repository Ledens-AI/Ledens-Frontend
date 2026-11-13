import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { requireSameOrigin } from '../auth/origin.js';
import {FinanceError} from '../finance/service.js';
import { FinanzasService, FinError, TYPES, isUuid, DETAIL_MAX_BYTES, ORDER_MAX_FILES } from '../finanzas/service.js';
import { InvoiceOcr } from '../ingestion/ocr.js';
import { ProjectsService } from '../finanzas/projects.js';
import { WorkersService } from '../finanzas/workers.js';
import { PayablesService } from '../finanzas/payables.js';
import { traced, RunLogService } from '../logs/runs.js';

// Gestión financiera (/api/finanzas). Internal accounting data: admins and
// jefes de obra only — a client never reaches any of it, whatever the
// frontend shows. The browser only ever sends ids and amounts; every query is
// fixed server-side (no SQL or column names come from the request).
export const FINANZAS_ROLES = ['admin', 'jefe'];

// `authenticate` replaces only the session lookup (tests); the role check is
// always the real one.
export function createFinanzasRouter({ service, projects, workers, payables, runLogs, authenticate, findUser, origin=process.env.CORS_ORIGIN, ocr } = {}) {
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

  // Writes: our web Origin, or a validated Bearer without Origin (auth/origin.js).
  router.use(requireSameOrigin({ origin }));
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

  const recordFilters = (q) => ({
    type: q.tipo || undefined, pending: q.pendientes === '1', estado: q.estado || undefined, project: q.proyecto || undefined,
    q: String(q.q || '').slice(0, 100), from: q.desde || undefined, to: q.hasta || undefined, min: q.min, max: q.max,
    tercero: typeof q.trabajador === 'string' ? q.trabajador : undefined, rol: typeof q.rol === 'string' ? q.rol : undefined,
  });
  router.get('/registros', handle(async (req, res) => {
    const q = req.query;
    res.json(await svc(req).listRecords({ ...recordFilters(q), sort: q.orden, dir: q.dir, page: q.pagina, pageSize: q.tam }));
  }));
  // «Pagos a trabajadores»: paid per worker and week / month / year (chart).
  router.get('/pagos-trabajadores/serie', handle(async (req, res) => {
    res.json(await svc(req).workerPaymentSeries({ ...recordFilters(req.query), periodo: req.query.periodo || undefined }));
  }));

  // { ids: [worker payment id], period: 'semana' | 'mes' | 'anio' | null, startsOn: 'YYYY-MM-DD' | null }
  router.put('/pagos-trabajadores/periodo', traced('pago_trabajadores', 'Periodo trabajado', { summary: (b) => ({ message: `${b.updated} ${b.updated === 1 ? 'pago cambiado' : 'pagos cambiados'}` }) })(async (req, res) => {
    const b = req.body || {};
    res.json(await svc(req).setWorkPeriods({ ids: b.ids, period: b.period ?? null, startsOn: b.startsOn ?? null }));
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

  // Rentabilidad por proyecto: ingresos − costes per project and the movements behind them.
  router.get('/rentabilidad', handle(async (req, res) => {
    const q = req.query;
    res.json(await svc(req).projectResults({
      project: q.proyecto || undefined, tipo: q.tipo || undefined, contable: q.contable || undefined,
      q: String(q.q || '').slice(0, 100), from: q.desde || undefined, to: q.hasta || undefined,
      sort: q.orden, dir: q.dir, page: q.pagina, pageSize: q.tam,
    }));
  }));

  router.get('/proyectos/:id/rentabilidad', handle(async (req, res) => {
    res.json(await svc(req).profitability(req.params.id));
  }));

  // Movimientos conciliados: one row per reconciled movement, its documents, class
  // and project assignment. The per-record change of class below stays for the API.
  router.get('/conciliados', handle(async (req, res) => {
    res.json(await svc(req).reconciled({ page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100), clase: req.query.clase || '', proyecto: req.query.proyecto || '', from: req.query.desde, to: req.query.hasta }));
  }));
  router.put('/conciliados/:recordId/clasificacion', traced('imputacion', 'Cambio de clasificación', { entity: (req) => ({ type: 'registro', id: req.params.recordId }), summary: (b) => ({ message: 'Clasificado como ' + b.clase, detail: { clase: b.clase, categoria: b.category } }) })(async (req, res) => {
    const b = req.body || {};
    res.json(await svc(req).reclassify({ recordId: req.params.recordId, clase: b.clase, version: b.version, reason: b.reason }));
  }));

  // Documentos sin asignar: processed documents with no confirmed movement (admins).
  router.get('/documentos-sin-asignar', handle(async (req, res) => {
    const q = req.query;
    res.json(await svc(req).unassignedDocuments({ page: q.pagina, pageSize: q.tam, q: String(q.q || '').slice(0, 100), tipo: q.tipo || '', estado: q.estado || '', from: q.desde, to: q.hasta }));
  }));
  // Concepto de movimientos: every movement and its class (admins).
  // «Regla Obramat» on demand (it also runs after each periodic Bridge run).
  router.post('/movimientos/regla-obramat', traced('imputacion', 'Regla Obramat', { summary: (b) => ({ status: b.clasificados === 0 && b.errores ? 'rechazado' : 'ok', message: `${b.clasificados} clasificados · ${b.errores} sin clasificar`, detail: { evaluados: b.evaluados, clasificados: b.clasificados, errores: b.errores, vacio: !b.evaluados } }) })(async (req, res) => {
    res.json(await svc(req).applyObramatRule());
  }));
  router.get('/movimientos/pendientes', handle(async (req, res) => { res.json(await svc(req).movementsPending()); }));
  // Materiales sin registro contable (admins): GET reports the plan; POST applies it ({ ids? }).
  router.get('/materiales/sin-registro', handle(async (req, res) => { res.json(await svc(req).registerOrphans(undefined, { limit: req.query.tam })); }));
  router.post('/materiales/sin-registro/registrar', traced('imputacion', 'Registrar materiales sin registro', { summary: (b) => ({ message: `${b.resumen.registrar} registrados · ${b.resumen.omitir} omitidos`, detail: b.resumen }) })(async (req, res) => {
    res.json(await svc(req).registerOrphans(undefined, { ids: req.body?.ids || null, apply: true }));
  }));
  // Read-only diagnosis of one movement (admins): GET /api/finanzas/movimientos/:id/diagnostico.
  router.get('/movimientos/:id/diagnostico', handle(async (req, res) => { res.json(await svc(req).movementDiagnosis(req.params.id)); }));
  router.get('/movimientos', handle(async (req, res) => {
    res.json(await svc(req).movements({ page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100), clase: req.query.clase || '', from: req.query.desde, to: req.query.hasta }));
  }));
  // { clase: 'materiales' | 'trabajadores' | 'clientes' | 'reembolso_proveedor', version, reason? }
  router.put('/movimientos/:id/clasificacion', traced('imputacion', 'Clasificación de movimiento', { entity: (req) => ({ type: 'movimiento', id: req.params.id }), summary: (b) => ({ message: 'Movimiento clasificado como ' + b.clase, detail: { clase: b.clase, via: b.via } }) })(async (req, res) => {
    const b = req.body || {};
    res.json(await svc(req).classifyMovement({ id: req.params.id, clase: b.clase, version: b.version, reason: b.reason }));
  }));
  // «Segregar conceptos» (Materiales pendiente de asignación): a provisional material payment
  // replaced by the concepts of its reconciled invoice; 409 with sin_conceptos when it has none.
  router.post('/materiales/:materialId/segregar', traced('imputacion', 'Segregar conceptos de la factura', { entity: (req) => ({ type: 'material', id: req.params.materialId }), summary: (b) => ({ message: 'Pago provisional sustituido por los conceptos de ' + (b.documentos || []).join(', ') }) })(async (req, res) => {
    res.json(await svc(req).segregateMaterial(req.params.materialId));
  }));
  // «Adjuntar detalle»: the raw file (PDF, JPG or PNG) with the product detail of a
  // reconciled document that has no concepts; the OCR reads it (costs F0 quota,
  // so it has its own small limit).
  const detailLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados documentos seguidos. Espera unos minutos.' } });
  const readerOf = () => ocr || (process.env.DI_ENDPOINT && process.env.DI_KEY ? new InvoiceOcr(process.env.DI_ENDPOINT, process.env.DI_KEY) : null);
  router.post('/movimientos/:id/documentos/:documentId/detalle', detailLimit, express.raw({ type: () => true, limit: DETAIL_MAX_BYTES }),
    traced('imputacion', 'Detalle de productos adjuntado', { entity: (req) => ({ type: 'documento', id: req.params.documentId }), summary: (b) => ({ message: `${b.lineas} conceptos registrados desde el detalle adjunto`, detail: { movimiento_id: b.movimiento?.id, lineas: b.lineas } }) })(async (req, res) => {
      res.json(await svc(req).attachDocumentDetail({ id: req.params.id, documentId: req.params.documentId, content: Buffer.isBuffer(req.body) ? req.body : null, ocr: readerOf() }));
    }));
  // «Segregar» with the documents of an anticipo (the anticipo, its devoluciones, its invoices;
  // Obramat PDFs read from their text, any other with the invoice OCR): the files one after another as the body, their sizes in X-Archivos-Tamanos ("123,456");
  // X-Devoluciones (URI-encoded JSON {número de la devolución: movimiento}) picks the
  // receipt of a devolución when several fit (409 devoluciones_ambiguas).
  const orderFiles = (req) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const sizes = String(req.get('x-archivos-tamanos') || '').split(',').filter(Boolean).map(Number);
    if (!sizes.length || sizes.length > ORDER_MAX_FILES || sizes.some((n) => !Number.isInteger(n) || n <= 0) || sizes.reduce((a, n) => a + n, 0) !== body.length)
      throw new FinError(400, 'No se han recibido bien los documentos adjuntos; vuelve a adjuntarlos');
    let refundMovements = {};
    try { refundMovements = JSON.parse(decodeURIComponent(req.get('x-devoluciones') || '%7B%7D')); } catch { throw new FinError(400, 'Elección de devoluciones no válida'); }
    if (!refundMovements || typeof refundMovements !== 'object' || Array.isArray(refundMovements) || Object.values(refundMovements).some((v) => !isUuid(v)))
      throw new FinError(400, 'Elección de devoluciones no válida');
    let at = 0;
    return { files: sizes.map((n) => body.subarray(at, at += n)), refundMovements, ocr: readerOf() };
  };
  const orderSummary = (b) => ({ message: `Anticipo ${(b.documentos || []).join(', ')} sustituido por ${b.lineas} productos${b.pedido ? ' del pedido ' + b.pedido : ''}`, detail: { pedido: b.pedido, lineas: b.lineas, devoluciones: b.devoluciones } });
  const orderUpload = express.raw({ type: () => true, limit: ORDER_MAX_FILES * DETAIL_MAX_BYTES });
  router.post('/materiales/:materialId/segregar-pedido', detailLimit, orderUpload,
    traced('imputacion', 'Segregar con los documentos del anticipo', { entity: (req) => ({ type: 'material', id: req.params.materialId }), summary: orderSummary })(async (req, res) => {
      res.json(await svc(req).segregateOrder({ materialId: req.params.materialId, ...orderFiles(req) }));
    }));
  // The same from a «Documento pendiente de desglose» (a document read without lines):
  // its detail (one file) or the documents of its anticipo (several).
  router.post('/documentos/:documentId/segregar-pedido', detailLimit, orderUpload,
    traced('imputacion', 'Segregar con los documentos del anticipo', { entity: (req) => ({ type: 'documento', id: req.params.documentId }), summary: orderSummary })(async (req, res) => {
      res.json(await svc(req).segregateOrder({ documentId: req.params.documentId, ...orderFiles(req) }));
    }));
  router.post('/documentos/:documentId/detalle', detailLimit, express.raw({ type: () => true, limit: DETAIL_MAX_BYTES }),
    traced('imputacion', 'Detalle de productos adjuntado', { entity: (req) => ({ type: 'documento', id: req.params.documentId }), summary: (b) => ({ message: `${b.lineas} conceptos registrados desde el detalle adjunto`, detail: { lineas: b.lineas } }) })(async (req, res) => {
      res.json(await svc(req).attachDocumentDetail({ id: null, documentId: req.params.documentId, content: Buffer.isBuffer(req.body) ? req.body : null, ocr: readerOf() }));
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

  // Pago de clientes. { movementIds: [uuid], projectId? } → incoming movements the
  // Bridge did not recognise become client payments and leave Pendiente de conciliación.
  router.post('/conciliacion/pago-clientes', traced('cobros_clientes', 'Envío desde conciliación', { summary: b=>({status:b.ok===0&&b.failed?'rechazado':'ok',message:`${b.ok} correctos · ${b.failed} con error`,detail:{correctos:b.ok,errores:b.failed}}) })(async (req, res) => {
    res.json(await svc(req).classifyCustomerPayments({ movementIds: req.body?.movementIds, projectId: req.body?.projectId || null }));
  }));

  // Pagos y cobros en efectivo (admins). They wait in Pendiente de conciliación;
  // a pago goes to trabajadores through /conciliacion/pago-trabajadores above.
  router.post('/conciliacion/efectivo', traced('efectivo', 'Alta de efectivo', { summary: b=>({ message: `${b.kind==='pago'?'Pago':'Cobro'} de ${b.amount} €`, detail: { tipo: b.kind, importe: b.amount, fecha: b.fecha } }) })(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await svc(req).createCash({ kind: b.kind, amount: b.amount, date: b.date, concept: b.concept, counterparty: b.counterparty }));
  }));
  router.post('/conciliacion/efectivo/:id/asignar', traced('efectivo', 'Asignación de efectivo', { entity: (req) => ({ type: 'efectivo', id: req.params.id }), summary: b=>({ message: b.assigned==='materiales'?'Asignado a Pagos de materiales':'Asignado a Pagos de clientes', detail: { destino: b.assigned } }) })(async (req, res) => {
    const b = req.body || {};
    res.json(await svc(req).assignCash({ id: req.params.id, target: b.target, projectId: b.projectId || null, description: b.description, counterparty: b.counterparty }));
  }));
  router.post('/conciliacion/efectivo/:id/descartar', traced('efectivo', 'Descarte de efectivo importado', { entity: (req) => ({ type: 'efectivo', id: req.params.id }), summary: () => ({ message: 'Efectivo importado descartado' }) })(async (req, res) => {
    res.json(await svc(req).discardCash({ id: req.params.id, reason: (req.body || {}).reason }));
  }));
  router.delete('/conciliacion/efectivo/:id', traced('efectivo', 'Eliminación de efectivo', { entity: (req) => ({ type: 'efectivo', id: req.params.id }), summary: () => ({ message: 'Efectivo eliminado' }) })(async (req, res) => {
    res.json(await svc(req).deleteCash(req.params.id));
  }));

  router.get('/pendiente-trabajador/resumen', handle(async (req, res) => { res.json(await svc(req).workerQueueSummary()); }));

  router.get('/pendiente-trabajador', handle(async (req, res) => {
    res.json(await svc(req).workerQueue({ page: req.query.pagina, pageSize: req.query.tam, q: String(req.query.q || '').slice(0, 100) }));
  }));

  router.get('/trabajadores', handle(async (req, res) => {
    res.json({ employees: await svc(req).employees() });
  }));

  // { items: [{ splitId, employeeId, projectId, period?, startsOn? }] } — one result per line.
  router.post('/pendiente-trabajador/guardar', traced('pago_trabajadores', 'Guardar pagos', { summary: b=>({status:b.ok===0&&b.failed?'rechazado':'ok',message:`${b.ok} correctos · ${b.failed} con error`,detail:{correctos:b.ok,errores:b.failed}}) })(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.map((i) => ({ splitId: i?.splitId, employeeId: i?.employeeId, projectId: i?.projectId, period: i?.period ?? null, startsOn: i?.startsOn ?? null })) : req.body?.items;
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

  // Cuentas por pagar (admins): the jornales generated day by day and the manual
  // payables. Every read first generates the jornales of the days already past.
  const payablesSvc = (req) => payables || new PayablesService(getPool(), req.user);
  const cxp = (step, message) => traced('cuentas_por_pagar', step, { summary: (b) => ({ message: message(b) }) });
  router.get('/cuentas-por-pagar', handle(async (req, res) => {
    const q = req.query;
    res.json(await payablesSvc(req).list({ estado: q.estado ?? 'pendiente', origen: q.origen || '', trabajador: q.trabajador || '', proyecto: q.proyecto || '',
      desde: q.desde || '', hasta: q.hasta || '', q: q.q || '', page: q.pagina, pageSize: q.tam }));
  }));
  router.get('/cuentas-por-pagar/opciones', handle(async (req, res) => { res.json(await payablesSvc(req).options()); }));
  // ?desde=YYYY-MM-DD (any day of the week / month) &periodo=semana|mes
  router.get('/cuentas-por-pagar/jornales', handle(async (req, res) => {
    res.json(await payablesSvc(req).grid({ desde: req.query.desde || '', periodo: req.query.periodo || 'semana' }));
  }));
  // { items: [{ employeeId, date, works: true | false | null }] }
  router.put('/cuentas-por-pagar/asistencia', cxp('Asistencia', (b) => `${b.updated} días · ${b.generated} jornales generados · ${b.annulled} anulados`)(async (req, res) => {
    res.json(await payablesSvc(req).setAttendance(req.body?.items));
  }));
  // { frequency?: 'semanal' | 'mensual', accrues?: boolean }
  router.put('/cuentas-por-pagar/trabajadores/:id/ajustes', cxp('Ajustes de pago', (b) => (b.changed ? 'Cambios guardados' : 'Sin cambios'))(async (req, res) => {
    const b = req.body || {};
    res.json(await payablesSvc(req).setSettings(req.params.id, { frequency: b.frequency, accrues: b.accrues }));
  }));
  // { ids, status: 'pagada' | 'pendiente' | 'anulada', paidOn? }
  router.post('/cuentas-por-pagar/estado', cxp('Cambio de estado', (b) => `${b.updated} ${b.status === 'pagada' ? 'pagadas' : b.status === 'anulada' ? 'anuladas' : 'pendientes'} · ${b.importe} €`)(async (req, res) => {
    const b = req.body || {};
    res.json(await payablesSvc(req).setStatus({ ids: b.ids, status: b.status, paidOn: b.paidOn || undefined }));
  }));
  // { ids, projectId | null }
  router.post('/cuentas-por-pagar/proyecto', cxp('Imputación a proyecto', (b) => `${b.updated} imputadas`)(async (req, res) => {
    const b = req.body || {};
    res.json(await payablesSvc(req).setProject({ ids: b.ids, projectId: b.projectId ?? null }));
  }));
  router.post('/cuentas-por-pagar', cxp('Alta manual', (b) => 'Alta: ' + (b.payable?.concept || ''))(async (req, res) => {
    res.status(201).json({ payable: await payablesSvc(req).create(req.body || {}) });
  }));
  router.put('/cuentas-por-pagar/:id', cxp('Edición', (b) => (b.payable?.changed ? 'Cambios guardados' : 'Sin cambios'))(async (req, res) => {
    res.json({ payable: await payablesSvc(req).update(req.params.id, req.body || {}) });
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
