import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eur, num } from './format.js';
import { Empty } from './ui.jsx';

// Categorical slots in fixed order (validated palette). A worker keeps its
// colour whatever the filters: it follows the worker's place in the list of
// everyone ever paid, never its rank in the current view. With more than eight
// workers the ninth onwards share «Otros trabajadores» (neutral grey).
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER = '#9A9A95';
const OTHER_KEY = '\u0000otros';
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MAX_PERIODS = 400;

export const workerName = (n) => n || 'Sin trabajador';

/* Colour and legend entry of every worker: the first seven (or all eight if
 * there are no more) get their own slot; the rest fold into «Otros». */
export function workerColors(trabajadores) {
  const own = trabajadores.length <= SLOTS.length ? SLOTS.length : SLOTS.length - 1;
  const map = new Map();
  trabajadores.forEach((t, i) => map.set(t.nombre, i < own ? { key: t.nombre, label: workerName(t.nombre), color: SLOTS[i], order: i } : { key: OTHER_KEY, label: 'Otros trabajadores', color: OTHER, order: own }));
  return map;
}

// Every period between the first and the last one with payments, so a week
// without payments shows as a gap instead of disappearing.
function periodRange(first, last, periodo) {
  const out = [];
  const d = new Date(first + 'T00:00:00Z'), end = new Date(last + 'T00:00:00Z');
  while (d <= end && out.length < MAX_PERIODS) {
    out.push(d.toISOString().slice(0, 10));
    if (periodo === 'semana') d.setUTCDate(d.getUTCDate() + 7);
    else if (periodo === 'mes') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return out;
}

export function periodLabel(p, periodo, long) {
  const [y, m, d] = p.split('-').map(Number);
  if (periodo === 'anio') return String(y);
  if (periodo === 'mes') return `${MES[m - 1]} ${long ? y : String(y).slice(2)}`;
  if (!long) return `${d} ${MES[m - 1]} ${String(y).slice(2)}`;
  const e = new Date(Date.UTC(y, m - 1, d + 6));
  return `Semana del ${d} ${MES[m - 1]} al ${e.getUTCDate()} ${MES[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
}

/* Pagos a trabajadores: x = week / month / year, y = what was paid. Stacked:
 * one bar per period split by worker. Grouped: one bar per worker side by
 * side in each period. Hovering a period lists what each worker got. */
export default function PagosTrabajadoresChart({ data, layout }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    const colors = workerColors(data.trabajadores);
    const periodo = data.periodo;
    const rows = data.series.filter((r) => Number(r.importe));
    if (!rows.length) return null;
    const periods = periodRange(rows[0].periodo, rows[rows.length - 1].periodo, periodo);
    // period → Map(seriesKey → { importe, pagos, workers: [{name, importe}] })
    const cells = new Map(periods.map((p) => [p, new Map()]));
    const used = new Map();
    for (const r of rows) {
      const c = colors.get(r.trabajador) || { key: OTHER_KEY, label: 'Otros trabajadores', color: OTHER, order: SLOTS.length };
      used.set(c.key, c);
      const per = cells.get(r.periodo);
      if (!per) continue;
      const cur = per.get(c.key) || { importe: 0, pagos: 0, workers: [] };
      cur.importe += Number(r.importe); cur.pagos += r.pagos; cur.workers.push({ name: workerName(r.trabajador), importe: Number(r.importe) });
      per.set(c.key, cur);
    }
    const series = [...used.values()].sort((a, b) => a.order - b.order);
    return { periods, cells, series, periodo, truncated: periods.length >= MAX_PERIODS };
  }, [data]);

  if (!model) return <Empty icon="ri-bar-chart-grouped-line" title="Sin pagos a trabajadores" text="Ningún pago coincide con estos filtros." />;
  const { periods, cells, series, periodo } = model;
  const stacked = layout !== 'agrupadas';

  const totals = periods.map((p) => [...cells.get(p).values()].reduce((a, c) => a + c.importe, 0));
  const hi = Math.max(0, ...(stacked ? totals : periods.flatMap((p) => [...cells.get(p).values()].map((c) => c.importe))));
  const lo = Math.min(0, ...(stacked ? [] : periods.flatMap((p) => [...cells.get(p).values()].map((c) => c.importe))));
  const H = 320, top = 16, bottom = 64, left = 76, right = 12;
  const minSlot = stacked ? 26 : Math.max(26, series.length * 9 + 8);
  const slot = Math.max(minSlot, (width - left - right) / periods.length);
  const W = Math.max(width, left + right + slot * periods.length);
  const ticks = niceTicks(lo, hi);
  const max = Math.max(hi, ticks[ticks.length - 1]), min = Math.min(lo, ticks[0]);
  const y = (v) => top + ((max - v) / (max - min || 1)) * (H - top - bottom);
  const zero = y(0);
  // Show every n-th period label so they never overlap.
  const every = Math.max(1, Math.ceil(56 / slot));

  const groupW = Math.min(stacked ? 44 : series.length * 26, slot * 0.78);
  const barW = stacked ? groupW : Math.max(4, (groupW - 2 * (series.length - 1)) / series.length);
  const GAP = 2;

  return (
    <div className="fin-rent-chart" ref={wrapRef}>
      <div className="fin-rent-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Pagos a trabajadores por ${periodo === 'anio' ? 'año' : periodo}, ${stacked ? 'barras apiladas' : 'barras agrupadas'} por trabajador`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#BDBDB8' : '#EFEFEC'} />
              <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6B6B68">{compactEur(v)}</text>
            </g>
          ))}
          {periods.map((p, i) => {
            const cx = left + slot * (i + 0.5);
            const per = cells.get(p);
            const isHover = hover === i;
            let marks;
            if (stacked) {
              // Positive segments stack upwards from the baseline, biggest worker
              // order first; a 2px surface gap separates them.
              let acc = 0;
              const present = series.filter((s) => per.get(s.key)?.importe > 0);
              marks = present.map((s, j) => {
                const v = per.get(s.key).importe;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const isTop = j === present.length - 1;
                const h = Math.max(1, y0 - y1 - (j > 0 ? GAP : 0));
                return <path key={s.key} d={barPath(cx - barW / 2, y0 - (j > 0 ? GAP : 0) - h, barW, h, isTop)} fill={s.color} />;
              });
            } else {
              const x0 = cx - groupW / 2;
              marks = series.map((s, j) => {
                const v = per.get(s.key)?.importe;
                if (!v) return null;
                const h = Math.max(1, Math.abs(y(v) - zero));
                const x = x0 + j * (barW + GAP);
                return <path key={s.key} d={v > 0 ? barPath(x, zero - h, barW, h, true) : barPath(x, zero, barW, h, false, true)} fill={s.color} />;
              });
            }
            return (
              <g key={p} className="fin-rent-bar" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                aria-label={`${periodLabel(p, periodo, true)}: ${eur(totals[i])}`}>
                <rect x={cx - slot / 2} y={top} width={slot} height={H - top - bottom} fill={isHover ? '#F4F4F1' : 'transparent'} />
                {marks}
                {isHover && totals[i] ? (
                  <text x={cx} y={stacked ? y(totals[i]) - 6 : top + 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1F1F1D">{compactEur(totals[i])}</text>
                ) : null}
                {i % every === 0 || isHover ? (
                  <text x={cx} y={H - bottom + 14} fontSize="11" fill={isHover ? '#1F1F1D' : '#6B6B68'} fontWeight={isHover ? 700 : 400}
                    textAnchor="end" transform={`rotate(-35 ${cx} ${H - bottom + 14})`}>{periodLabel(p, periodo)}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {hover !== null && periods[hover] ? (
        <div className="fin-rent-tip" role="status">
          <strong>{periodLabel(periods[hover], periodo, true)}</strong><span className="fin-muted">{` · Total ${eur(totals[hover])}`}</span>
          <div className="fin-wk-tip">
            {series.flatMap((s) => {
              const c = cells.get(periods[hover]).get(s.key);
              if (!c) return [];
              const people = s.key === OTHER_KEY ? c.workers : [{ name: s.label, importe: c.importe }];
              return people.map((w) => (
                <span key={s.key + w.name}><i style={{ background: s.color }}></i>{w.name} <b>{eur(w.importe)}</b>{s.key !== OTHER_KEY ? <span className="fin-muted">{` · ${num(c.pagos)} ${c.pagos === 1 ? 'pago' : 'pagos'}`}</span> : null}</span>
              ));
            })}
            {![...cells.get(periods[hover]).values()].length ? <span className="fin-muted">Sin pagos en este periodo.</span> : null}
          </div>
        </div>
      ) : <div className="fin-rent-tip is-hint fin-muted">Pasa el ratón por un periodo para ver lo pagado a cada trabajador.</div>}
      <div className="fin-legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }}></i>{s.label}</span>)}
      </div>
      {model.truncated ? <div className="fin-muted fin-small">Se muestran los primeros {MAX_PERIODS} periodos; acota las fechas o agrupa por mes o año.</div> : null}
    </div>
  );
}

// A bar with 4px rounded corners on its data end (only when `round`), square on the baseline.
function barPath(x, yTop, w, h, round, down) {
  const r = round ? Math.min(4, w / 2, h) : 0;
  if (!down) return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
  const b = yTop + h;
  return `M${x},${yTop}V${b - r}Q${x},${b} ${x + r},${b}H${x + w - r}Q${x + w},${b} ${x + w},${b - r}V${yTop}Z`;
}

function niceTicks(lo, hi) {
  const span = hi - lo || 1;
  const raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) out.push(Math.round(v * 100) / 100 || 0);
  if (!out.includes(0)) out.push(0);
  return out.sort((a, b) => a - b);
}

const CEUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
const compactEur = (v) => CEUR.format(v || 0);
