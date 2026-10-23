// Calls to /api/finanzas (backend: ledens/backend/src/routes/finanzas.js).
// Same-origin relative paths, session cookie travels by itself.
export class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

async function request(method, url, body) {
  if(body&&method!=='GET')body={...body,request_id:body.request_id||crypto.randomUUID()};
  let r;
  try {
    r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
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
};
