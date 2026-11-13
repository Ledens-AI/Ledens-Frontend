import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { requireSameOrigin } from '../auth/origin.js';
import { PresupuestosService, PresupuestoError } from '../presupuestos/service.js';
import { pdfDraft, LayoutOcr } from '../presupuestos/pdf.js';
import { translatorFromEnv } from '../presupuestos/translate.js';
import { translateDoc } from '../presupuestos/traducciones.js';
import { PropuestasService } from '../presupuestos/propuestas.js';
import { PartidasService } from '../presupuestos/partidas.js';
import { GanttService } from '../presupuestos/gantt.js';
import { RecursosService } from '../presupuestos/recursos.js';
import { ganttAgenteDraft } from '../presupuestos/ganttAgente.js';
import { agenteDraft, agenteFromEnv } from '../presupuestos/agente.js';
import { agenteChat } from '../presupuestos/agenteChat.js';
import { getStorage } from '../obras/storage.js';

// Presupuestos para clientes y obras en curso (/api/presupuestos). Every role
// reaches it; what each one sees and may do is decided per row in
// PresupuestosService. «Ver como» answers as the viewed user, read-only.
// `authenticate`/`pool` replace the session lookup and the database in tests.
// `ocr` replaces Azure Document Intelligence (DI_ENDPOINT/DI_KEY) and `translator`
// Azure Translator (AZURE_TRANSLATOR_*) in tests; null turns them off.
export function createPresupuestosRouter({ authenticate, findUser, pool, ocr, translator, anthropic, storage, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Presupuestos no disponibles todavía' });
    next();
  });
  router.use(authenticate || requireAuth, viewAs({ findUser }), checkRole('admin', 'jefe', 'client'));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));
  // Writes: our web Origin, or a validated Bearer without Origin (auth/origin.js).
  router.use(requireSameOrigin({ origin }));

  const svc = (req) => new PresupuestosService(pool || getPool(), req.user);
  const translate = translator !== undefined ? translator : translatorFromEnv();
  // The screen's language (X-Ledens-Lang): a presupuesto read in English also
  // carries its chapters, lines and notes in English (presupuestos/traducciones.js).
  const inLang = (req, doc) => (doc?.version?.chapters ? translateDoc(pool || getPool(), translate, doc, req.get('x-ledens-lang')) : doc);
  const handle = (fn) => async (req, res, next) => {
    try { res.json(await inLang(req, await fn(req))); } catch (e) {
      if (e instanceof PresupuestoError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };

  router.get('/', handle(async (req) => ({ presupuestos: await svc(req).list() })));
  // A budget PDF read into chapters and lines (text layer, else OCR). Saves nothing.
  const layout = ocr !== undefined ? ocr : process.env.DI_ENDPOINT && process.env.DI_KEY ? new LayoutOcr(process.env.DI_ENDPOINT, process.env.DI_KEY) : null;
  router.post('/pdf', rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }),
    express.raw({ type: () => true, limit: 20 * 1024 * 1024 }), handle((req) => pdfDraft(req.user, req.body, { ocr: layout, db: pool || getPool(), translator: translate })));
  // A draft generated from the notes/photos/plans of a client visit, matched
  // against the base de partidas the same way a PDF import is. Saves nothing.
  // Body is read raw (any content-type) and parsed here, same trick as /pdf,
  // so the much larger size limit does not go through the app's 64kb JSON cap.
  const agent = anthropic !== undefined ? anthropic : agenteFromEnv();
  router.post('/agente', rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }),
    express.raw({ type: () => true, limit: 20 * 1024 * 1024 }), handle((req) => {
      let body;
      try { body = JSON.parse(req.body.toString('utf8')); } catch { throw new PresupuestoError(400, 'Cuerpo no válido'); }
      return agenteDraft(req.user, body, { db: pool || getPool(), translator: translate, anthropic: agent });
    }));
  // Admin-only chat: finds the right project, reads its already-uploaded
  // visita files itself (buscar_proyectos/listar_archivos_obra/leer_archivo_obra,
  // over the same obra archivos Blob storage as /api/obras), and only then
  // proposes a draft. Never runs on its own — only on an explicit message.
  const blobStorage = storage !== undefined ? storage : getStorage();
  router.post('/agente/chat', rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }),
    express.raw({ type: () => true, limit: 2 * 1024 * 1024 }), handle((req) => {
      let body;
      try { body = JSON.parse(req.body.toString('utf8')); } catch { throw new PresupuestoError(400, 'Cuerpo no válido'); }
      return agenteChat(req.user, body, { db: pool || getPool(), translator: translate, anthropic: agent, storage: blobStorage });
    }));
  router.get('/opciones', handle((req) => svc(req).options()));
  // Proposed new partidas for the base (admins decide).
  const propuestas = (req) => new PropuestasService(pool || getPool(), req.user);
  router.get('/propuestas', handle((req) => propuestas(req).list({ status: req.query.estado || 'pending' })));
  router.post('/propuestas/:pid/aprobar', handle((req) => propuestas(req).approve(req.params.pid, req.body || {})));
  router.post('/propuestas/:pid/rechazar', handle((req) => propuestas(req).reject(req.params.pid, req.body || {})));
  // The base de partidas (ledens.work_items): admins read and correct it.
  const partidas = (req) => new PartidasService(pool || getPool(), req.user);
  router.get('/partidas', handle((req) => partidas(req).list({ q: req.query.q, categoria: req.query.categoria, activa: req.query.activa, page: req.query.pagina })));
  router.patch('/partidas/:wid', handle((req) => partidas(req).update(req.params.wid, req.body || {})));
  // A project of Gestión financiera with the presupuestos linked to it (team only).
  router.get('/proyectos', handle(async (req) => ({ proyectos: await svc(req).projectsList() })));
  router.get('/proyectos/:projectId', handle((req) => svc(req).projectView(req.params.projectId)));
  // Planificación (Gantt) of a project with an approved presupuesto.
  const gantt = (req) => new GanttService(pool || getPool(), req.user);
  router.get('/proyectos/:projectId/gantt', handle((req) => gantt(req).get(req.params.projectId)));
  // Gestión de recursos: every worker, the obras whose cuadrillas they are in and overlaps (team).
  router.get('/recursos', handle((req) => new RecursosService(pool || getPool(), req.user, (u) => new GanttService(pool || getPool(), u)).list()));
  router.put('/proyectos/:projectId/gantt/obras/:obraId', handle((req) => gantt(req).setCuadrillas(req.params.projectId, req.params.obraId, req.body || {})));
  router.put('/proyectos/:projectId/gantt/:partidaId', handle((req) => gantt(req).update(req.params.projectId, req.params.partidaId, req.body || {})));
  // Several tasks at once — «guardar en bloque» after reviewing the planning
  // agent's suggestions (or any other multi-row edit): one transaction, the
  // whole plan revalidated once, all of it saved or none of it.
  router.put('/proyectos/:projectId/gantt', handle((req) => gantt(req).updateMany(req.params.projectId, req.body?.tasks || [])));
  // The draft of the Gantt: the plan as those changes would leave it, with its
  // limitaciones (e.g. sobreasignación de cuadrillas). Saves nothing.
  router.post('/proyectos/:projectId/gantt/simular', handle((req) => gantt(req).updateMany(req.params.projectId, req.body?.tasks || [], { simular: true })));
  // Suggests predecessors for the tasks that have none yet; never saves them
  // itself (src/presupuestos/ganttAgente.js). Same Anthropic client as /agente.
  router.post('/proyectos/:projectId/gantt/agente', rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }),
    handle((req) => ganttAgenteDraft(req.user, req.params.projectId, { db: pool || getPool(), anthropic: agent })));
  router.get('/:id', handle((req) => svc(req).get(req.params.id, { versionId: req.query.version || undefined })));
  router.post('/', handle((req) => svc(req).create(req.body || {})));
  router.put('/:id', handle((req) => svc(req).saveDraft(req.params.id, req.body || {})));
  // «Analizar existentes»: a PDF draft against the obra's approved lines (saves nothing).
  router.post('/:id/comparar', handle((req) => svc(req).compareWithObra(req.params.id, req.body || {})));
  router.post('/:id/enviar', handle((req) => svc(req).send(req.params.id)));
  router.post('/:id/aprobar', handle((req) => svc(req).approve(req.params.id, req.body || {})));
  router.post('/:id/aprobar-en-nombre', handle((req) => svc(req).approveOnBehalf(req.params.id, req.body || {})));
  router.post('/:id/cambios', handle((req) => svc(req).requestChanges(req.params.id, req.body || {})));
  router.post('/:id/rechazar', handle((req) => svc(req).reject(req.params.id, req.body || {})));
  router.post('/:id/comentarios', handle((req) => svc(req).comment(req.params.id, req.body || {})));
  router.put('/:id/jefe', handle((req) => svc(req).assignJefe(req.params.id, req.body || {})));
  router.put('/:id/proyecto', handle((req) => svc(req).setProject(req.params.id, req.body || {})));
  router.put('/:id/obra', handle((req) => svc(req).joinObra(req.params.id, req.body || {})));
  router.put('/:id/nombre', handle((req) => svc(req).rename(req.params.id, req.body || {})));
  router.put('/:id/fechas',handle((req) => svc(req).schedule(req.params.id, req.body || {})));
  router.put('/:id/produccion', handle((req) => svc(req).declare(req.params.id, req.body || {})));
  router.use((err, _req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El PDF supera el tamaño máximo (20 MB)' });
    next(err);
  });
  return router;
}
