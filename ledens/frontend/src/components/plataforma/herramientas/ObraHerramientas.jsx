import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { fmtDate } from './labels.js';
import { ToolCard, useAction, ActionError } from './ui.jsx';
import { RequestBadge } from './Solicitudes.jsx';
import ToolDetail from './ToolDetail.jsx';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';
import '../../../styles/herramientas.css';

/* «Herramientas» tab of an obra (obras/Detalle.jsx): the tools working for its
 * project, what is on its way, its reservations and open requests. A tool
 * opens its ficha right here; reception is one tap. Requests and the scanner
 * live in the Herramientas screen of the panel. */
export default function ObraHerramientas({ projectId, readOnly, toast }) {
  const [data, setData] = useState(null);
  const [tool, setTool] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const action = useAction(toast);
  const load = () => tools.project(projectId).then((d) => { setData(d); setError(''); }, (e) => setError(e.status === 404 ? 'No tienes acceso a las herramientas de este proyecto.' : e.message));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (id) => { setTool(id); if (!options) tools.options().then(setOptions, () => {}); };
  if (tool) return <ToolDetail id={tool} options={options} readOnly={readOnly} toast={toast} onBack={() => { setTool(null); load(); }} />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <div className="fin-loading fin-muted">Cargando herramientas…</div>;
  const receive = async (m) => { if (await action.run((key) => tools.receive(m.id, {}, key), `${m.code} recibida`)) load(); };
  return (
    <div className="tl">
      {data.incoming.length ? (
        <div className="fin-card"><div className="fin-card-head"><h3 className="obr-h3">{`De camino a esta obra (${data.incoming.length})`}</h3></div>
          <ul className="tl-list">{data.incoming.map((m) => <li key={m.id}><div><strong>{`${m.code} · ${m.name}`}</strong><span className="fin-muted">{`Desde ${m.from || '—'} · ${m.sender}`}</span></div>
            {!readOnly && m.forMe ? <button type="button" className="fin-btn is-primary" disabled={action.busy} onClick={() => receive(m)}>Confirmar recepción</button> : null}</li>)}</ul>
          <ActionError error={action.error} /></div>
      ) : null}
      <div className="fin-card">
        <div className="fin-card-head"><h3 className="obr-h3">{`En esta obra (${data.herramientas.length})`}</h3></div>
        {data.herramientas.length ? <ul className="tl-cards">{data.herramientas.map((h) => <ToolCard key={h.id} tool={h} onOpen={() => open(h.id)} />)}</ul>
          : <Empty icon="ri-hammer-line" title="Esta obra no tiene herramientas asignadas" />}
      </div>
      {data.reservations.length ? (
        <div className="fin-card"><div className="fin-card-head"><h3 className="obr-h3">Reservadas para esta obra</h3></div>
          <ul className="tl-list">{data.reservations.map((r) => <li key={r.id}><div><strong>{`${r.asset.code} · ${r.asset.name}`}</strong><span className="fin-muted">{`${fmtDate(r.startsOn)} → ${fmtDate(r.endsOn)}`}</span></div></li>)}</ul></div>
      ) : null}
      {data.requests.length ? (
        <div className="fin-card"><div className="fin-card-head"><h3 className="obr-h3">Solicitudes en curso</h3></div>
          <ul className="tl-list">{data.requests.map((r) => <li key={r.id}><div><strong>{`${r.ref} · ${r.units} ud`}</strong><span className="fin-muted">{`${r.summary} · ${fmtDate(r.neededFrom)} → ${fmtDate(r.returnBy)}`}</span></div><RequestBadge status={r.status} /></li>)}</ul></div>
      ) : null}
    </div>
  );
}
