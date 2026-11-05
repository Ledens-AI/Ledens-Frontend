// Calls to /api/finanzas (backend: ledens/backend/src/routes/finanzas.js).
// Same-origin relative paths, session cookie travels by itself.
export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

// «Ver como» (admins): every request then answers as that user, read-only.
let viewAsId = null;
export const setViewAs = (id) => { viewAsId = id || null; };
export const viewAsHeaders = () => (viewAsId ? { 'X-Ledens-View-As': viewAsId } : {});

// A File/Blob body is sent as is (raw upload); anything else as JSON.
async function request(method, url, body, headers = {}) {
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  if(body&&!raw&&method!=='GET')body={...body,request_id:body.request_id||crypto.randomUUID()};
  let r;
  try {
    r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': raw ? (body.type || 'application/octet-stream') : 'application/json' } : {}), ...headers, ...viewAsHeaders() }, body: raw ? body : body ? JSON.stringify(body) : undefined });
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
  workerSeries: (f) => request('GET', '/api/finanzas/pagos-trabajadores/serie' + qs(f)),
  // Periodo trabajado of saved worker payments: { ids, period, startsOn } (null clears it).
  setWorkPeriods: (body) => request('PUT', '/api/finanzas/pagos-trabajadores/periodo', body),
  record: (type, id) => request('GET', `/api/finanzas/registros/${type}/${id}`),
  assign: (type, id, body) => request('PUT', `/api/finanzas/registros/${type}/${id}/proyecto`, body),
  distribute: (type, id, body) => request('PUT', `/api/finanzas/registros/${type}/${id}/distribucion`, body),
  review: (type, id, body) => request('PUT', `/api/finanzas/registros/${type}/${id}/revision`, body),
  bulk: (body) => request('POST', '/api/finanzas/registros/lote', body),
  // Rentabilidad por proyecto: ingresos − costes per project and the movements assigned to them.
  projectResults: (f) => request('GET', '/api/finanzas/rentabilidad' + qs(f)),
  profitability: (projectId) => request('GET', `/api/finanzas/proyectos/${projectId}/rentabilidad`),
  // Documentos sin asignar (admins): processed documents with no confirmed movement.
  unassignedDocuments: (f) => request('GET', '/api/finanzas/documentos-sin-asignar' + qs(f)),
  // Concepto de movimientos (admins): every movement and its classification.
  movements: (f) => request('GET', '/api/finanzas/movimientos' + qs(f)),
  movementsPending: () => request('GET', '/api/finanzas/movimientos/pendientes'),
  applyObramatRule: () => request('POST', '/api/finanzas/movimientos/regla-obramat', {}),
  // Materiales sin registro contable: the plan, and registering what is safe.
  orphanMaterials: () => request('GET', '/api/finanzas/materiales/sin-registro'),
  registerOrphanMaterials: () => request('POST', '/api/finanzas/materiales/sin-registro/registrar', {}),
  classifyMovement: (id, body) => request('PUT', `/api/finanzas/movimientos/${id}/clasificacion`, body),
  // «Segregar conceptos» (Materiales pendiente de asignación): a provisional material payment.
  segregateMaterial: (materialId) => request('POST', `/api/finanzas/materiales/${materialId}/segregar`, {}),
  // «Adjuntar detalle»: the file with the product detail of a reconciled document without concepts.
  // Without a movement: the document of a «Documento pendiente de desglose».
  attachDocumentDetail: (id, documentId, file) => request('POST', id ? `/api/finanzas/movimientos/${id}/documentos/${documentId}/detalle` : `/api/finanzas/documentos/${documentId}/detalle`, file),
  // «Segregar» with the documents of an anticipo (the anticipo, its devoluciones, its invoices), one after another;
  // target: { materialId } or { documentId } (a «Documento pendiente de desglose»);
  // devoluciones: {número de la devolución: movimiento} when several receipts fit.
  segregateOrder: (target, files, devoluciones = {}) => request('POST', target.documentId ? `/api/finanzas/documentos/${target.documentId}/segregar-pedido` : `/api/finanzas/materiales/${target.materialId}/segregar-pedido`,
    new Blob(files, { type: 'application/octet-stream' }),
    { 'X-Archivos-Tamanos': files.map((f) => f.size).join(','), 'X-Devoluciones': encodeURIComponent(JSON.stringify(devoluciones)) }),
  reconciliation: (f) => request('GET', '/api/finanzas/conciliacion' + qs(f)),
  // Movimientos conciliados (admins): classification and its change.
  reconciled: (f) => request('GET', '/api/finanzas/conciliados' + qs(f)),
  reclassify: (recordId, body) => request('PUT', `/api/finanzas/conciliados/${recordId}/clasificacion`, body),
  // Pago a trabajadores (backend: FinanzasService.classifyWorkerPayments …).
  classifyWorkerPayments: (movementIds) => request('POST', '/api/finanzas/conciliacion/pago-trabajadores', { movementIds }),
  // Pago de clientes: unrecognised incoming movements (FinanzasService.classifyCustomerPayments).
  classifyCustomerPayments: (movementIds, projectId) => request('POST', '/api/finanzas/conciliacion/pago-clientes', { movementIds, projectId: projectId || null }),
  // Efectivo (backend: FinanzasService.createCash …; admins only).
  createCash: (body) => request('POST', '/api/finanzas/conciliacion/efectivo', body),
  assignCash: (id, body) => request('POST', `/api/finanzas/conciliacion/efectivo/${id}/asignar`, body),
  deleteCash: (id) => request('DELETE', `/api/finanzas/conciliacion/efectivo/${id}`),
  discardCash: (id, reason) => request('POST', `/api/finanzas/conciliacion/efectivo/${id}/descartar`, { reason }),
  workerQueueSummary: () => request('GET', '/api/finanzas/pendiente-trabajador/resumen'),
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
  // Cuentas por pagar (backend: finanzas/payables.js; admins only).
  payables: (f) => request('GET', '/api/finanzas/cuentas-por-pagar' + qs(f)),
  payablesOptions: () => request('GET', '/api/finanzas/cuentas-por-pagar/opciones'),
  payablesGrid: (f) => request('GET', '/api/finanzas/cuentas-por-pagar/jornales' + qs(f)),
  setAttendance: (items) => request('PUT', '/api/finanzas/cuentas-por-pagar/asistencia', { items }),
  setPaySettings: (id, body) => request('PUT', `/api/finanzas/cuentas-por-pagar/trabajadores/${id}/ajustes`, body),
  createPayable: (body) => request('POST', '/api/finanzas/cuentas-por-pagar', body),
  updatePayable: (id, body) => request('PUT', `/api/finanzas/cuentas-por-pagar/${id}`, body),
  setPayableStatus: (body) => request('POST', '/api/finanzas/cuentas-por-pagar/estado', body),
  setPayableProject: (body) => request('POST', '/api/finanzas/cuentas-por-pagar/proyecto', body),
  saveWorkerSplits: (items) => request('POST', '/api/finanzas/pendiente-trabajador/guardar', { items }),
  returnWorkerBatch: (batchId) => request('DELETE', `/api/finanzas/pendiente-trabajador/${batchId}`),
};
