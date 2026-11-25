import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { eur, num, fecha, TIPO } from './format.js';
import { barPath, niceTicks, compactEur, periodLabel } from './PagosTrabajadoresChart.jsx';
import RecordDrawer from './RecordDrawer.jsx';
import { Kpi, Badge, Empty, ErrorBox, Pager } from './ui.jsx';

// Kind of cost, in fixed order with its fixed colour (first slots of the
// validated palette, as in Pagos a trabajadores): a filter never repaints them.
const CLASES = [
  { key: 'materiales', label: 'Materiales', color: '#2a78d6' },
  { key: 'trabajadores', label: 'Mano de obra', color: '#eb6834' },
  { key: 'otros', label: 'Otros costes', color: '#1baf7a' },
];
const TIPOS = [['', 'Todos los gastos'], ...CLASES.map((c) => [c.key, c.label])];
const CONTABLE = { approved: { label: 'Validado', bg: '#DEF3F0', fg: '#2F6B63' }, pending: { label: 'Sin validar', bg: '#FBF1DE', fg: '#7A4E0E' } };
const EMPTY_FILTERS = { proyecto: '', tipo: '', desde: '', hasta: '', q: '' };
const SIN_FECHA = 'sin-fecha';
const MAX_MONTHS = 240;

const monthLabel = (m, long) => (m === SIN_FECHA ? 'Sin fecha' : periodLabel(m + '-01', 'mes', long));

