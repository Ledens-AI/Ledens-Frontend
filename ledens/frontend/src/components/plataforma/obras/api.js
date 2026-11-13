// Calls to /api/presupuestos (backend: ledens/backend/src/routes/presupuestos.js).
// «Ver como» travels in the same header as Gestión financiera.
import { ApiError, viewAsHeaders } from '../finanzas/api.js';
import { apiErrorText } from '../../../i18n/apiErrors.js';

// Error texts follow the ES / EN switch (I18nProvider keeps <html lang> in step).
// X-Ledens-Lang: in English a presupuesto also comes with its chapters, lines
// and notes translated (`nameEn`, `descriptionEn`, `notesEn`; see `tr` in i18n.js).
const MSG = {
  es: { net: 'Error de conexión. Comprueba tu red e inténtalo de nuevo.', 401: 'Tu sesión ha caducado. Vuelve a iniciar sesión.', 403: 'No tienes permiso para esta acción.', other: 'No se pudo completar la operación.' },
  en: { net: 'Connection error. Check your network and try again.', 401: 'Your session has expired. Please log in again.', 403: 'You don’t have permission for this action.', other: 'The operation could not be completed.' },
};
const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'es');

async function request(method, url, body) {
  const m = MSG[lang()];
  let r;
  try {
    r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Ledens-Lang': lang(), ...viewAsHeaders() }, body: body ? JSON.stringify(body) : undefined });
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
  approveOnBehalf: (id, body) => request('POST', `${base}/${id}/aprobar-en-nombre`, body),
  requestChanges: (id, body) => request('POST', `${base}/${id}/cambios`, body),
  reject: (id, body) => request('POST', `${base}/${id}/rechazar`, body),
  comment: (id, body) => request('POST', `${base}/${id}/comentarios`, body),
  // Budget PDF → chapters and lines (backend: presupuestos/pdf.js). Saves nothing.
  readPdf: async (file) => {
    let r;
    try {
      r = await fetch(`${base}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', ...viewAsHeaders() }, body: file });
    } catch {
      throw new ApiError(0, 'Error de conexión. Comprueba tu red e inténtalo de nuevo.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data.error || (r.status === 413 ? 'El PDF es demasiado grande (máximo 20 MB).' : 'No se pudo leer el PDF.'), data);
    return data;
  },
  // A draft from the notes/photos/plans of a client visit (backend:
  // presupuestos/agente.js). Saves nothing. Sent as `application/octet-stream`,
  // not `application/json`, so the app's global 64kb JSON body limit never
  // sees it — same trick as readPdf, read raw server-side and parsed there.
  readAgente: async ({ notes, files }) => {
    let r;
    try {
      r = await fetch(`${base}/agente`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...viewAsHeaders() }, body: JSON.stringify({ notes, files }) });
    } catch {
      throw new ApiError(0, 'Error de conexión. Comprueba tu red e inténtalo de nuevo.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data.error || (r.status === 413 ? 'Los archivos superan el tamaño máximo (20 MB en total).' : 'No se ha podido generar el borrador.'), data);
    return data;
  },
  // Admin chat: finds the project itself, reads its already-uploaded visita
  // files, and only then proposes a draft (backend: presupuestos/agenteChat.js).
  // `messages` is the full conversation so far, in Claude's own message
  // format — the frontend keeps it and sends it back whole each turn.
  chatAgente: async (messages) => {
    let r;
    try {
      r = await fetch(`${base}/agente/chat`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...viewAsHeaders() }, body: JSON.stringify({ messages }) });
    } catch {
      throw new ApiError(0, 'Error de conexión. Comprueba tu red e inténtalo de nuevo.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data.error || 'No se ha podido continuar la conversación.', data);
    return data;
  },
  // Proposed new partidas for the base (admins; backend: presupuestos/propuestas.js).
  propuestas: (estado) => request('GET', `${base}/propuestas?estado=${encodeURIComponent(estado || 'pending')}`),
  aprobarPropuesta: (id, body) => request('POST', `${base}/propuestas/${id}/aprobar`, body),
  rechazarPropuesta: (id, body) => request('POST', `${base}/propuestas/${id}/rechazar`, body),
  // The base de partidas (admins; backend: presupuestos/partidas.js).
  partidas: (params) => request('GET', `${base}/partidas?${new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null))}`),
  guardarPartida: (id, body) => request('PATCH', `${base}/partidas/${id}`, body),
  assignJefe: (id, body) => request('PUT', `${base}/${id}/jefe`, body),
  // «Analizar existentes»: a PDF draft against the obra's approved lines (saves nothing).
  compare: (id, body) => request('POST', `${base}/${id}/comparar`, body),
  rename: (id, body) => request('PUT', `${base}/${id}/nombre`, body),
  // Projects of Gestión financiera: the obra's link (team) and a project with its presupuestos.
  setProject: (id, body) => request('PUT', `${base}/${id}/proyecto`, body),
  // { obraId }: this obra becomes an ampliación of that one (same client).
  joinObra: (id, body) => request('PUT', `${base}/${id}/obra`, body),
  projects: () => request('GET', `${base}/proyectos`),
  project: (projectId) => request('GET', `${base}/proyectos/${projectId}`),
  // Planificación (Gantt) of a project with an approved presupuesto (backend: presupuestos/gantt.js).
  gantt: (projectId) => request('GET', `${base}/proyectos/${projectId}/gantt`),
  saveGantt: (projectId, partidaId, body) => request('PUT', `${base}/proyectos/${projectId}/gantt/${partidaId}`, body),
  // Cuadrillas of one obra (1–20): durations from the rendimiento are divided by them.
  // Each cuadrilla is one oficial + one peón (ids of workers), all chosen at once.
  saveGanttCuadrillas: (projectId, obraId, cuadrillas, equipos) => request('PUT', `${base}/proyectos/${projectId}/gantt/obras/${obraId}`, { cuadrillas, equipos }),
  // Gestión de recursos: every worker with their obras and overlaps (presupuestos/recursos.js).
  recursos: () => request('GET', `${base}/recursos`),
  // «Guardar en bloque»: several tasks' predecessors in one request, one
  // transaction server-side (ganttAgente.js never saves by itself).
  saveGanttMany: (projectId, tasks) => request('PUT', `${base}/proyectos/${projectId}/gantt`, { tasks }),
  // The plan as these changes would leave it, with its limitaciones; saves nothing (the draft of Gantt.jsx).
  simulateGantt: (projectId, tasks) => request('POST', `${base}/proyectos/${projectId}/gantt/simular`, { tasks }),
  // Suggests predecessors for the tasks that still have none (presupuestos/ganttAgente.js). Saves nothing.
  ganttAgente: (projectId) => request('POST', `${base}/proyectos/${projectId}/gantt/agente`),
  // Calendario laboral of the Gantt (presupuestos/festivos.js): { fecha, nombre, projectId? }
  // — without projectId it is the whole company's (admin); cargar { anio } (admin).
  festivos: (projectId) => request('GET', `${base}/festivos${projectId ? `?proyecto=${encodeURIComponent(projectId)}` : ''}`),
  addFestivo: (body) => request('POST', `${base}/festivos`, body),
  removeFestivo: (id) => request('DELETE', `${base}/festivos/${id}`),
  cargarFestivos: (anio, projectId) => request('POST', `${base}/festivos/cargar`, { anio, projectId }),
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

// Invitaciones de cliente a una obra (backend: ledens/backend/src/routes/invitaciones.js). Team only.
const inv = (id) => `/api/invitaciones/obras/${id}`;
export const invitaciones = {
  list: (id) => request('GET', inv(id)),
  invite: (id, body) => request('POST', inv(id), body),
  resend: (id, invId) => request('POST', `${inv(id)}/${invId}/reenviar`),
  revoke: (id, invId) => request('POST', `${inv(id)}/${invId}/revocar`),
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
