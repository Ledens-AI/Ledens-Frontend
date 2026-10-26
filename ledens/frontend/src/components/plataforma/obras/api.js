// Calls to /api/presupuestos (backend: ledens/backend/src/routes/presupuestos.js).
// «Ver como» travels in the same header as Gestión financiera.
import { ApiError, viewAsHeaders } from '../finanzas/api.js';

async function request(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...viewAsHeaders() }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Error de conexión. Comprueba tu red e inténtalo de nuevo.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const fallback = r.status === 401 ? 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
      : r.status === 403 ? 'No tienes permiso para esta acción.'
      : 'No se pudo completar la operación.';
    throw new ApiError(r.status, data.error || fallback, data);
  }
  return data;
}

const base = '/api/presupuestos';
export const api = {
  list: () => request('GET', base),
  options: () => request('GET', `${base}/opciones`),
  get: (id, version) => request('GET', `${base}/${id}${version ? `?version=${encodeURIComponent(version)}` : ''}`),
  create: (body) => request('POST', base, body),
  save: (id, body) => request('PUT', `${base}/${id}`, body),
  send: (id) => request('POST', `${base}/${id}/enviar`),
  approve: (id, body) => request('POST', `${base}/${id}/aprobar`, body),
  requestChanges: (id, body) => request('POST', `${base}/${id}/cambios`, body),
  reject: (id, body) => request('POST', `${base}/${id}/rechazar`, body),
  comment: (id, body) => request('POST', `${base}/${id}/comentarios`, body),
  assignJefe: (id, body) => request('PUT', `${base}/${id}/jefe`, body),
  schedule: (id, body) => request('PUT', `${base}/${id}/fechas`, body),
  declare: (id, body) => request('PUT', `${base}/${id}/produccion`, body),
};

// Fotos y documentos de obra (backend: ledens/backend/src/routes/obras.js). An
// upload is the raw file as the body with its metadata in headers; XHR rather
// than fetch for the progress bar on slow mobile connections.
const files = (id) => `/api/obras/${id}/archivos`;
export const archivos = {
  list: (id) => request('GET', files(id)),
  remove: (id, fileId) => request('DELETE', `${files(id)}/${fileId}`),
  upload: (id, file, { title, description, date } = {}, onProgress) => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', files(id));
    const meta = { 'X-Archivo-Nombre': encodeURIComponent(file.name), 'X-Archivo-Fecha': date || '', 'X-Archivo-Titulo': encodeURIComponent(title || ''), 'X-Archivo-Descripcion': encodeURIComponent(description || '') };
    Object.entries({ ...meta, ...viewAsHeaders() }).forEach(([k, v]) => v && x.setRequestHeader(k, v));
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onerror = () => reject(new ApiError(0, 'Error de conexión. Comprueba tu red e inténtalo de nuevo.'));
    x.onload = () => {
      let data = {};
      try { data = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new ApiError(x.status, data.error || (x.status === 413 ? 'El archivo es demasiado grande.' : 'No se pudo subir el archivo.'), data));
    };
    x.send(file);
  }),
  thumb: async (id, fileId, blob) => {
    const r = await fetch(`${files(id)}/${fileId}/miniatura`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', ...viewAsHeaders() }, body: blob });
    if (!r.ok) throw new ApiError(r.status, 'No se pudo guardar la miniatura');
  },
};

// Labels and colours from the platform design.
export const PHASE = {
  borrador: { label: 'Borrador', bg: '#EDEDEA', fg: '#3A3A38', icon: 'ri-draft-line' },
  pendiente: { label: 'Pendiente de decisión', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-time-line' },
  cambios: { label: 'Cambios solicitados', bg: '#FBE0EA', fg: '#B84371', icon: 'ri-chat-3-line' },
  rechazado: { label: 'Rechazado', bg: '#F8E1E1', fg: '#9E2F2F', icon: 'ri-close-circle-line' },
  aprobado: { label: 'Aprobado', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-checkbox-circle-line' },
  en_curso: { label: 'Obra en curso', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-building-2-line' },
};
export const VSTATUS = {
  draft: 'Borrador', sent: 'Enviada', changes_requested: 'Cambios pedidos', superseded: 'Sustituida', approved: 'Aprobada', rejected: 'Rechazada',
};
export const KIND = {
  confirmada: { label: 'Confirmada', bg: '#DEF3F0', fg: '#2F6B63' },
  condicionada: { label: 'Condicionada', bg: '#FBF1DE', fg: '#7A4E0E' },
  decision: { label: 'Pendiente de decisión', bg: '#E3E7F3', fg: '#3E4D85' },
  opcion: { label: 'Opción', bg: '#FDF0F4', fg: '#B84371' },
};

// "1.234,5" or "1234.5" → "1234.5"; null when it is not a number with at most `decimals`.
export function parseDecimal(s, decimals) {
  const t = String(s ?? '').trim().replace(/\s|€/g, '');
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(norm) ? norm : null;
}
export const pctS = (n) => `${String(n).replace('.', ',')} %`;
