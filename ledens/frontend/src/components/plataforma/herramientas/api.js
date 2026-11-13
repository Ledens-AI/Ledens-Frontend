// Calls to /api/herramientas (backend: ledens/backend/src/routes/herramientas.js).
// «Ver como» travels in the same header as Gestión financiera; the backend
// answers it read-only. Spanish only, like the rest of the team panels.
import { ApiError, viewAsHeaders } from '../finanzas/api.js';

export { ApiError };
const NET = 'Sin conexión con Ledens: la operación NO se ha guardado. Comprueba la cobertura y pulsa Reintentar.';
const BY_STATUS = {
  401: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  403: 'No tienes permiso para esta acción.',
  413: 'El archivo es demasiado grande.',
  429: 'Demasiadas peticiones seguidas. Espera un minuto.',
};

// A key per user action, kept while the action is retried: the server then
// answers the first result instead of registering it twice (backend `once`).
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

export async function request(method, url, body, { key, raw, contentType } = {}) {
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': contentType || (raw ? 'application/octet-stream' : 'application/json') } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...viewAsHeaders(),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, NET, null, 'network');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error || BY_STATUS[r.status] || 'No se pudo completar la operación.', data, data.code);
  return data;
}

const base = '/api/herramientas';
const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;

export const tools = {
  list: (params) => request('GET', `${base}${qs(params)}`),
  get: (idOrCode) => request('GET', `${base}/${enc(idOrCode)}`),
  options: () => request('GET', `${base}/opciones`),
  myObras: () => request('GET', `${base}/mis-obras`),
  project: (projectId) => request('GET', `${base}/obras/${enc(projectId)}`),
  dashboard: (params) => request('GET', `${base}/panel${qs(params)}`),
  alerts: () => request('GET', `${base}/avisos`),
  availability: (params) => request('GET', `${base}/disponibilidad${qs(params)}`),
  resolveLabel: (token) => request('GET', `${base}/etiqueta/${enc(token)}`),
  history: (id) => request('GET', `${base}/${enc(id)}/historial`),
  create: (body) => request('POST', base, body),
  update: (id, body) => request('PATCH', `${base}/${enc(id)}`, body),
  retire: (id, body) => request('POST', `${base}/${enc(id)}/baja`, body),
  relabel: (id, body) => request('POST', `${base}/${enc(id)}/etiqueta`, body),
  labels: (ids) => request('POST', `${base}/etiquetas`, { ids }),
  qrSrc: (id) => `${base}/${enc(id)}/qr.svg`,
  photoSrc: (id, v) => `${base}/${enc(id)}/foto${v ? `?v=${enc(v)}` : ''}`,
  incidentPhotoSrc: (id, incidentId) => `${base}/${enc(id)}/incidencias/${enc(incidentId)}/foto`,
  setPhoto: (id, file) => request('PUT', `${base}/${enc(id)}/foto`, file, { raw: true }),
  setKit: (id, items) => request('PUT', `${base}/${enc(id)}/componentes`, { items }),
  setKitMissing: (id, itemId, missing) => request('PATCH', `${base}/${enc(id)}/componentes/${enc(itemId)}`, { missing }),
  createType: (body) => request('POST', `${base}/tipos`, body),
  createLocation: (body) => request('POST', `${base}/ubicaciones`, body),
  importCsv: (text, simulate) => request('POST', `${base}/importar${simulate ? '?simular=1' : ''}`, text, { raw: true, contentType: 'text/csv' }),
  // Movements
  pending: () => request('GET', `${base}/movimientos/pendientes`),
  move: (body, key) => request('POST', `${base}/movimientos`, body, { key }),
  receive: (id, body, key) => request('POST', `${base}/movimientos/${enc(id)}/recibir`, body || {}, { key }),
  cancelMove: (id, body) => request('POST', `${base}/movimientos/${enc(id)}/cancelar`, body),
  notDelivered: (id, body) => request('POST', `${base}/movimientos/${enc(id)}/no-entregado`, body),
  // Incidents and maintenance
  report: (id, body, key) => request('POST', `${base}/${enc(id)}/incidencias`, body, { key }),
  incidentPhoto: (incidentId, file) => request('POST', `${base}/incidencias/${enc(incidentId)}/foto`, file, { raw: true }),
  resolveIncident: (incidentId, body) => request('POST', `${base}/incidencias/${enc(incidentId)}/resolver`, body),
  openMaintenance: (id, body) => request('POST', `${base}/${enc(id)}/mantenimiento`, body),
  closeMaintenance: (id, body) => request('POST', `${base}/${enc(id)}/mantenimiento/cerrar`, body),
  // Requests and reservations
  requests: (params) => request('GET', `${base}/solicitudes${qs(params)}`),
  request: (id) => request('GET', `${base}/solicitudes/${enc(id)}`),
  createRequest: (body, key) => request('POST', `${base}/solicitudes`, body, { key }),
  requestAction: (id, action, body, key) => request('POST', `${base}/solicitudes/${enc(id)}/${action}`, body || {}, { key }),
  reserve: (body, key) => request('POST', `${base}/reservas`, body, { key }),
  cancelReservation: (id, body) => request('POST', `${base}/reservas/${enc(id)}/cancelar`, body),
  // Consumables and counts
  consumables: () => request('GET', `${base}/consumibles`),
  adjust: (body, key) => request('POST', `${base}/consumibles/ajustes`, body, { key }),
  startCount: (body) => request('POST', `${base}/recuentos`, body),
  count: (id) => request('GET', `${base}/recuentos/${enc(id)}`),
  countSeen: (id, body) => request('POST', `${base}/recuentos/${enc(id)}/vistos`, body),
  closeCount: (id) => request('POST', `${base}/recuentos/${enc(id)}/cerrar`),
};
