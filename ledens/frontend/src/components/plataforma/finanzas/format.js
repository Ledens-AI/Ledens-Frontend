// Display helpers for Gestión financiera. Amounts arrive from the API as
// strings (Postgres numeric) and are only turned into numbers for display.
// useGrouping 'always': es-ES otherwise prints 1200,00 € (no separator under 10.000).
const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const NUM = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' });
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const eur = (v) => (v === null || v === undefined || v === '' ? '—' : EUR.format(Number(v)));
export const num = (v) => (v === null || v === undefined || v === '' ? '—' : NUM.format(Number(v)));

// Dates come as "YYYY-MM-DD" or ISO timestamps; never shifted by timezone.
export function fecha(v) {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MES[Number(m[2]) - 1]} ${m[1]}`;
}
export function fechaHora(v) {
  if (!v) return '—';
  const d = new Date(v);
  return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const mesCorto = (ym) => { const [y, m] = ym.split('-'); return `${MES[Number(m) - 1]} ${y.slice(2)}`; };

export const TIPO = {
  concepto:{label:'Concepto de factura',plural:'Conceptos de facturas',icon:'ri-file-list-line',tercero:'Emisor / receptor',bg:'#E3E7F3',fg:'#3E4D85'},
  material: { label: 'Material', plural: 'Materiales', icon: 'ri-hammer-line', tercero: 'Proveedor', bg: '#E3E7F3', fg: '#3E4D85' },
  trabajador: { label: 'Trabajador', plural: 'Pagos a trabajadores', icon: 'ri-user-settings-line', tercero: 'Trabajador', bg: '#DEF3F0', fg: '#2F6B63' },
  cliente: { label: 'Cliente', plural: 'Pagos de clientes', icon: 'ri-hand-coin-line', tercero: 'Cliente', bg: '#FDF0F4', fg: '#B84371' },
};

export const ESTADO = {
  pendiente: { label: 'Pendiente', bg: '#FBF1DE', fg: '#7A4E0E' },
  asignado: { label: 'Asignado', bg: '#DEF3F0', fg: '#2F6B63' },
  parcial: { label: 'Distribución parcial', bg: '#E3E7F3', fg: '#3E4D85' },
  revision: { label: 'Revisión', bg: '#FBE0EA', fg: '#B84371' },
};

// "1.234,56" or "1234.56" → "1234.56"; null if it is not an amount.
export function parseImporte(s) {
  const t = String(s ?? '').trim().replace(/\s|€/g, '');
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^-?\d+(\.\d{1,2})?$/.test(norm) ? norm : null;
}
