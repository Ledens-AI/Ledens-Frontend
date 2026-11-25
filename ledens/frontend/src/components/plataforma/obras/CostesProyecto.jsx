import React, { useEffect, useRef, useState } from 'react';
import { api as finApi } from '../finanzas/api.js';
import { eur, fecha } from '../finanzas/format.js';
import RecordDrawer from '../finanzas/RecordDrawer.jsx';
import { Badge, Empty, ErrorBox, Kpi, Pager } from '../finanzas/ui.jsx';

/* «Costes» of one project, opened from the Costes card of its page in
 * «Presupuestos y obras»: every cost record assigned to the project (the same
 * ones Rentabilidad por proyecto adds up, validated or not), paginated, with
 * the cards as a filter by kind of cost. /api/finanzas decides who may see it. */

const KINDS = {
  materiales: { label: 'Materiales', icon: 'ri-hammer-line', bg: '#E3E7F3', fg: '#3E4D85' },
  trabajadores: { label: 'Mano de obra', icon: 'ri-user-settings-line', bg: '#DEF3F0', fg: '#2F6B63' },
  otros: { label: 'Otros costes', icon: 'ri-price-tag-3-line', bg: '#EDEDEA', fg: '#3A3A38' },
};
const kindOf = (category) => (['materials', 'overhead'].includes(category) ? 'materiales' : category === 'labor' ? 'trabajadores' : 'otros');
const CONTABLE = { approved: { label: 'Validado', bg: '#DEF3F0', fg: '#2F6B63' }, pending: { label: 'Sin validar', bg: '#FBF1DE', fg: '#7A4E0E' } };
const EMPTY = { tipo: 'costes', contable: '', desde: '', hasta: '', q: '' };
// A cost shows as a positive amount; a supplier refund (negative cost) as negative.
const cost = (r) => -Number(r.resultado);

