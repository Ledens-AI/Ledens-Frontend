import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { eur, num, fecha, TIPO } from './format.js';
import ProjectPicker from './ProjectPicker.jsx';
import RecordDrawer from './RecordDrawer.jsx';
import { Kpi, Badge, Empty, ErrorBox, Pager } from './ui.jsx';

// Polarity of a project's result: two poles, never the reserved status colours.
const POS = '#3E8C82';
const NEG = '#C9507E';
const EMPTY_FILTERS = { proyecto: null, tipo: '', contable: '', desde: '', hasta: '', q: '' };
const TIPOS = [['', 'Ingresos y costes'], ['ingresos', 'Solo ingresos'], ['materiales', 'Materiales'], ['trabajadores', 'Mano de obra'], ['otros', 'Otros costes']];
const CONTABLE = { approved: { label: 'Validado', bg: '#DEF3F0', fg: '#2F6B63' }, pending: { label: 'Sin validar', bg: '#FBF1DE', fg: '#7A4E0E' } };

/* Rentabilidad por proyecto: ingresos − costes of every project (bar chart),
 * computed from the movements assigned to each one, and those movements below.
 * Every assigned movement counts, validated or not, so the screen does not wait
 * for classification or accounting validation. Clicking a bar filters the table
 * to that project. */
