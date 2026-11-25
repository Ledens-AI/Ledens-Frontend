// CIF/NIF of an invoice's client. Spanish DNI, NIE and CIF are checked with
// their control character, so a typo is caught before the invoice is issued
// (an issued invoice is never changed). Anything else (a foreign tax id, an
// EU VAT number such as ESB12345678) only has to look like one.
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';

// Upper case, without spaces, dots, dashes or slashes.
export const normalizeNif = (v) => String(v ?? '').toUpperCase().replace(/[\s.\-/]/g, '');

function cifControl(digits) {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 1) sum += d;
    else { const x = d * 2; sum += Math.floor(x / 10) + (x % 10); }
  }
  return (10 - (sum % 10)) % 10;
}

// null when it is valid, else the reason in Spanish.
export function nifProblem(raw) {
  const v = normalizeNif(raw);
  if (!v) return 'Indica el CIF/NIF del cliente';
  if (!/^[A-Z0-9]{5,20}$/.test(v)) return 'El CIF/NIF solo puede tener letras y números (entre 5 y 20)';
  // DNI (the leading zeros are sometimes left out) and NIE.
  const dni = v.match(/^(\d{1,8})([A-Z])$/);
  if (dni) return DNI_LETTERS[Number(dni[1]) % 23] === dni[2] ? null : 'El NIF no es correcto: la letra no corresponde al número';
  const nie = v.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) return DNI_LETTERS[Number('XYZ'.indexOf(nie[1]) + nie[2]) % 23] === nie[3] ? null : 'El NIE no es correcto: la letra no corresponde al número';
  const cif = v.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (cif) {
    const d = cifControl(cif[2]);
    const ok = /[PQRSNW]/.test(cif[1]) ? cif[3] === CIF_LETTERS[d]
      : /[ABEH]/.test(cif[1]) ? cif[3] === String(d)
        : cif[3] === String(d) || cif[3] === CIF_LETTERS[d];
    return ok ? null : 'El CIF no es correcto: revisa el carácter de control';
  }
  // Nine characters shaped like a Spanish id but not matching any of the above.
  if (/^[A-Z]?\d{7,8}[A-Z0-9]$/.test(v) && v.length === 9 && !/^[A-Z]{2}/.test(v)) return 'El CIF/NIF no tiene un formato válido';
  return null;
}