export default function CostesProyecto({ project, onBack, toast }) {
  const [filters, setFilters] = useState(EMPTY);
  const [draftQ, setDraftQ] = useState('');
  const [sort, setSort] = useState({ by: 'fecha', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(null);
  const top = useRef(null);
  // Opened from a card further down the project page: start at its top (below the sticky bar, .obr-costes).
  useEffect(() => { const el = top.current; if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: 'start' }); }, []);

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  useEffect(() => { const t = setTimeout(() => { if (draftQ !== filters.q) setF({ q: draftQ }); }, 300); return () => clearTimeout(t); }, [draftQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // The project's cost totals by kind, for the cards (only the project as filter).
  useEffect(() => {
    let cancelled = false;
    Promise.all(['costes', 'materiales', 'trabajadores', 'otros'].map((tipo) => finApi.projectResults({ proyecto: project.id, tipo, tam: 1 })))
      .then((rs) => { if (!cancelled) setKpis(Object.fromEntries(['costes', 'materiales', 'trabajadores', 'otros'].map((k, i) => [k, rs[i].totales]))); },
        () => { if (!cancelled) setKpis(false); });
    return () => { cancelled = true; };
  }, [project.id, reload]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    finApi.projectResults({
      proyecto: project.id, tipo: filters.tipo, contable: filters.contable, desde: filters.desde, hasta: filters.hasta, q: filters.q,
      orden: sort.by, dir: sort.dir, pagina: page, tam: 50,
    }).then(
      (d) => { if (!cancelled) { setData(d); setError(''); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e.status === 403 ? 'No tienes acceso a la gestión financiera de este proyecto.' : e.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [project.id, filters, sort, page, reload]);

  const hasFilters = Object.entries(filters).some(([k, v]) => v !== EMPTY[k]);
  const th = (label, by, cls) => (
    <th className={cls} aria-sort={sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="fin-sort" onClick={() => { setSort((s) => ({ by, dir: s.by === by && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(1); }}>
        {label}<i className={sort.by === by ? (sort.dir === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-expand-up-down-line'} aria-hidden="true"></i>
      </button>
    </th>
  );
  const card = (tipo, label, icon) => (
    <Kpi label={label} icon={icon} value={kpis ? eur(kpis[tipo].costes) : kpis === false ? '—' : '…'} active={filters.tipo === tipo}
      hint={kpis ? `${kpis[tipo].movimientos} ${kpis[tipo].movimientos === 1 ? 'movimiento' : 'movimientos'}` : undefined}
      onClick={() => setF({ tipo: filters.tipo === tipo && tipo !== 'costes' ? 'costes' : tipo })} />
  );
  const title = filters.tipo === 'costes' ? 'Todos los costes' : KINDS[filters.tipo].label;

  return (
    <div className="fin-stack obr obr-costes" ref={top}>
      <div><button type="button" className="fin-btn is-ghost is-small" onClick={onBack}><i className="ri-arrow-left-line"></i>Volver al proyecto</button></div>
      <div className="obr-head">
        <div className="fin-project-head">
          <span className="fin-muted">{[['Proyecto', project.code].filter(Boolean).join(' '), project.name].join(' · ')}</span>
          <h2>Costes del proyecto</h2>
          <span className="fin-muted">Todos los costes asignados al proyecto en Gestión financiera, validados o no. Pulsa una tarjeta para ver solo ese tipo de coste.</span>
        </div>
      </div>

      <div className="fin-kpis">
        {card('costes', 'Todos los costes', 'ri-shopping-cart-2-line')}
        {card('materiales', 'Materiales', KINDS.materiales.icon)}
        {card('trabajadores', 'Mano de obra', KINDS.trabajadores.icon)}
        {card('otros', 'Otros costes', KINDS.otros.icon)}
      </div>

      <div className="fin-card fin-filters">
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
          <input type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Proveedor, trabajador, concepto o nº de factura" />
        </label>
        {hasFilters ? <button type="button" className="fin-btn is-ghost fin-self-end" onClick={() => { setDraftQ(''); setF({ ...EMPTY }); }}>Limpiar filtros</button> : null}
      </div>

      {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}

      <div className="fin-card is-flush">
        <div className="fin-card-head fin-pad"><h2>{data ? `${title} · ${data.total}` : title}</h2></div>
        <div className="fin-table-wrap" aria-busy={loading}>
          <table className="fin-table">
            <thead>
              <tr>
                {th('Fecha', 'fecha')}
                <th>Tipo de coste</th>
                <th>Nº de documento</th>
                {th('Tercero', 'tercero')}
                {th('Concepto', 'concepto')}
                {th('Importe', 'coste', 'fin-num')}
                <th>Validación</th>
                <th><span className="fin-sr">Detalle</span></th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((r) => {
                const k = KINDS[kindOf(r.category)];
                const st = CONTABLE[r.accounting_status] || CONTABLE.pending;
                return (
                  <tr key={`${r.type}:${r.id}:${r.project_id}`}>
                    <td className="fin-nowrap">{fecha(r.fecha)}</td>
                    <td className="fin-nowrap"><Badge bg={k.bg} fg={k.fg} icon={k.icon}>{k.label}</Badge></td>
                    <td className="fin-nowrap">{r.numerodocumento || (r.document_id ? 'Sin número' : <span className="fin-muted">Sin documento</span>)}
                      {r.line_number && r.line_number < 10000 ? <div className="fin-muted">Línea {r.line_number}</div> : null}</td>
                    <td className="fin-ellipsis" title={r.tercero || ''}>{r.tercero || <span className="fin-muted">—</span>}</td>
                    <td className="fin-ellipsis is-wide" title={r.concepto || ''}>{r.concepto || <span className="fin-muted">—</span>}</td>
                    <td className="fin-num fin-nowrap"><strong>{eur(cost(r))}</strong>
                      {Math.abs(Number(r.asignado)) !== Math.abs(Number(r.importe)) ? <div className="fin-muted fin-small">{`Parte de ${eur(Math.abs(Number(r.importe)))}`}</div> : null}</td>
                    <td><Badge bg={st.bg} fg={st.fg}>{st.label}</Badge></td>
                    <td><button type="button" className="fin-iconbtn" aria-label="Ver detalle" title="Ver detalle" onClick={() => setOpen(r)}><i className="ri-side-bar-line"></i></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data && loading ? <div className="fin-loading fin-muted">Cargando los costes…</div> : null}
          {data && !loading && !data.rows.length ? (
            hasFilters
              ? <Empty icon="ri-search-line" title="Ningún coste coincide" text="Prueba con otros filtros." />
              : <Empty icon="ri-shopping-cart-2-line" title="Este proyecto no tiene costes" text="Asigna materiales, pagos a trabajadores u otros gastos al proyecto en Gestión financiera para verlos aquí." />
          ) : null}
        </div>
        {data && data.total > 0 ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} extra={`Total: ${eur(data.totales.costes)}`} /> : null}
      </div>

      {open ? (
        <RecordDrawer type={open.type} id={open.id} onClose={() => setOpen(null)} toast={toast}
          onSaved={() => setReload((n) => n + 1)} />
      ) : null}
    </div>
  );
}
