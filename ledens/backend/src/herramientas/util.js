// Validation helpers and the error type shared by the Ledens Tools modules.
export class ToolError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const fail = (status, message, extra) => { throw new ToolError(status, message, extra); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export const uuid = (v, field, { required = true } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) fail(400, `Falta ${field}`); return null; }
  if (!isUuid(v)) fail(400, `${field} no válido`);
  return v;
};
export const text = (v, field, { max = 500, required = false } = {}) => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) { if (required) fail(400, `Falta ${field}`); return null; }
  if (typeof v !== 'string') fail(400, `${field} no válido`);
  const t = v.trim();
  if (t.length > max) fail(400, `${field}: máximo ${max} caracteres`);
  return t;
};
export const day = (v, field, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) fail(400, `Falta ${field}`); return null; }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) fail(400, `${field} no válida`);
  return v;
};
export const money = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const s = typeof v === 'number' ? String(v) : String(v).trim().replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) fail(400, `${field} no válido`);
  return s;
};
export const int = (v, field, { min = 0, max = 100000 } = {}) => {
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${field} no válido`);
  return n;
};
export const today = () => new Date().toISOString().slice(0, 10);

