import React from 'react';

/* Periodo trabajado of a worker payment: the week, month or year it pays for
 * (backend: FinanzasService.workPeriod, migration 031). Stored as its first day:
 * Monday, 1st of the month or 1 January. Dates are "YYYY-MM-DD", in UTC so they
 * never shift by timezone. */
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const TIPOS_PERIODO = [['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']];

const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const today = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); };

export function periodStart(period, day) {
  const d = toDate(day);
  if (period === 'semana') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (period === 'mes') d.setUTCDate(1);
  else d.setUTCMonth(0, 1);
  return iso(d);
}

/* Suggested period for a payment made on `paidOn`: the week worked is the one
 * before the payment unless it is paid at the end of that same week (workers
 * are usually paid on Friday or Saturday, and the payment may be registered a
 * day or two later). Two days back: Mon/Tue → last week, Wed–Sun → this week. */
export function suggestedPeriod(paidOn) {
  const day = /^\d{4}-\d{2}-\d{2}/.test(paidOn || '') ? String(paidOn).slice(0, 10) : today();
  return { period: 'semana', startsOn: periodStart('semana', addDays(day, -2)) };
}

export function periodText(period, startsOn, { short = false } = {}) {
  if (!period || !startsOn) return '';
  const s = toDate(startsOn);
  if (period === 'anio') return `Año ${s.getUTCFullYear()}`;
  if (period === 'mes') return short ? `${MES[s.getUTCMonth()]} ${s.getUTCFullYear()}` : `${MES_LARGO[s.getUTCMonth()][0].toUpperCase()}${MES_LARGO[s.getUTCMonth()].slice(1)} ${s.getUTCFullYear()}`;
  const e = toDate(addDays(startsOn, 6));
  const from = s.getUTCMonth() === e.getUTCMonth() ? `${s.getUTCDate()}` : `${s.getUTCDate()} ${MES[s.getUTCMonth()]}`;
  return `${short ? '' : 'Semana del '}${from}${short ? '–' : ' al '}${e.getUTCDate()} ${MES[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

// The choices around `ref`: 16 weeks back and 3 ahead, 12 months back and 1
// ahead, 3 years back and 1 ahead. The current value is always among them.
function options(period, ref, current) {
  const out = [];
  if (period === 'semana') { const s = periodStart('semana', ref); for (let i = 3; i >= -16; i--) out.push(addDays(s, 7 * i)); }
  else if (period === 'mes') { const d = toDate(periodStart('mes', ref)); for (let i = 1; i >= -12; i--) out.push(iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)))); }
  else { const y = toDate(ref).getUTCFullYear(); for (let i = 1; i >= -3; i--) out.push(`${y + i}-01-01`); }
  if (current && !out.includes(current)) { out.push(current); out.sort().reverse(); }
  return out;
}

/* Two selects: kind (Semana / Mes / Año) and which one. `value` is
 * { period, startsOn } or null; `refDate` centres the list (the payment date). */
export default function PeriodoTrabajo({ value, onChange, refDate, disabled, label = 'Periodo trabajado', allowEmpty = false }) {
  const ref = /^\d{4}-\d{2}-\d{2}/.test(refDate || '') ? String(refDate).slice(0, 10) : today();
  const period = value?.period || '';
  const current = value?.startsOn || '';
  const setKind = (k) => {
    if (!k) { onChange(null); return; }
    onChange({ period: k, startsOn: periodStart(k, current || suggestedPeriod(ref).startsOn) });
  };
  return (
    <span className="fin-periodo">
      <select value={period} onChange={(e) => setKind(e.target.value)} aria-label={`${label}: tipo`} disabled={disabled}>
        {allowEmpty || !period ? <option value="">{allowEmpty ? 'Sin indicar' : 'Tipo…'}</option> : null}
        {TIPOS_PERIODO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {period ? (
        <select value={current} onChange={(e) => onChange({ period, startsOn: e.target.value })} aria-label={label} disabled={disabled}>
          {options(period, ref, current).map((s) => <option key={s} value={s}>{periodText(period, s, { short: true })}</option>)}
        </select>
      ) : null}
    </span>
  );
}
