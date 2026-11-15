import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { fmtDate } from './labels.js';
import { ToolCard, useAction, ActionError } from './ui.jsx';
import { RequestBadge } from './Solicitudes.jsx';
import ToolDetail from './ToolDetail.jsx';
import SolicitudForm from './SolicitudForm.jsx';
import { api as obrasApi } from '../obras/api.js';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';
import '../../../styles/herramientas.css';

/* «Herramientas» tab of an obra (obras/Detalle.jsx): the tools its partidas
 * require (recetas, «Operaciones → Partidas → Herramientas») against those
 * working for its project, with «Solicitar las que faltan»; then the tools
 * there, what is on its way, its reservations and open requests. A tool
 * opens its ficha right here; reception is one tap. The scanner lives in the
 * Herramientas screen of the panel. */
export default function ObraHerramientas({ projectId, obraId, readOnly, toast }) {
  const [data, setData] = useState(null);
  const [needs, setNeeds] = useState(null);
  const [tool, setTool] = useState(null);
  const [options, setOptions] = useState(null);
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const action = useAction(toast);
  const load = () => tools.project(projectId).then((d) => { setData(d); setError(''); }, (e) => setError(e.status === 404 ? 'No tienes acceso a las herramientas de este proyecto.' : e.message));
  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (obraId) obrasApi.necesidades(obraId, { ambito: 'obra' }).then(setNeeds, () => setNeeds(null)); }, [obraId]);
  const loadOptions = () => { if (!options) tools.options().then(setOptions, () => {}); };
  const open = (id) => { setTool(id); loadOptions(); };
  if (tool) return <ToolDetail id={tool} options={options} readOnly={readOnly} toast={toast} onBack={() => { setTool(null); load(); }} />;
  if (request && options) {
    return <SolicitudForm options={options} preset={request} toast={toast} onCancel={() => setRequest(null)} onSaved={() => { setRequest(null); load(); }} />;
  }
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <div className="fin-loading fin-muted">Cargando herramientas…</div>;
  const receive = async (m) => { if (await action.run((key) => tools.receive(m.id, {}, key), `${m.code} recibida`)) load(); };
  // Needed (max per partida) against those in the obra or on their way to it, per tool type.
  const have = new Map();
  for (const h of data.herramientas) have.set(h.type?.id, (have.get(h.type?.id) || 0) + 1);
  const required = (needs?.herramientas || []).map((h) => ({ ...h, have: have.get(h.toolTypeId) || 0 })).map((h) => ({ ...h, missing: Math.max(0, h.quantity - h.have) }));
  const missing = required.filter((h) => h.missing > 0);
  const canRequest = !readOnly && (options ? options.permissions.includes('tools.request') : true);
  const ask = () => {
    tools.options().then((o) => {
      setOptions(o);
      setRequest({ projectId, items: missing.map((h) => ({ typeId: h.toolTypeId, quantity: h.missing })), notes: 'Herramientas obligatorias de las partidas de la obra que faltan en ella.' });
    }, (e) => toast?.(e.message));
  };
  return (
    <div className="tl">
      {required.length ? (
        <div className="fin-card">
          <div className="fin-card-head"><h3 className="obr-h3">{`Necesarias según las partidas (${required.length})`}</h3>
            {missing.length && canRequest ? <button type="button" className="fin-btn is-primary" onClick={ask}><i className="ri-add-line"></i>{`Solicitar las que faltan (${missing.length})`}</button> : null}</div>
          <p className="fin-muted fin-small">{missing.length ? `Faltan ${missing.length} de ${required.length} herramientas en la obra. Las solicitudes en curso no se descuentan: revísalas abajo antes de pedir.` : 'La obra tiene todas las herramientas que piden sus partidas.'}</p>
          <span className="obr-chips">{required.map((h) => (
            <span key={h.toolTypeId} className={'obr-chip ' + (h.missing ? 'is-missing' : 'is-ok')} title={`${h.category} · partidas ${h.partidas.join(', ')}`}>
              {`${h.name} · ${h.have}/${h.quantity}`}</span>
          ))}</span>
        </div>
      ) : null}
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
