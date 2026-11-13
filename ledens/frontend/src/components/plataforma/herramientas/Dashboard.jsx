import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { fmtDate, fmtDateTime, incidentLabel } from './labels.js';
import { Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';

/* Panel de herramientas (administración): the company-wide picture, filtered
 * by obra, ubicación, categoría o responsable. Each KPI opens its list. */
export default function Dashboard({ options, onFilter, onOpen, onRequests, onMoves, onScan }) {
  const [f, setF] = useState({ proyecto: '', ubicacion: '', categoria: '', responsable: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => tools.dashboard(f).then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { load(); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const categories = [...new Set((options?.types || []).map((t) => t.category))].sort();
  const k = data?.kpis;
  const sel = (key, label, opts) => (
    <label className="fin-field"><span>{label}</span><select value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}><option value="">Todas</option>{opts}</select></label>
  );
  return (
    <div className="tl">
      <div className="tl-head"><div><h2>Panel de herramientas</h2><p>Dónde está cada equipo, qué falta por decidir y qué hay que devolver.</p></div>
        {onScan ? <button type="button" className="fin-btn" onClick={onScan}><i className="ri-qr-scan-2-line" aria-hidden="true"></i>Escanear QR</button> : null}</div>
      <div className="fin-filters">
        {sel('proyecto', 'Obra', (options?.projects || []).map((p) => <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' · ')}</option>))}
        {sel('ubicacion', 'Ubicación', (options?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>))}
        {sel('categoria', 'Categoría', categories.map((c) => <option key={c} value={c}>{c}</option>))}
        {sel('responsable', 'Responsable', (options?.custodians || []).filter((c) => c.type === 'user').map((c) => <option key={c.id} value={c.id}>{c.name}</option>))}
      </div>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {!k && !error ? <div className="fin-loading fin-muted">Cargando panel…</div> : null}
      {k ? <>
        <div className="fin-kpis">
          <Kpi label="Total de activos" value={k.total} icon="ri-hammer-line" onClick={() => onFilter('todas')} />
          <Kpi label="Disponibles" value={k.disponibles} icon="ri-checkbox-circle-line" onClick={() => onFilter('disponibles')} />
          <Kpi label="Asignados a obra" value={k.asignados} icon="ri-building-2-line" onClick={() => onFilter('asignadas')} />
          <Kpi label="Reservados" value={k.reservados} icon="ri-calendar-check-line" onClick={() => onFilter('reservadas')} />
          <Kpi label="En traslado" value={k.enTraslado} icon="ri-truck-line" onClick={onMoves} />
          <Kpi label="Averiados o en mantenimiento" value={k.enMantenimiento} icon="ri-tools-line" tone={k.enMantenimiento ? 'warn' : undefined} onClick={() => onFilter('averiadas')} />
          <Kpi label="Perdidos o robados" value={k.extraviados} icon="ri-question-line" tone={k.extraviados ? 'warn' : undefined} onClick={() => onFilter('averiadas')} />
          <Kpi label="Solicitudes por aprobar" value={k.solicitudesPendientes} icon="ri-inbox-line" tone={k.solicitudesPendientes ? 'warn' : undefined} onClick={onRequests} />
          <Kpi label="Devoluciones vencidas" value={k.devolucionesVencidas} icon="ri-alarm-warning-line" tone={k.devolucionesVencidas ? 'warn' : undefined} />
        </div>
        <div className="fin-grid-2" style={{ alignItems: 'start' }}>
          <List title="Devoluciones vencidas" empty="Ninguna devolución vencida" items={data.overdue} render={(o) => [`${o.asset.code} · ${o.asset.name}`, `${[o.project.code, o.project.name].filter(Boolean).join(' · ')} · debía volver el ${fmtDate(o.expectedReturnOn)}`]} onOpen={(o) => onOpen(o.asset.id)} />
          <List title="Incidencias abiertas" empty="Sin incidencias abiertas" items={data.incidents} render={(i) => [`${i.asset.code} · ${i.asset.name}`, `${incidentLabel(i.kind)}${i.blocksUse ? ' · no apta' : ''} · ${fmtDateTime(i.reportedAt)}`]} onOpen={(i) => onOpen(i.asset.id)} />
          <List title="Alquileres que terminan (7 días)" empty="Ningún alquiler termina pronto" items={data.rentals} render={(r) => [`${r.code} · ${r.name}`, `${r.ownerName || 'Alquiler'} · hasta el ${fmtDate(r.rentalEndsOn)}`]} onOpen={(r) => onOpen(r.id)} />
          <List title="Consumibles bajo mínimos" empty="Existencias por encima del mínimo" items={data.lowStock} render={(t) => [t.name, `${t.quantity} ${t.unit} · mínimo ${t.minStock}`]} />
        </div>
      </> : null}
    </div>
  );
}

function List({ title, items, render, onOpen, empty }) {
  return (
    <div className="fin-card">
      <div className="fin-card-head"><h3 className="obr-h3">{`${title} (${items.length})`}</h3></div>
      {items.length ? <ul className="tl-list">{items.map((x, n) => { const [a, b] = render(x); return (
        <li key={x.id || x.assignmentId || n}><div><strong>{a}</strong><span className="fin-muted" style={{ fontSize: '13px' }}>{b}</span></div>
          {onOpen ? <button type="button" className="fin-btn is-small" onClick={() => onOpen(x)}>Abrir</button> : null}</li>); })}</ul>
        : <Empty icon="ri-check-line" title={empty} />}
    </div>
  );
}
