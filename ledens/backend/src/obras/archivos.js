import { randomUUID } from 'node:crypto';
import { PresupuestosService, isUuid } from '../presupuestos/service.js';
import { FileError, validateUpload, validateThumb } from './validation.js';

// Fotos y documentos de una obra (migration 022). One service per request,
// built with the effective user (after «Ver como»). Who sees an obra is what
// PresupuestosService decides: admin all, a jefe the ones assigned to them, a
// client their own once sent. Only the team of the obra (its jefe or an admin)
// uploads and withdraws files. Files hang from the root presupuesto.
const fail = (status, message) => { throw new FileError(status, message); };

const text = (v, field, max) => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return null;
  if (typeof v !== 'string') fail(400, `${field} no válido`);
  if (v.trim().length > max) fail(400, `${field}: máximo ${max} caracteres`);
  return v.trim();
};
// The day the photo was taken or the document is dated; today (Madrid) by default.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const day = (v) => {
  if (v === undefined || v === null || v === '') return today();
  const ok = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v);
  if (!ok || v < '2000-01-01' || v > today()) fail(400, 'Fecha no válida');
  return v;
};
const notFound = (e) => e?.code === 'ENOENT' || e?.statusCode === 404;

export class ObraArchivosService {
  constructor(pool, user, storage) {
    this.pool = pool; this.user = user; this.storage = storage;
    this.presu = new PresupuestosService(pool, user);
  }

  async obra(id) {
    const p = await this.presu.load(this.pool, id);
    if (p.parent_id) fail(409, 'Las fotos y documentos se guardan en la obra principal, no en la ampliación');
    return p;
  }
  async teamObra(id) {
    const p = await this.obra(id);
    if (!this.presu.isTeam(p)) fail(403, 'Solo el jefe de obra asignado o un administrador puede subir o retirar archivos');
    return p;
  }
  needStorage() { if (!this.storage) fail(503, 'El almacenamiento de archivos aún no está configurado'); }

  async row(p, fileId) {
    if (!isUuid(fileId)) fail(404, 'Archivo no encontrado');
    const r = (await this.pool.query('SELECT * FROM obra_archivos WHERE id=$1 AND presupuesto_id=$2 AND deleted_at IS NULL', [fileId, p.id])).rows[0];
    if (!r) fail(404, 'Archivo no encontrado');
    return r;
  }

  item(r) {
    const url = `/api/obras/${r.presupuesto_id}/archivos/${r.id}`;
    return {
      id: r.id, kind: r.kind, mime: r.mime, name: r.original_name, title: r.title, description: r.description,
      date: typeof r.taken_on === 'string' ? r.taken_on : r.taken_on.toISOString().slice(0, 10),
      size: Number(r.size_bytes), uploadedAt: r.uploaded_at, uploadedBy: r.uploader || null,
      url, downloadUrl: `${url}?descargar=1`, thumbUrl: r.thumb_key ? `${url}/miniatura` : null,
    };
  }

  async list(id) {
    const p = await this.obra(id);
    const rows = (await this.pool.query(`
      SELECT a.*, a.taken_on::text taken_on, coalesce(u.name, u.email) uploader FROM obra_archivos a LEFT JOIN users u ON u.id=a.uploaded_by
       WHERE a.presupuesto_id=$1 AND a.deleted_at IS NULL ORDER BY a.taken_on DESC, a.uploaded_at DESC`, [p.id])).rows;
    const items = rows.map((r) => this.item(r));
    return {
      fotos: items.filter((i) => i.kind === 'foto'),
      documentos: items.filter((i) => i.kind === 'documento'),
      can: { upload: this.presu.isTeam(p) && !!this.storage },
    };
  }

  async upload(id, { content, name, title, description, date }) {
    const p = await this.teamObra(id);
    this.needStorage();
    const meta = await validateUpload(content, name);
    const fields = { title: text(title, 'Título', 200), description: text(description, 'Descripción', 2000), date: day(date) };
    const fileId = randomUUID();
    const key = `${p.id}/${fileId}`;
    await this.storage.put(key, content, meta.mime);
    try {
      const r = (await this.pool.query(`
        INSERT INTO obra_archivos (id, presupuesto_id, kind, storage_key, mime, size_bytes, sha256, original_name, title, description, taken_on, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *, taken_on::text taken_on`,
      [fileId, p.id, meta.kind, key, meta.mime, meta.size, meta.sha256, meta.name, fields.title, fields.description, fields.date, this.user.id])).rows[0];
      return this.item({ ...r, uploader: this.user.name || this.user.email });
    } catch (e) {
      await this.storage.remove(key).catch(() => {});
      throw e;
    }
  }

  // JPEG preview made by the uploader's browser, so the backend needs no image library.
  async thumb(id, fileId, content) {
    const p = await this.teamObra(id);
    this.needStorage();
    const r = await this.row(p, fileId);
    if (r.kind !== 'foto') fail(400, 'Solo las fotos tienen miniatura');
    if (r.thumb_key) fail(409, 'La foto ya tiene miniatura');
    validateThumb(content);
    const key = `${p.id}/${r.id}.thumb.jpg`;
    await this.storage.put(key, content, 'image/jpeg');
    await this.pool.query('UPDATE obra_archivos SET thumb_key=$2, thumb_bytes=$3 WHERE id=$1', [r.id, key, content.length]);
    return { thumbUrl: `/api/obras/${p.id}/archivos/${r.id}/miniatura` };
  }

  async open(id, fileId, { thumb } = {}) {
    const p = await this.obra(id);
    this.needStorage();
    const r = await this.row(p, fileId);
    const key = thumb ? r.thumb_key : r.storage_key;
    if (!key) fail(404, 'Miniatura no disponible');
    try {
      const { stream, size } = await this.storage.get(key);
      return { stream, size, mime: thumb ? 'image/jpeg' : r.mime, name: r.original_name };
    } catch (e) {
      if (notFound(e)) fail(404, 'Archivo no encontrado');
      throw e;
    }
  }

  // Withdrawn for everyone at once (the row keeps who and when); then the bytes go.
  async remove(id, fileId) {
    const p = await this.teamObra(id);
    const r = await this.row(p, fileId);
    await this.pool.query('UPDATE obra_archivos SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [r.id, this.user.id]);
    if (this.storage) {
      for (const key of [r.storage_key, r.thumb_key].filter(Boolean)) {
        await this.storage.remove(key).catch((e) => console.error('[obras] could not delete stored file', r.id, e.code || e.name));
      }
    }
    return { ok: true };
  }
}
