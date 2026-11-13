// CIF / NIF / NIE of the titular of a project's invoices. Spanish identifiers are
// checked with their control character (a typo is caught before it reaches an
// invoice); anything else is accepted only as a foreign tax id with its country
// prefix (EU VAT number such as DE123456789 or FR12345678901).
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function normalizeTaxId(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
}

function dniLetter(digits) { return DNI_LETTERS[Number(digits) % 23]; }

function validCif(v) {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v);
  if (!m) return false;
  const d = m[2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    let n = Number(d[i]);
    if (i % 2 === 0) { n *= 2; n = Math.floor(n / 10) + (n % 10); }
    sum += n;
  }
  const c = (10 - (sum % 10)) % 10, letter = 'JABCDEFGHI'[c];
  if ('PQRSNW'.includes(m[1])) return m[3] === letter;
  if ('ABEH'.includes(m[1])) return m[3] === String(c);
  return m[3] === String(c) || m[3] === letter;
}

// { value, kind: 'NIF'|'NIE'|'CIF'|'extranjero' } or null when it is not valid.
export function parseTaxId(raw) {
  let v = normalizeTaxId(raw);
  if (/^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(v)) v = v.slice(2);
  let m;
  if ((m = /^(\d{8})([A-Z])$/.exec(v))) return m[2] === dniLetter(m[1]) ? { value: v, kind: 'NIF' } : null;
  if ((m = /^([KLM])(\d{7})([A-Z])$/.exec(v))) return m[3] === dniLetter(m[2]) ? { value: v, kind: 'NIF' } : null;
  if ((m = /^([XYZ])(\d{7})([A-Z])$/.exec(v))) return m[3] === dniLetter('XYZ'.indexOf(m[1]) + m[2]) ? { value: v, kind: 'NIE' } : null;
  if (/^[A-Z]\d{7}[0-9A-Z]$/.test(v)) return validCif(v) ? { value: v, kind: 'CIF' } : null;
  if (/^[A-Z]{2}[A-Z0-9]{2,18}$/.test(v) && /\d/.test(v) && !v.startsWith('ES')) return { value: v, kind: 'extranjero' };
  return null;
}
