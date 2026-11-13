import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { requireSameOrigin } from '../auth/origin.js';
import { viewAs } from '../auth/viewAs.js';
import { getStorage } from '../obras/storage.js';
import { FileError, MAX_PHOTO, sniff } from '../obras/validation.js';
import { HerramientasService, ToolError } from '../herramientas/service.js';
import { PresupuestoError } from '../presupuestos/service.js';
import { qrSvg } from '../herramientas/qr.js';

// Ledens Tools (/api/herramientas). Admins and jefes de obra; clients get 403
// (no access in the MVP). What each one sees and may do is decided per row in
// HerramientasService (src/herramientas/). «Ver como» answers as the viewed
// user, read-only (viewAs refuses anything but GET). Writes only from our own
// page (Origin check, same CSRF guard as /api/presupuestos), and the moves a
// phone may retry on a bad connection accept an Idempotency-Key header.
// Static paths are declared before /:id so «solicitudes», «panel», … never
// read as an asset id.
// `authenticate`/`findUser`/`pool`/`storage` replace the real ones in tests.
export function createHerramientasRouter({ authenticate, findUser, pool, storage, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Herramientas no disponibles todavía' });
    next();
  });
  router.use(authenticate || requireAuth, viewAs({ findUser }), checkRole('admin', 'jefe'));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas peticiones. Inténtalo de nuevo en un minuto.' } }));
  // Writes: our web Origin, or a validated Bearer without Origin (auth/origin.js).
  router.use(requireSameOrigin({ origin }));
  const photo = express.raw({ type: () => true, limit: MAX_PHOTO });
  const csv = express.text({ type: () => true, limit: '1mb' });

  const svc = (req) => new HerramientasService(pool || getPool(), req.user, { storage: storage === undefined ? safeStorage() : storage });
  const key = (req) => req.get('idempotency-key') || undefined;
  const handle = (fn, status = 200) => async (req, res, next) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.status(out?.replayed ? 200 : status).json(out);
    } catch (e) {
      if (e instanceof ToolError || e instanceof PresupuestoError || e instanceof FileError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
      next(e);
    }
  };
  const image = (req) => {
    const mime = Buffer.isBuffer(req.body) && req.body.length ? sniff(req.body) : null;
    if (!mime || mime === 'application/pdf') throw new FileError(415, 'Sube una foto JPG, PNG o HEIC');
    return mime;
  };
  const sendPhoto = (f, res) => {
    res.set({ 'Content-Type': f.mime || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    f.stream.on('error', () => res.destroy());
    f.stream.pipe(res);
  };

  // Catalogue and reading
  router.get('/', handle((req) => svc(req).list(req.query)));
  router.get('/opciones', handle((req) => svc(req).options()));
  router.get('/mis-obras', handle((req) => svc(req).myObras()));
  router.get('/obras/:projectId', handle((req) => svc(req).projectTools(req.params.projectId)));
  router.get('/panel', handle((req) => svc(req).dashboard(req.query)));
  router.get('/avisos', handle((req) => svc(req).alerts()));
  router.get('/disponibilidad', handle((req) => svc(req).availability(req.query)));
  router.get('/etiqueta/:token', handle((req) => svc(req).resolveLabel(req.params.token)));
  router.post('/etiquetas', handle((req) => svc(req).labels(req.body?.ids)));
  router.post('/tipos', handle((req) => svc(req).createType(req.body || {}), 201));
  router.post('/ubicaciones', handle((req) => svc(req).createLocation(req.body || {}), 201));
  router.post('/importar', csv, handle((req) => svc(req).importCsv(req.body, { dryRun: req.query.simular === '1' })));

  // Movements
  router.get('/movimientos/pendientes', handle((req) => svc(req).pendingMovements()));
  router.post('/movimientos', handle((req) => svc(req).move(req.body || {}, key(req)), 201));
  router.post('/movimientos/:id/recibir', handle((req) => svc(req).receive(req.params.id, req.body || {}, key(req))));
  router.post('/movimientos/:id/cancelar', handle((req) => svc(req).cancelMovement(req.params.id, req.body || {})));
  router.post('/movimientos/:id/no-entregado', handle((req) => svc(req).notDelivered(req.params.id, req.body || {})));

  // Requests and reservations
  router.get('/solicitudes', handle((req) => svc(req).listRequests(req.query)));
  router.post('/solicitudes', handle((req) => svc(req).createRequest(req.body || {}, key(req)), 201));
  router.get('/solicitudes/:id', handle((req) => svc(req).getRequest(req.params.id)));
  router.post('/solicitudes/:id/presentar', handle((req) => svc(req).submitRequest(req.params.id)));
  router.post('/solicitudes/:id/revisar', handle((req) => svc(req).reviewRequest(req.params.id)));
  router.post('/solicitudes/:id/aprobar', handle((req) => svc(req).approveRequest(req.params.id, req.body || {}, key(req))));
  router.post('/solicitudes/:id/rechazar', handle((req) => svc(req).rejectRequest(req.params.id, req.body || {})));
  router.post('/solicitudes/:id/preparar', handle((req) => svc(req).prepareRequest(req.params.id)));
  router.post('/solicitudes/:id/despachar', handle((req) => svc(req).dispatchRequest(req.params.id, req.body || {}, key(req))));
  router.post('/solicitudes/:id/finalizar', handle((req) => svc(req).finishRequest(req.params.id)));
  router.post('/solicitudes/:id/cancelar', handle((req) => svc(req).cancelRequest(req.params.id, req.body || {})));
  router.post('/reservas', handle((req) => svc(req).reserve(req.body || {}, key(req)), 201));
  router.post('/reservas/:id/cancelar', handle((req) => svc(req).cancelReservation(req.params.id, req.body || {})));

  // Incidents, maintenance, counts, consumables
  router.post('/incidencias/:id/foto', photo, handle((req) => svc(req).incidentPhoto(req.params.id, req.body, image(req))));
  router.post('/incidencias/:id/resolver', handle((req) => svc(req).resolveIncident(req.params.id, req.body || {})));
  router.post('/recuentos', handle((req) => svc(req).startCount(req.body || {}), 201));
  router.get('/recuentos/:id', handle((req) => svc(req).getCount(req.params.id)));
  router.post('/recuentos/:id/vistos', handle((req) => svc(req).countSeen(req.params.id, req.body || {})));
  router.post('/recuentos/:id/cerrar', handle((req) => svc(req).closeCount(req.params.id)));
  router.get('/consumibles', handle((req) => svc(req).consumables()));
  router.post('/consumibles/ajustes', handle((req) => svc(req).adjustConsumable(req.body || {}, key(req))));

  // One asset (uuid or code such as LED-TOOL-000042)
  router.post('/', handle((req) => svc(req).create(req.body || {}), 201));
  router.get('/:id', handle((req) => svc(req).get(req.params.id)));
  router.patch('/:id', handle((req) => svc(req).update(req.params.id, req.body || {})));
  router.get('/:id/historial', handle((req) => svc(req).history(req.params.id)));
  router.get('/:id/qr.svg', handle(async (req, res) => {
    const { herramienta } = await svc(req).get(req.params.id);
    if (!herramienta.qrUrl) throw new ToolError(403, 'Solo administración imprime etiquetas');
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(qrSvg(herramienta.qrUrl));
  }));
  router.get('/:id/foto', handle(async (req, res) => sendPhoto(await svc(req).openPhoto(req.params.id), res)));
  router.get('/:id/incidencias/:incidentId/foto', handle(async (req, res) => sendPhoto(await svc(req).openPhoto(req.params.id, req.params.incidentId), res)));
  router.put('/:id/foto', photo, handle((req) => svc(req).assetPhoto(req.params.id, req.body, image(req))));
  router.post('/:id/baja', handle((req) => svc(req).retire(req.params.id, req.body || {})));
  router.post('/:id/etiqueta', handle((req) => svc(req).relabel(req.params.id, req.body || {})));
  router.put('/:id/componentes', handle((req) => svc(req).setKitItems(req.params.id, req.body || {})));
  router.patch('/:id/componentes/:itemId', handle((req) => svc(req).setKitMissing(req.params.id, req.params.itemId, req.body || {})));
  router.post('/:id/incidencias', handle((req) => svc(req).report(req.params.id, req.body || {}, key(req)), 201));
  router.post('/:id/mantenimiento', handle((req) => svc(req).openMaintenance(req.params.id, req.body || {})));
  router.post('/:id/mantenimiento/cerrar', handle((req) => svc(req).closeMaintenance(req.params.id, req.body || {})));

  router.use((err, _req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo supera el tamaño máximo' });
    next(err);
  });
  return router;
}

// Photos share the obra-archivos storage. Unconfigured in production ⇒ null,
// and the service answers 503 for photos while everything else keeps working.
function safeStorage() {
  try { return getStorage(); } catch { return null; }
}
