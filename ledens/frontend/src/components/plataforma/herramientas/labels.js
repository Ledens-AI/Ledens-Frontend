// Labels, colours and small pure helpers of Ledens Tools. No React here, so
// `node --test` can exercise them (ledens/frontend/test/herramientas.test.js).
// Colours come from the platform design (same pairs as obras/api.js PHASE).

export const STATUS = {
  disponible: { label: 'Disponible', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-checkbox-circle-line' },
  asignada: { label: 'En obra', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-building-2-line' },
  reservada: { label: 'Reservada', bg: '#FDF0F4', fg: '#B84371', icon: 'ri-calendar-check-line' },
  en_traslado: { label: 'En traslado', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-truck-line' },
  averiada: { label: 'Averiada', bg: '#F8E1E1', fg: '#9E2F2F', icon: 'ri-error-warning-line' },
  en_mantenimiento: { label: 'En mantenimiento', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-tools-line' },
  perdida: { label: 'Perdida', bg: '#F8E1E1', fg: '#9E2F2F', icon: 'ri-question-line' },
  robada: { label: 'Robada', bg: '#F8E1E1', fg: '#9E2F2F', icon: 'ri-alarm-warning-line' },
  baja: { label: 'De baja', bg: '#EDEDEA', fg: '#3A3A38', icon: 'ri-archive-line' },
};
export const statusOf = (k) => STATUS[k] || { label: k, bg: '#EDEDEA', fg: '#3A3A38', icon: 'ri-question-line' };

export const LOCATION_KIND = {
  almacen: { label: 'Almacén', icon: 'ri-store-2-line' },
  obra: { label: 'Obra', icon: 'ri-building-2-line' },
  vehiculo: { label: 'Vehículo', icon: 'ri-truck-line' },
  taller: { label: 'Taller de reparación', icon: 'ri-tools-line' },
  proveedor: { label: 'Proveedor', icon: 'ri-shake-hands-line' },
  externa: { label: 'Custodia externa', icon: 'ri-map-pin-user-line' },
  pendiente: { label: 'Pendiente de confirmar', icon: 'ri-map-pin-line' },
};

export const PURPOSE = {
  alta: 'Alta en inventario', entrega: 'Entrega', traslado: 'Traslado', devolucion: 'Devolución', reparacion: 'A reparar', correccion: 'Corrección',
};
export const MOVE_STATUS = {
  pendiente: 'Pendiente de recepción', recibido: 'Recibido', cancelado: 'Cancelado', no_entregado: 'No entregado',
};

export const REQUEST_STATUS = {
  borrador: { label: 'Borrador', bg: '#EDEDEA', fg: '#3A3A38' },
  solicitada: { label: 'Solicitada', bg: '#FBF1DE', fg: '#7A4E0E' },
  en_revision: { label: 'En revisión', bg: '#FBF1DE', fg: '#7A4E0E' },
  aprobada: { label: 'Aprobada', bg: '#DEF3F0', fg: '#2F6B63' },
  parcialmente_aprobada: { label: 'Aprobada en parte', bg: '#DEF3F0', fg: '#2F6B63' },
  rechazada: { label: 'Rechazada', bg: '#F8E1E1', fg: '#9E2F2F' },
  en_preparacion: { label: 'En preparación', bg: '#E3E7F3', fg: '#3E4D85' },
  en_traslado: { label: 'En traslado', bg: '#E3E7F3', fg: '#3E4D85' },
  entregada: { label: 'Entregada', bg: '#E3E7F3', fg: '#3E4D85' },
  finalizada: { label: 'Finalizada', bg: '#EDEDEA', fg: '#3A3A38' },
  cancelada: { label: 'Cancelada', bg: '#EDEDEA', fg: '#3A3A38' },
};

export const INCIDENT_KINDS = [
  ['averia', 'Avería', 'ri-error-warning-line', true],
  ['rotura', 'Rotura', 'ri-hammer-line', true],
  ['perdida', 'Pérdida', 'ri-question-line', true],
  ['robo', 'Robo', 'ri-alarm-warning-line', true],
  ['accesorio_faltante', 'Falta un accesorio', 'ri-puzzle-line', false],
  ['mantenimiento', 'Necesita mantenimiento', 'ri-tools-line', false],
];
export const incidentLabel = (k) => (INCIDENT_KINDS.find((x) => x[0] === k) || [k, k])[1];
// Kinds that always take the asset out of service (the backend decides; this only explains it on screen).
export const alwaysBlocks = (k) => !!(INCIDENT_KINDS.find((x) => x[0] === k) || [])[3];

// Inventory filters of the jefe screen (estado of GET /api/herramientas).
export const FILTERS = [
  ['todas', 'Todas'], ['disponibles', 'Disponibles'], ['mi_obra', 'En mi obra'], ['otras_obras', 'En otras obras'], ['reservadas', 'Reservadas'], ['averiadas', 'Averiadas'],
];
export const ADMIN_FILTERS = [['todas', 'Todas'], ['disponibles', 'Disponibles'], ['asignadas', 'En obra'], ['reservadas', 'Reservadas'], ['en_traslado', 'En traslado'], ['averiadas', 'Averiadas'], ['baja', 'De baja']];

export const can = (perms, p) => Array.isArray(perms) && perms.includes(p);

// A scanned text → what to open. Our labels carry https://<app>/h/<token>; a
// person may also type or scan the asset code itself (LED-TOOL-000042, KIT-…).
export function parseScan(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/\/h\/([A-Za-z0-9_-]{8,40})(?:[/?#]|$)/);
  if (m) return { token: m[1] };
  if (/^[A-Za-z0-9_-]{8,40}$/.test(t) && !/^(LED-TOOL|KIT)-/i.test(t)) return { token: t };
  if (/^[A-Z0-9-]{3,40}$/i.test(t)) return { code: t.toUpperCase() };
  return null;
}

export const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : s;
};
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const todayISO = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const eur = (n) => (n === null || n === undefined || n === '' ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n)));

// Where an asset is, in one line: «Casa Marbella · con Oficial Pérez».
export function whereLine(h) {
  if (!h) return '';
  const loc = h.location?.project?.name || h.location?.name || '—';
  return h.custodian ? `${loc} · con ${h.custodian.name}` : loc;
}

// Local drafts of a form (request, incident): a lost connection or a closed
// tab never loses what was typed. Per browser only; wrapped because storage can
// be unavailable (private mode) — the form then simply works without it.
export const drafts = {
  load(key) { try { const v = globalThis.localStorage?.getItem(`ledens.tools.${key}`); return v ? JSON.parse(v) : null; } catch { return null; } },
  save(key, value) { try { globalThis.localStorage?.setItem(`ledens.tools.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  clear(key) { try { globalThis.localStorage?.removeItem(`ledens.tools.${key}`); } catch { /* storage unavailable */ } },
};
