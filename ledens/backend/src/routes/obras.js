import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool, isDbConfigured } from '../db/pool.js';
import { requireAuth, checkRole } from '../auth/sessions.js';
import { viewAs } from '../auth/viewAs.js';
import { PresupuestoError } from '../presupuestos/service.js';
import { ObraArchivosService } from '../obras/archivos.js';
import { FileError, MAX_PDF } from '../obras/validation.js';
import { getStorage } from '../obras/storage.js';

// Fotos y documentos de obra (/api/obras/:id/archivos). Same access as
// /api/presupuestos (decided per row in the service); «Ver como» reads only.
// Uploads are the raw file as the body, with its metadata in headers
// (X-Archivo-Nombre, -Titulo, -Descripcion: URI-encoded; X-Archivo-Fecha:
// YYYY-MM-DD), so no multipart parser is needed. Downloads stream through here
// after the permission check: the storage container is never public.
// `authenticate`/`findUser`/`pool`/`storage` replace the real ones in tests.
export function createObrasRouter({ authenticate, findUser, pool, storage, origin = process.env.CORS_ORIGIN } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    if (!pool && !isDbConfigured()) return res.status(503).json({ error: 'Archivos de obra no disponibles todavía' });
    next();
  });
  router.use(authenticate || requireAuth, viewAs({ findUser }), checkRole('admin', 'jefe', 'client'));
  // A gallery loads one request per photo and thumbnail: its own, wider limit.
  router.use(rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
  router.use((req, res, next) => {
    if (req.method !== 'GET' && (!origin || req.get('origin') !== origin)) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });
  const raw = express.raw({ type: () => true, limit: MAX_PDF });

  const svc = (req) => new ObraArchivosService(pool || getPool(), req.user, storage === undefined ? getStorage() : storage);
  const header = (req, name) => {
    const v = req.get(name);
    if (!v) return undefined;
    try { return decodeURIComponent(v); } catch { throw new FileError(400, 'Cabecera no válida'); }
  };
  const handle = (fn) => async (req, res, next) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.status(req.method === 'POST' ? 201 : 200).json(out);
    } catch (e) {
      if (e instanceof FileError || e instanceof PresupuestoError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
  const send = (thumb) => handle(async (req, res) => {
    const f = await svc(req).open(req.params.id, req.params.fileId, { thumb });
    const attachment = !thumb && (req.query.descargar !== undefined || f.mime === 'application/pdf' || f.mime.startsWith('image/hei'));
    res.set({
      'Content-Type': f.mime,
      'Content-Length': String(f.size),
      'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="${f.name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      // A file never changes under its id; private: only this browser may keep it.
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    f.stream.on('error', (e) => { console.error('[obras] stream failed', e.code || e.name); res.destroy(e); });
    f.stream.pipe(res);
  });

  router.get('/:id/archivos', handle((req) => svc(req).list(req.params.id)));
  router.post('/:id/archivos', raw, handle((req) => svc(req).upload(req.params.id, {
    content: req.body, name: header(req, 'x-archivo-nombre'), title: header(req, 'x-archivo-titulo'),
    description: header(req, 'x-archivo-descripcion'), date: req.get('x-archivo-fecha'),
  })));
  router.get('/:id/archivos/:fileId', send(false));
  router.get('/:id/archivos/:fileId/miniatura', send(true));
  router.put('/:id/archivos/:fileId/miniatura', raw, handle((req) => svc(req).thumb(req.params.id, req.params.fileId, req.body)));
  router.delete('/:id/archivos/:fileId', handle((req) => svc(req).remove(req.params.id, req.params.fileId)));
  router.use((err, _req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo supera el tamaño máximo (20 MB)' });
    next(err);
  });
  return router;
}