// Every month between the first and the last one with expenses, so a month
// without expenses shows as a gap instead of disappearing.
function monthRange(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while ((y < ly || (y === ly && m <= lm)) && out.length < MAX_MONTHS) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/* Gastos operacionales (admins): what the company spends on running itself,
 * outside the obras. Those costs are imputed to a project of its own named
 * «Gastos operacionales» / «Gastos operativos»; the chart shows them month by
 * month (by kind of cost) and the table the records behind them. Clicking a
 * month filters the table to it; clicking it again shows every month. */
export default function GastosOperacionales({ version, toast, go }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftQ, setDraftQ] = useState('');
  const [mes, setMes] = useState('');
  const [sort, setSort] = useState({ by: 'fecha', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(null);

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const pickMonth = (m) => { setMes((cur) => (cur === m ? '' : m)); setPage(1); };
  useEffect(() => { const t = setTimeout(() => { if (draftQ !== filters.q) setF({ q: draftQ }); }, 300); return () => clearTimeout(t); }, [draftQ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.operatingExpenses({ ...filters, mes, orden: sort.by, dir: sort.dir, pagina: page, tam: 25 }).then(
      (d) => { if (!cancelled) { setData(d); setError(''); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [filters, mes, sort, page, reload, version]);

  // A month the new filters leave empty is no longer offered: show every month.
  useEffect(() => {
    if (data && mes && mes !== SIN_FECHA && !data.meses.some((m) => m.mes === mes)) setMes('');
    if (data && mes === SIN_FECHA && !data.sinFecha.movimientos) setMes('');
  }, [data, mes]);

  const months = useMemo(() => {
    const rows = data?.meses || [];
    if (!rows.length) return [];
    const byMonth = new Map(rows.map((r) => [r.mes, r]));
    return monthRange(rows[0].mes, rows[rows.length - 1].mes).map((m) => byMonth.get(m) || { mes: m, total: '0', materiales: '0', trabajadores: '0', otros: '0', movimientos: 0 });
  }, [data]);

  if (error && !data) return <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!data) return <div className="fin-loading">Cargando…</div>;
  if (!data.proyectos.length) {
    return (
      <div className="fin-card">
        <Empty icon="ri-briefcase-4-line" title="No hay ningún proyecto de gastos operacionales"
          text="Crea en «Proyectos» un proyecto llamado «Gastos operacionales» (o «Gastos operativos») e imputa a él los materiales y pagos a trabajadores que no son de ninguna obra.">
          {go ? <button type="button" className="fin-btn" onClick={() => go('proyectos')}>Ir a Proyectos</button> : null}
        </Empty>
      </div>
    );
  }

  const t = data.totales;
  const dated = Number(t.total) - Number(data.sinFecha.total);
  const media = months.length ? dated / months.length : 0;
  const selected = mes ? (mes === SIN_FECHA ? { mes, ...data.sinFecha } : months.find((m) => m.mes === mes)) : null;
  const last = months[months.length - 1];
  const several = data.proyectos.length > 1;
  const hasFilters = Object.entries(filters).some(([k, v]) => v && v !== EMPTY_FILTERS[k]);
  const th = (label, by, cls) => (
    <th className={cls} aria-sort={sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {by ? (
        <button type="button" className="fin-sort" onClick={() => { setSort((s) => ({ by, dir: s.by === by && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(1); }}>
          {label}<i className={sort.by === by ? (sort.dir === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-expand-up-down-line'} aria-hidden="true"></i>
        </button>
      ) : label}
    </th>
  );

  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        {several ? (
          <label className="fin-field">
            <span>Proyecto</span>
            <select value={filters.proyecto} onChange={(e) => setF({ proyecto: e.target.value })}>
              <option value="">Todos los de gastos operacionales</option>
              {data.proyectos.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.label}` : p.label}</option>)}
            </select>
          </label>
        ) : null}
        <label className="fin-field">
          <span>Tipo de gasto</span>
          <select value={filters.tipo} onChange={(e) => setF({ tipo: e.target.value })}>
            {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="fin-field"><span>Desde</span><input type="date" value={filters.desde} onChange={(e) => setF({ desde: e.target.value })} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={filters.hasta} onChange={(e) => setF({ hasta: e.target.value })} /></label>
        <label className="fin-field fin-grow">
          <span>Buscar</span>
          <input type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Proveedor, trabajador, concepto o nº de factura" />
        </label>
        {hasFilters ? <button type="button" className="fin-btn is-ghost fin-self-end" onClick={() => { setDraftQ(''); setF({ ...EMPTY_FILTERS }); }}>Limpiar filtros</button> : null}
      </div>

      {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}

      <div className="fin-kpis">
        <Kpi label="Gasto operacional" value={eur(t.total)} icon="ri-briefcase-4-line"
          hint={months.length ? `${monthLabel(months[0].mes, true)} – ${monthLabel(last.mes, true)}` : undefined} />
        <Kpi label="Media mensual" value={months.length ? eur(media) : '—'} icon="ri-calendar-2-line"
          hint={months.length ? `Sobre ${months.length} ${months.length === 1 ? 'mes' : 'meses'}` : undefined} />
        {selected
          ? <Kpi label={`Gasto de ${monthLabel(selected.mes, true)}`} value={eur(selected.total)} icon="ri-focus-3-line" active onClick={() => pickMonth(selected.mes)} hint="Pulsa para ver todos los meses" />
          : <Kpi label={last ? `Último mes (${monthLabel(last.mes, true)})` : 'Último mes'} value={last ? eur(last.total) : '—'} icon="ri-calendar-event-line" />}
        <Kpi label="Movimientos" value={num(t.movimientos)} icon="ri-list-check-2" />
      </div>

      <div className="fin-card">
        <div className="fin-card-head"><h2>Gasto operacional por mes</h2></div>
        <MonthChart months={months} selected={mes} onSelect={pickMonth} />
        {data.sinFecha.movimientos ? (
          <p className="fin-muted fin-small">
            {`${num(data.sinFecha.movimientos)} ${data.sinFecha.movimientos === 1 ? 'movimiento sin fecha' : 'movimientos sin fecha'} (${eur(data.sinFecha.total)}) no aparecen en el gráfico. `}
            <button type="button" className="fin-link" onClick={() => pickMonth(SIN_FECHA)}>{mes === SIN_FECHA ? 'Ver todos los meses' : 'Ver cuáles son'}</button>
          </p>
        ) : null}
      </div>

      <div className="fin-card is-flush">
        <div className="fin-card-head fin-pad">
          <h2>{mes === SIN_FECHA ? 'Movimientos sin fecha' : mes ? `Movimientos de ${monthLabel(mes, true)}` : 'Todos los movimientos'}</h2>
          {mes ? <button type="button" className="fin-btn is-ghost" onClick={() => pickMonth(mes)}><i className="ri-close-line" aria-hidden="true"></i> Ver todos los meses</button> : null}
        </div>
        <div className="fin-table-wrap" aria-busy={loading}>
          <table className="fin-table">
            <thead>
              <tr>
                {th('Fecha', 'fecha')}
                <th>Tipo</th>
                <th>Nº de documento</th>
                {th('Tercero', 'tercero')}
                {th('Concepto', 'concepto')}
                {several && !filters.proyecto ? th('Proyecto', 'proyecto') : null}
                {th('Importe', 'importe', 'fin-num')}
                <th>Validación</th>
                <th><span className="fin-sr">Detalle</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const tipo = TIPO[r.type] || TIPO.concepto;
                const clase = CLASES.find((c) => c.key === r.clase);
                return (
                  <tr key={`${r.type}:${r.id}:${r.project_id}`}>
                    <td className="fin-nowrap">{fecha(r.fecha)}</td>
                    <td className="fin-nowrap"><Badge bg={tipo.bg} fg={tipo.fg} icon={tipo.icon}>{tipo.label}</Badge>
                      {clase ? <div className="fin-muted fin-small fin-opex-kind"><i style={{ background: clase.color }} aria-hidden="true"></i>{clase.label}</div> : null}</td>
                    <td className="fin-nowrap">{r.numerodocumento || (r.document_id ? 'Sin número' : <span className="fin-muted">Sin documento</span>)}
                      {r.line_number && r.line_number < 10000 ? <div className="fin-muted">Línea {r.line_number}</div> : null}</td>
                    <td className="fin-ellipsis" title={r.tercero || ''}>{r.tercero || <span className="fin-muted">—</span>}</td>
                    <td className="fin-ellipsis is-wide" title={r.concepto || ''}>{r.concepto || <span className="fin-muted">—</span>}</td>
                    {several && !filters.proyecto ? (
                      <td className="fin-col-project">{r.project_label}{r.project_code ? <div className="fin-muted">{r.project_code}</div> : null}</td>
                    ) : null}
                    <td className="fin-num fin-nowrap"><strong>{eur(r.gasto)}</strong>
                      {Number(r.gasto) !== Number(r.importe) ? <div className="fin-muted fin-small">{`Parte de ${eur(r.importe)}`}</div> : null}</td>
                    <td><Badge {...(CONTABLE[r.accounting_status] || CONTABLE.pending)}>{(CONTABLE[r.accounting_status] || CONTABLE.pending).label}</Badge></td>
                    <td><button type="button" className="fin-iconbtn" aria-label="Ver detalle" title="Ver detalle" onClick={() => setOpen(r)}><i className="ri-side-bar-line"></i></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !data.rows.length ? (
            hasFilters || mes
              ? <Empty icon="ri-search-line" title="Ningún movimiento coincide" text="Prueba con otros filtros u otro mes." />
              : <Empty icon="ri-folder-open-line" title="Todavía no hay gastos operacionales"
                text={`Imputa a ${several ? 'un proyecto de gastos operacionales' : `«${data.proyectos[0].label}»`} los materiales y pagos a trabajadores que no son de ninguna obra para verlos aquí.`} />
          ) : null}
        </div>
        {data.total > 0 ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage}
          extra={selected ? `Gasto de ${monthLabel(selected.mes, true)}: ${eur(selected.total)}` : `Total: ${eur(t.total)}`} /> : null}
      </div>

      {open ? (
        <RecordDrawer type={open.type} id={open.id} onClose={() => setOpen(null)} toast={toast}
          onSaved={() => setReload((n) => n + 1)} />
      ) : null}
    </div>
  );
}

/* One bar per month (x), what was spent (y), stacked by kind of cost.
 * Positive amounts stack up from the baseline; a negative one (a supplier
 * refund bigger than the month's purchases) hangs below it. Hovering a month
 * shows its breakdown; clicking it selects it (the others dim). */
function MonthChart({ months, selected, onSelect }) {
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

  const present = useMemo(() => CLASES.filter((c) => months.some((m) => Number(m[c.key]))), [months]);
  if (!months.length) return <Empty icon="ri-bar-chart-line" title="Sin gastos" text="Ningún gasto operacional coincide con estos filtros." />;

  const ups = months.map((m) => present.reduce((a, c) => a + Math.max(0, Number(m[c.key])), 0));
  const downs = months.map((m) => present.reduce((a, c) => a + Math.min(0, Number(m[c.key])), 0));
  const H = 320, top = 22, bottom = 56, left = 76, right = 12;
  const slot = Math.max(30, (width - left - right) / months.length);
  const W = Math.max(width, left + right + slot * months.length);
  const ticks = niceTicks(Math.min(0, ...downs), Math.max(0, ...ups));
  const max = ticks[ticks.length - 1], min = ticks[0];
  const y = (v) => top + ((max - v) / (max - min || 1)) * (H - top - bottom);
  const zero = y(0);
  const barW = Math.min(44, slot * 0.7);
  const GAP = 2;
  // Show every n-th month label so they never overlap.
  const every = Math.max(1, Math.ceil(52 / slot));
  const focus = hover ?? (selected ? months.findIndex((m) => m.mes === selected) : -1);
  const info = focus >= 0 ? months[focus] : null;

  return (
    <div className="fin-rent-chart" ref={wrapRef}>
      <div className="fin-rent-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gasto operacional por mes, barras apiladas por tipo de gasto">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#BDBDB8' : '#EFEFEC'} />
              <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6B6B68">{compactEur(v)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = left + slot * (i + 0.5), x = cx - barW / 2;
            const isSel = selected === m.mes, dim = selected && !isSel;
            const pos = present.filter((c) => Number(m[c.key]) > 0), neg = present.filter((c) => Number(m[c.key]) < 0);
            let acc = 0;
            const upMarks = pos.map((c, j) => {
              const v = Number(m[c.key]), y0 = y(acc), y1 = y(acc + v);
              acc += v;
              const h = Math.max(1, y0 - y1 - (j > 0 ? GAP : 0));
              return <path key={c.key} d={barPath(x, y0 - (j > 0 ? GAP : 0) - h, barW, h, j === pos.length - 1)} fill={c.color} />;
            });
            acc = 0;
            const downMarks = neg.map((c, j) => {
              const v = Number(m[c.key]), y0 = y(acc), y1 = y(acc + v);
              acc += v;
              const h = Math.max(1, y1 - y0 - (j > 0 ? GAP : 0));
              return <path key={c.key} d={barPath(x, y0 + (j > 0 ? GAP : 0), barW, h, j === neg.length - 1, true)} fill={c.color} />;
            });
            const total = Number(m.total);
            return (
              <g key={m.mes} className="fin-rent-bar" onClick={() => onSelect(m.mes)}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                tabIndex={0} role="button" aria-pressed={isSel} aria-label={`${monthLabel(m.mes, true)}: ${eur(total)}, ${m.movimientos} ${m.movimientos === 1 ? 'movimiento' : 'movimientos'}`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m.mes); } }}>
                <rect x={cx - slot / 2} y={top} width={slot} height={H - top - bottom} fill={hover === i ? '#F4F4F1' : 'transparent'} />
                <g opacity={dim ? 0.3 : 1}>{upMarks}{downMarks}</g>
                {(isSel || hover === i) && total ? (
                  <text x={cx} y={y(ups[i]) - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1F1F1D">{compactEur(total)}</text>
                ) : null}
                {i % every === 0 || isSel || hover === i ? (
                  <text x={cx} y={H - bottom + 14} fontSize="11" fill={isSel || hover === i ? '#1F1F1D' : '#6B6B68'} fontWeight={isSel || hover === i ? 700 : 400}
                    textAnchor="end" transform={`rotate(-35 ${cx} ${H - bottom + 14})`}>{monthLabel(m.mes)}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {info ? (
        <div className="fin-rent-tip" role="status">
          <strong>{monthLabel(info.mes, true)}</strong><span className="fin-muted">{` · Total ${eur(info.total)} · ${num(info.movimientos)} ${info.movimientos === 1 ? 'movimiento' : 'movimientos'}`}</span>
          <div className="fin-wk-tip">
            {present.filter((c) => Number(info[c.key])).map((c) => <span key={c.key}><i style={{ background: c.color }}></i>{c.label} <b>{eur(info[c.key])}</b></span>)}
            {!info.movimientos ? <span className="fin-muted">Sin gastos este mes.</span> : null}
          </div>
        </div>
      ) : <div className="fin-rent-tip is-hint fin-muted">Pasa el ratón por un mes para ver su desglose; púlsalo para ver sus movimientos en la tabla.</div>}
      {present.length > 1 ? (
        <div className="fin-legend">{present.map((c) => <span key={c.key}><i style={{ background: c.color }}></i>{c.label}</span>)}</div>
      ) : null}
    </div>
  );
}
