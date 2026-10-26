// Calls to /api/finanzas (backend: ledens/backend/src/routes/finanzas.js).
// Same-origin relative paths, session cookie travels by itself.
export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

// «Ver como» (admins): every request then answers as that user, read-only.
let viewAsId = null;
export const setViewAs = (id) => { viewAsId = id || null; };
export const viewAsHeaders = () => (viewAsId ? { 'X-Ledens-View-As': viewAsId } : {});

async function request(method, url, body) {
  if(body&&method!=='GET')body={...body,request_id:body.request_id||crypto.randomUUID()};
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
      : r.status === 429 ? 'Demasiadas operaciones seguidas. Espera un momento.'
      : 'No se pudo completar la operación.';
    throw new ApiError(r.status, data.error || fallback, data);
  }
  return data;
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? '?' + s : '';
};

export const api = {
  bridgeCounts: () => request('GET', '/api/bridge/workspace/counts'),
  bridgeMovements: (f) => request('GET', '/api/bridge/workspace/movements' + qs(f)),
  bridgeAllocations: (f) => request('GET', '/api/bridge/workspace/allocations' + qs(f)),
  bridgeDocuments: (id,f) => request('GET', `/api/bridge/workspace/movements/${id}/documents` + qs(f)),
  bridgeConfirm: (id,body) => request('POST', `/api/bridge/${id}/confirm`, body),
  projects: (q) => request('GET', '/api/finanzas/proyectos' + qs({ q, limit: 30 })),
  summary: () => request('GET', '/api/finanzas/resumen'),
  records: (f) => request('GET', '/api/finanzas/registros' + qs(f)),
  record: (type, id) => request('GET', `/api/finanzas/registros/${type}/${id}`),
  assign: (type, id, body) => request('PUT', `/api/finanzas/registros/${type}/${id}/proyecto`, body),
  distribute: (type, id, body) => request('PUT', `/api/finanzas/registros/${type}/${id}/distribucion`, body),
  review: (type, id, body) => request('PUT', `/api/finanzas/registros/${type}/${id}/revision`, body),
  bulk: (body) => request('POST', '/api/finanzas/registros/lote', body),
  profitability: (projectId) => request('GET', `/api/finanzas/proyectos/${projectId}/rentabilidad`),
  reconciliation: (f) => request('GET', '/api/finanzas/conciliacion' + qs(f)),
  // Movimientos conciliados (admins): classification and its change.
  reconciled: (f) => request('GET', '/api/finanzas/conciliados' + qs(f)),
  reclassify: (recordId, body) => request('PUT', `/api/finanzas/conciliados/${recordId}/clasificacion`, body),
  // Pago a trabajadores (backend: FinanzasService.classifyWorkerPayments …).
  classifyWorkerPayments: (movementIds) => request('POST', '/api/finanzas/conciliacion/pago-trabajadores', { movementIds }),
  // Efectivo (backend: FinanzasService.createCash …; admins only).
  createCash: (body) => request('POST', '/api/finanzas/conciliacion/efectivo', body),
  assignCash: (id, body) => request('POST', `/api/finanzas/conciliacion/efectivo/${id}/asignar`, body),
  deleteCash: (id) => request('DELETE', `/api/finanzas/conciliacion/efectivo/${id}`),
  workerQueue: (f) => request('GET', '/api/finanzas/pendiente-trabajador' + qs(f)),
  employees: () => request('GET', '/api/finanzas/trabajadores'),
  // Proyectos (backend: finanzas/projects.js). Writes are admin-only server-side.
  projectList: (f) => request('GET', '/api/finanzas/gestion-proyectos' + qs(f)),
  getProject: (id) => request('GET', `/api/finanzas/gestion-proyectos/${id}`),
  projectOptions: () => request('GET', '/api/finanzas/gestion-proyectos/opciones'),
  createProject: (body) => request('POST', '/api/finanzas/gestion-proyectos', body),
  updateProject: (id, body) => request('PUT', `/api/finanzas/gestion-proyectos/${id}`, body),
  // Logs de transacciones (backend: logs/runs.js; admins only).
  logs: (f) => request('GET', '/api/finanzas/logs' + qs(f)),
  logsSummary: () => request('GET', '/api/finanzas/logs/resumen'),
  // Trabajadores (backend: finanzas/workers.js). Writes are admin-only server-side.
  workerList: (f) => request('GET', '/api/finanzas/gestion-trabajadores' + qs(f)),
  getWorker: (id) => request('GET', `/api/finanzas/gestion-trabajadores/${id}`),
  workerOptions: () => request('GET', '/api/finanzas/gestion-trabajadores/opciones'),
  createWorker: (body) => request('POST', '/api/finanzas/gestion-trabajadores', body),
  updateWorker: (id, body) => request('PUT', `/api/finanzas/gestion-trabajadores/${id}`, body),
  setWorkerActive: (id, body) => request('PUT', `/api/finanzas/gestion-trabajadores/${id}/estado`, body),
  saveWorkerSplits: (items) => request('POST', '/api/finanzas/pendiente-trabajador/guardar', { items }),
  returnWorkerBatch: (batchId) => request('DELETE', `/api/finanzas/pendiente-trabajador/${batchId}`),
};