export default function Rentabilidad({ project, onProject, version, toast }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, proyecto: project || null });
  const [draftQ, setDraftQ] = useState('');
  const [sort, setSort] = useState({ by: 'fecha', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(null);

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const setProject = (p) => { setF({ proyecto: p }); onProject?.(p); };
  useEffect(() => { const t = setTimeout(() => { if (draftQ !== filters.q) setF({ q: draftQ }); }, 300); return () => clearTimeout(t); }, [draftQ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.projectResults({
      proyecto: filters.proyecto?.id, tipo: filters.tipo, contable: filters.contable, desde: filters.desde, hasta: filters.hasta, q: filters.q,
      orden: sort.by, dir: sort.dir, pagina: page, tam: 25,
    }).then(
      (d) => { if (!cancelled) { setData(d); setError(''); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [filters, sort, page, reload, version]);

  const hasFilters = Object.entries(filters).some(([k, v]) => v && v !== EMPTY_FILTERS[k]);
  const t = data?.totales;
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
        <div className="fin-field fin-w-picker">
          <span>Proyecto</span>
          <div className="fin-rent-picker">
            <ProjectPicker value={filters.proyecto} onChange={setProject} placeholder="Todos los proyectos" label="Filtrar por proyecto" />
            {filters.proyecto ? <button type="button" className="fin-iconbtn" aria-label="Quitar el proyecto" title="Ver todos los proyectos" onClick={() => setProject(null)}><i className="ri-close-line"></i></button> : null}
          </div>
        </div>
        <label className="fin-field">
          <span>Tipo</span>
          <select value={filters.tipo} onChange={(e) => setF({ tipo: e.target.value })}>
            {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="fin-field">
          <span>Validación contable</span>
          <select value={filters.contable} onChange={(e) => setF({ contable: e.target.value })}>
            <option value="">Todos</option>
            <option value="aprobado">Validados</option>
            <option value="pendiente">Sin validar</option>
          </select>
        </label>
        <label className="fin-field"><span>Desde</span><input type="date" value={filters.desde} onChange={(e) => setF({ desde: e.target.value })} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={filters.hasta} onChange={(e) => setF({ hasta: e.target.value })} /></label>
        <label className="fin-field fin-grow">
          <span>Buscar</span>
          <input type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Proveedor, trabajador, cliente, concepto o nº de factura" />
        </label>
        {hasFilters ? <button type="button" className="fin-btn is-ghost fin-self-end" onClick={() => { setDraftQ(''); setProject(null); setF({ ...EMPTY_FILTERS }); }}>Limpiar filtros</button> : null}
      </div>

      {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}

      {t ? (
        <div className="fin-kpis">
          <Kpi label={filters.proyecto ? 'Ingresos del proyecto' : 'Ingresos'} value={eur(t.ingresos)} icon="ri-hand-coin-line" />
          <Kpi label={filters.proyecto ? 'Costes del proyecto' : 'Costes'} value={eur(t.costes)} icon="ri-hammer-line" />
          <Kpi label="Resultado (ingresos − costes)" value={eur(t.resultado)} icon="ri-scales-line" tone={Number(t.resultado) < 0 ? 'bad' : undefined}
            hint={Number(t.ingresos) ? `Margen ${num((Number(t.resultado) / Number(t.ingresos)) * 100)} %` : undefined} />
          <Kpi label="Movimientos asignados" value={num(t.movimientos)} icon="ri-list-check-2" />
        </div>
      ) : null}

      <div className="fin-card">
        <div className="fin-card-head"><h2>Resultado por proyecto</h2></div>
        {!data && loading ? <div className="fin-loading">Calculando…</div> : null}
        {data ? <ResultChart rows={data.proyectos} selected={filters.proyecto?.id} onSelect={(p) => setProject(filters.proyecto?.id === p.id ? null : p)} /> : null}
      </div>

      <div className="fin-card is-flush">
        <div className="fin-card-head fin-pad"><h2>{filters.proyecto ? `Movimientos asignados a ${filters.proyecto.label}` : 'Movimientos asignados a proyectos'}</h2></div>
        <div className="fin-table-wrap" aria-busy={loading}>
          <table className="fin-table">
            <thead>
              <tr>
                {th('Fecha', 'fecha')}
                <th>Tipo</th>
                <th>Nº de documento</th>
                {th('Tercero', 'tercero')}
                {th('Concepto', 'concepto')}
                {filters.proyecto ? null : th('Proyecto', 'proyecto')}
                {th('Importe (+ ingreso / − coste)', 'importe', 'fin-num')}
                <th>Validación</th>
                <th><span className="fin-sr">Detalle</span></th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => {
                const tipo = TIPO[r.type] || TIPO.concepto;
                return (
                  <tr key={`${r.type}:${r.id}:${r.project_id}`}>
                    <td className="fin-nowrap">{fecha(r.fecha)}</td>
                    <td className="fin-nowrap"><Badge bg={tipo.bg} fg={tipo.fg} icon={tipo.icon}>{r.ingreso ? 'Ingreso' : tipo.label}</Badge></td>
                    <td className="fin-nowrap">{r.numerodocumento || (r.document_id ? 'Sin número' : <span className="fin-muted">Sin documento</span>)}
                      {r.line_number && r.line_number < 10000 ? <div className="fin-muted">Línea {r.line_number}</div> : null}</td>
                    <td className="fin-ellipsis" title={r.tercero || ''}>{r.tercero || <span className="fin-muted">—</span>}</td>
                    <td className="fin-ellipsis is-wide" title={r.concepto || ''}>{r.concepto || <span className="fin-muted">—</span>}</td>
                    {filters.proyecto ? null : (
                      <td className="fin-col-project"><button type="button" className="fin-link" onClick={() => setProject({ id: r.project_id, label: r.project_label })}>{r.project_label}</button>
                        {r.project_code ? <div className="fin-muted">{r.project_code}</div> : null}</td>
                    )}
                    <td className="fin-num fin-nowrap"><strong className={Number(r.resultado) < 0 ? 'fin-rent-neg' : 'fin-rent-pos'}>{eur(r.resultado)}</strong>
                      {Number(r.asignado) !== Number(r.importe) ? <div className="fin-muted fin-small">{`Parte de ${eur(r.importe)}`}</div> : null}</td>
                    <td><Badge {...(CONTABLE[r.accounting_status] || CONTABLE.pending)}>{(CONTABLE[r.accounting_status] || CONTABLE.pending).label}</Badge></td>
                    <td><button type="button" className="fin-iconbtn" aria-label="Ver detalle" title="Ver detalle" onClick={() => setOpen(r)}><i className="ri-side-bar-line"></i></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && !loading && !data.rows.length ? (
            hasFilters
              ? <Empty icon="ri-search-line" title="Ningún movimiento coincide" text="Prueba con otros filtros." />
              : <Empty icon="ri-folder-open-line" title="No hay movimientos asignados a proyectos" text="Asigna materiales, pagos a trabajadores o cobros a un proyecto para verlos aquí." />
          ) : null}
        </div>
        {data && data.total > 0 ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} extra={`Resultado filtrado: ${eur(t.resultado)}`} /> : null}
      </div>

      {open ? (
        <RecordDrawer type={open.type} id={open.id} onClose={() => setOpen(null)} toast={toast}
          onSaved={() => setReload((n) => n + 1)} />
      ) : null}
    </div>
  );
}

/* Vertical bars: one per project (x), ingresos − costes (y) from a zero
 * baseline. Positive and negative are told apart by colour and by side of the
 * baseline; the value shows on hover and for the selected project. */
function ResultChart({ rows, selected, onSelect }) {
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

  const values = useMemo(() => rows.map((r) => Number(r.resultado)), [rows]);
  if (!rows.length) return <Empty icon="ri-bar-chart-line" title="Sin movimientos asignados" text="Ningún proyecto tiene movimientos con estos filtros." />;

  const H = 300, top = 16, bottom = 70, left = 76, right = 12;
  const slot = Math.max(28, (width - left - right) / rows.length);
  const W = Math.max(width, left + right + slot * rows.length);
  const bw = Math.min(48, Math.max(10, slot * 0.62));
  const hi = Math.max(0, ...values), lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const y = (v) => top + ((hi - v) / span) * (H - top - bottom);
  const zero = y(0);
  const ticks = niceTicks(lo, hi);
  const short = (s) => (s && s.length > 16 ? s.slice(0, 15) + '…' : s || '—');

  return (
    <div className="fin-rent-chart" ref={wrapRef}>
      <div className="fin-rent-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Resultado (ingresos menos costes) por proyecto">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#BDBDB8' : '#EFEFEC'} />
              <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6B6B68">{compactEur(v)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const v = values[i];
            const cx = left + slot * (i + 0.5);
            const h = Math.max(1, Math.abs(y(v) - zero));
            const isSel = selected === r.id, dim = selected && !isSel;
            return (
              <g key={r.id} className="fin-rent-bar" onClick={() => onSelect({ id: r.id, label: r.label })}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                tabIndex={0} role="button" aria-label={`${r.label}: ${eur(v)}`} aria-pressed={isSel}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ id: r.id, label: r.label }); } }}>
                <rect x={cx - slot / 2} y={top} width={slot} height={H - top - bottom} fill="transparent" />
                <path d={barPath(cx - bw / 2, v >= 0 ? zero - h : zero, bw, h, v >= 0)} fill={v >= 0 ? POS : NEG} opacity={dim ? 0.3 : 1} />
                {isSel || hover === i ? (
                  <text x={cx} y={v >= 0 ? zero - h - 6 : zero + h + 14} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1F1F1D">{compactEur(v)}</text>
                ) : null}
                <text x={cx} y={H - bottom + 14} fontSize="11" fill={isSel ? '#1F1F1D' : '#6B6B68'} fontWeight={isSel ? 700 : 400}
                  textAnchor="end" transform={`rotate(-35 ${cx} ${H - bottom + 14})`}>{short(r.label)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover !== null && rows[hover] ? (
        <div className="fin-rent-tip" role="status">
          <strong>{rows[hover].label}</strong>{rows[hover].code ? <span className="fin-muted">{` · ${rows[hover].code}`}</span> : null}
          <div>Ingresos <b>{eur(rows[hover].ingresos)}</b> · Costes <b>{eur(rows[hover].costes)}</b> · Resultado <b>{eur(rows[hover].resultado)}</b> · {rows[hover].movimientos} movimientos</div>
        </div>
      ) : <div className="fin-rent-tip is-hint fin-muted">Pasa el ratón por una barra para ver su detalle; púlsala para ver solo sus movimientos.</div>}
      <div className="fin-legend"><span><i style={{ background: POS }}></i>Beneficio (ingresos &gt; costes)</span><span><i style={{ background: NEG }}></i>Pérdida (costes &gt; ingresos)</span></div>
    </div>
  );
}

// A bar with 4px rounded corners on its data end, square on the baseline.
function barPath(x, yTop, w, h, up) {
  const r = Math.min(4, w / 2, h);
  if (up) return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
  const b = yTop + h;
  return `M${x},${yTop}V${b - r}Q${x},${b} ${x + r},${b}H${x + w - r}Q${x + w},${b} ${x + w},${b - r}V${yTop}Z`;
}

function niceTicks(lo, hi) {
  const span = hi - lo || 1;
  const raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100 || 0);
  if (!out.includes(0)) out.push(0);
  return out;
}

const CEUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
const compactEur = (v) => CEUR.format(v || 0);
