import React, { useEffect, useState } from 'react';
import { CLASE_MOV, Classify, canClassify } from './ConceptoMovimientos.jsx';
import { api } from './api.js';
import { eur, fecha, num } from './format.js';
import { Badge, Empty, ErrorBox, Kpi, Pager } from './ui.jsx';

// Origin of the movement in ledens.treasury_movements (bank and cash in one).
const ORIGEN = { bank_movements: 'Banco', cash_movements: 'Efectivo' };
// Whether what the movement registered is assigned to a project (every reconciled movement has to be).
const PROYECTO = {
  asignado: { label: 'Asignado', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-checkbox-circle-line' },
  parcial: { label: 'Asignado en parte', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-error-warning-line' },
  sin_proyecto: { label: 'Sin proyecto', bg: '#FDECEC', fg: '#A23B3B', icon: 'ri-alert-line' },
  sin_registros: { label: 'Sin conceptos que asignar', bg: '#FDECEC', fg: '#A23B3B', icon: 'ri-alert-line' },
};

function Proyecto({ r }) {
  const p = PROYECTO[r.proyecto_estado] || PROYECTO.sin_proyecto;
  const names = r.proyectos || [];
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      {names.length ? <div className="fin-ellipsis" title={names.join(', ')}>{names.length === 1 ? names[0] : `${names.length} proyectos`}</div> : null}
      {r.proyecto_estado !== 'asignado' || !names.length ? <Badge bg={p.bg} fg={p.fg} icon={p.icon}>{p.label}</Badge> : null}
    </div>
  );
}

/* Movimientos conciliados (admins): one row per reconciled movement, never split
 * into its concepts — that it is reconciled, with which document number, its class
 * and the project it is assigned to. Every reconciled movement has to be assigned
 * to a project: the ones that are not are flagged and can be filtered. */
export default function Conciliados({ toast, onChanged }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [clase, setClase] = useState(''), [proyecto, setProyecto] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    api.reconciled({ q: query, clase, proyecto, desde, hasta, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, clase, proyecto, desde, hasta, page, reload]);
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const pick = (k) => { setProyecto((c) => (c === k ? '' : k)); setPage(1); };
  const done = (res) => {
    setEditing(null); setReload((n) => n + 1); onChanged?.();
    toast?.(`Movimiento clasificado como ${CLASE_MOV[res.clase].label.toLowerCase()}.`);
  };
  const r = data?.resumen;
  return (
    <div className="fin-stack">
      <div className="fin-kpis">
        <Kpi label="Movimientos conciliados" value={r ? num(r.movimientos) : '…'} icon="ri-checkbox-multiple-line" active={proyecto === ''} onClick={() => pick('')} />
        <Kpi label="Asignados a proyecto" value={r ? num(r.movimientos - r.sin_proyecto) : '…'} icon="ri-checkbox-circle-line" active={proyecto === 'asignado'} onClick={() => pick('asignado')} />
        <Kpi label="Sin proyecto" value={r ? num(r.sin_proyecto) : '…'} icon="ri-alert-line" tone={r?.sin_proyecto ? 'warn' : undefined} active={proyecto === 'sin_proyecto'} onClick={() => pick('sin_proyecto')} />
      </div>
      {r?.sin_proyecto ? <div className="fin-warn"><i className="ri-alert-line"></i><span>{r.sin_proyecto === 1 ? 'Hay 1 movimiento conciliado sin asignar a un proyecto' : `Hay ${num(r.sin_proyecto)} movimientos conciliados sin asignar a un proyecto`}: todo movimiento conciliado tiene que estar asignado a un proyecto.</span></div> : null}
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tercero, concepto, documento, referencia o proyecto" /></label>
        <label className="fin-field"><span>Clasificación</span>
          <select value={clase} onChange={filter(setClase)}><option value="">Todas</option>{Object.entries(CLASE_MOV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="fin-field"><span>Proyecto</span>
          <select value={proyecto} onChange={filter(setProyecto)}><option value="">Todos</option><option value="asignado">Asignados</option><option value="sin_proyecto">Sin proyecto</option></select></label>
        <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
        <button className="fin-btn" type="button" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
      </div>
      {editing ? <Classify row={editing} onClose={() => setEditing(null)} onDone={done} /> : null}
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
        {data && !data.rows.length ? <Empty icon="ri-checkbox-multiple-line" title="Sin movimientos conciliados" text="Cuando un movimiento se concilia con su documento, aparece aquí." /> : null}
        {data && data.rows.length ? <>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr><th>Fecha</th><th>Origen</th><th>Movimiento</th><th>Tercero</th><th className="fin-num">Importe</th><th>Conciliado con</th><th>Clasificación</th><th>Proyecto</th><th><span className="fin-sr">Acciones</span></th></tr></thead>
            <tbody>{data.rows.map((m) => {
              const c = CLASE_MOV[m.clase] || CLASE_MOV.pendiente;
              return (
                <tr key={m.id}>
                  <td className="fin-nowrap">{fecha(m.fecha)}</td>
                  <td className="fin-nowrap">{ORIGEN[m.origin] || '—'}</td>
                  <td className="fin-ellipsis is-wide" title={m.concepto || m.referencia}>{m.concepto || m.referencia || '—'}</td>
                  <td className="fin-ellipsis">{m.tercero || '—'}</td>
                  <td className="fin-num fin-nowrap">{eur(m.importe)}</td>
                  <td className="fin-nowrap" title={m.documentos || undefined}><i className="ri-checkbox-circle-line" aria-hidden="true"></i> {m.documentos || <span className="fin-muted">Sin documento</span>}</td>
                  <td><Badge bg={c.bg} fg={c.fg} icon={c.icon}>{c.label}</Badge></td>
                  <td><Proyecto r={m} /></td>
                  <td>{canClassify(m) ? <button type="button" className="fin-btn" onClick={() => setEditing(m)}>Cambiar</button> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
        </> : null}
      </div>
    </div>
  );
}
