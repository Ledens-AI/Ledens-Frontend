// Calls to /api/presupuestos (backend: ledens/backend/src/routes/presupuestos.js).
// «Ver como» travels in the same header as Gestión financiera.
import { ApiError, viewAsHeaders } from '../finanzas/api.js';
import { apiErrorText } from '../../../i18n/apiErrors.js';

// Error texts follow the ES / EN switch (I18nProvider keeps <html lang> in step).
const MSG = {
  es: { net: 'Error de conexión. Comprueba tu red e inténtalo de nuevo.', 401: 'Tu sesión ha caducado. Vuelve a iniciar sesión.', 403: 'No tienes permiso para esta acción.', other: 'No se pudo completar la operación.' },
  en: { net: 'Connection error. Check your network and try again.', 401: 'Your session has expired. Please log in again.', 403: 'You don’t have permission for this action.', other: 'The operation could not be completed.' },
};
const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'es');

async function request(method, url, body) {
  const m = MSG[lang()];
  let r;
  try {
    r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...viewAsHeaders() }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, m.net);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const fallback = m[r.status] || m.other;
    throw new ApiError(r.status, data.error ? apiErrorText(data.error, lang(), fallback) : fallback, data);
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
  schedule: (id, body) => request('PUT', `${base}/${id}/fechas`, body),
  declare: (id, body) => request('PUT', `${base}/${id}/produccion`, body),
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
