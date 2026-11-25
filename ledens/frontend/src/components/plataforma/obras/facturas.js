// Pure helpers of «Generar factura» (Facturas.jsx), tested in test/facturas.test.js.
// The backend (ledens/backend/src/facturas/) checks everything again; these
// only let the dialog say what is wrong before anything is sent.

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';
export const normalizeNif = (v) => String(v ?? '').toUpperCase().replace(/[\s.\-/]/g, '');

// Same rules as the backend's src/facturas/nif.js: null when valid, else why.
export function nifProblem(raw) {
  const v = normalizeNif(raw);
  if (!v) return 'Indica el CIF/NIF del cliente';
  if (!/^[A-Z0-9]{5,20}$/.test(v)) return 'El CIF/NIF solo puede tener letras y números (entre 5 y 20)';
  const dni = v.match(/^(\d{1,8})([A-Z])$/);
  if (dni) return DNI_LETTERS[Number(dni[1]) % 23] === dni[2] ? null : 'El NIF no es correcto: la letra no corresponde al número';
  const nie = v.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) return DNI_LETTERS[Number('XYZ'.indexOf(nie[1]) + nie[2]) % 23] === nie[3] ? null : 'El NIE no es correcto: la letra no corresponde al número';
  const cif = v.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (cif) {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(cif[2][i]);
      if (i % 2 === 1) sum += d;
      else { const x = d * 2; sum += Math.floor(x / 10) + (x % 10); }
    }
    const d = (10 - (sum % 10)) % 10;
    const ok = /[PQRSNW]/.test(cif[1]) ? cif[3] === CIF_LETTERS[d]
      : /[ABEH]/.test(cif[1]) ? cif[3] === String(d)
        : cif[3] === String(d) || cif[3] === CIF_LETTERS[d];
    return ok ? null : 'El CIF no es correcto: revisa el carácter de control';
  }
  if (/^[A-Z]?\d{7,8}[A-Z0-9]$/.test(v) && v.length === 9 && !/^[A-Z]{2}/.test(v)) return 'El CIF/NIF no tiene un formato válido';
  return null;
}

export const CLIENT_FIELDS = [
  { key: 'nombre', label: 'Nombre o razón social', required: true, max: 200, autoComplete: 'organization' },
  { key: 'nif', label: 'CIF/NIF', required: true, max: 20 },
  { key: 'direccion', label: 'Dirección (con código postal y municipio)', required: true, max: 300, autoComplete: 'street-address' },
  { key: 'telefono', label: 'Teléfono', max: 40, type: 'tel', autoComplete: 'tel' },
  { key: 'email', label: 'Email', max: 200, type: 'email', autoComplete: 'email' },
];
const LABEL = { nombre: 'nombre', nif: 'CIF/NIF', direccion: 'dirección' };
export const missingLabels = (keys) => keys.map((k) => LABEL[k] || k);

// What stops the client's data from being used: { field: reason }.
export function clientProblems(c) {
  const out = {};
  for (const f of CLIENT_FIELDS) if (f.required && !String(c[f.key] ?? '').trim()) out[f.key] = 'Obligatorio';
  if (!out.nif) { const p = nifProblem(c.nif); if (p) out.nif = p; }
  if (String(c.email ?? '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.email).trim())) out.email = 'Email no válido';
  return out;
}

// The amounts offered: a share of what is still to be collected (with VAT), in cents.
export const SHARES = [20, 50, 100];
export function suggestions(pendiente) {
  const c = Math.round(Number(pendiente) * 100);
  if (pendiente === null || pendiente === undefined || !Number.isFinite(c) || c <= 0) return [];
  return SHARES.map((pct) => ({ pct, cents: Math.round(c * pct / 100) }));
}

// "1.234,56" / "1234.56" / "1234,5 €" → cents; null when it is not an amount above zero.
export function parseCents(s) {
  const t = String(s ?? '').trim().replace(/\s|€/g, '');
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  const c = Math.round(Number(norm) * 100);
  return c > 0 ? c : null;
}

// Base and VAT from the total with VAT, exactly as the backend does.
export function breakdown(totalCents, ivaPct) {
  const base = Math.round(totalCents / (1 + Number(ivaPct) / 100));
  return { base, iva: totalCents - base, total: totalCents };
}
export const toEuros = (cents) => (cents / 100).toFixed(2);
