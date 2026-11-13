import React, { useCallback, useEffect, useState } from 'react';
import { tools } from './api.js';
import { OfflineBanner } from './ui.jsx';
import MisHerramientas from './MisHerramientas.jsx';
import Inventario from './Inventario.jsx';
import ToolDetail from './ToolDetail.jsx';
import Solicitudes from './Solicitudes.jsx';
import SolicitudForm from './SolicitudForm.jsx';
import EscanearQR from './EscanearQR.jsx';
import Dashboard from './Dashboard.jsx';
import Operaciones from './Operaciones.jsx';
import Etiquetas from './Etiquetas.jsx';
import { ErrorBox } from '../finanzas/ui.jsx';
import '../../../styles/finanzas.css';
import '../../../styles/obras.css';
import '../../../styles/herramientas.css';

/* Ledens Tools in /plataforma (lazy-loaded by Plataforma.jsx). Backend:
 * /api/herramientas (ledens/backend/src/herramientas/), which decides what
 * each user sees and may do; this screen only mirrors it.
 * panel: 'worker' (jefe de obra) | 'admin'. screen:
 *   jefe  — 'mis' (Herramientas de mi obra) | 'solicitudes' (Mis solicitudes)
 *   admin — 'panel' | 'inventario' | 'solicitudes' | 'operaciones'
 * token: a scanned label opened through /h/<token> → the ficha. */
export default function Herramientas({ panel, screen, nav, readOnly, toast, token, onCount }) {
  const admin = panel === 'admin';
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  // The view inside the screen: null (screen home) | { tool } | { inventory } | { scan } | { request } | { labels }
  const [view, setView] = useState(null);
  const loadOptions = useCallback(() => tools.options().then((o) => { setOptions(o); setError(''); }, (e) => setError(e.message)), []);
  useEffect(() => { loadOptions(); }, [loadOptions]);
  // A sidebar click (nav changes even on the same screen) always returns to the section's start.
  useEffect(() => { setView(null); window.scrollTo(0, 0); }, [screen, nav]);
  useEffect(() => {
    if (!token) return;
    tools.resolveLabel(token).then((r) => setView({ tool: r.id }), (e) => { toast?.(e.status === 404 ? 'Etiqueta no reconocida o sustituida' : e.message); });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (v) => { setView(v); window.scrollTo(0, 0); };
  const back = () => go(view?.from || null);
  const openTool = (id) => go({ tool: id, from: view });
  const newRequest = (preset) => go({ request: preset || {}, from: view });

  let body;
  if (error && !options) body = <ErrorBox message={error} onRetry={loadOptions} />;
  else if (view?.tool) {
    body = <ToolDetail key={view.tool} id={view.tool} options={options} readOnly={readOnly} toast={toast} onBack={back}
      onRequest={(h) => newRequest({ tool: h, projectId: h.project?.id })} onChanged={() => onCount?.()} onPrint={(ids) => go({ labels: ids, from: view })} />;
  } else if (view?.request) {
    body = <SolicitudForm options={options} preset={view.request.tool ? view.request : null} toast={toast} onCancel={back}
      onSaved={(d) => go({ requests: d.solicitud.id })} />;
  } else if (view?.requests) {
    body = <Solicitudes admin={admin} readOnly={readOnly} toast={toast} openId={view.requests} onNew={readOnly ? null : () => newRequest()} onOpenTool={openTool} onCount={onCount} />;
  } else if (view?.scan) {
    body = <EscanearQR toast={toast} onFound={(id) => go({ tool: id })} />;
  } else if (view?.inventory) {
    body = <Inventario admin={admin} initialFilter={view.inventory} readOnly={readOnly} options={options} toast={toast} onOpen={openTool} onPrint={(ids) => go({ labels: ids, from: view })} onOptions={loadOptions} />;
  } else if (view?.labels) {
    body = <Etiquetas ids={view.labels} onBack={back} />;
  } else if (screen === 'solicitudes') {
    body = <Solicitudes admin={admin} readOnly={readOnly} toast={toast} onNew={readOnly ? null : () => newRequest()} onOpenTool={openTool} onCount={onCount} />;
  } else if (screen === 'inventario') {
    body = <Inventario admin={admin} readOnly={readOnly} options={options} toast={toast} onOpen={openTool} onPrint={(ids) => go({ labels: ids })} onOptions={loadOptions} />;
  } else if (screen === 'operaciones') {
    body = <Operaciones options={options} readOnly={readOnly} toast={toast} onOpen={openTool} onOptions={loadOptions} />;
  } else if (screen === 'panel') {
    body = <Dashboard options={options} onScan={() => go({ scan: true })} onFilter={(f) => go({ inventory: f })} onOpen={openTool} onRequests={() => go({ requests: true })} onMoves={() => go({ inventory: 'en_traslado' })} />;
  } else {
    body = <MisHerramientas readOnly={readOnly} toast={toast} onRequest={() => newRequest()} onScan={() => go({ scan: true })} onInventory={(f) => go({ inventory: f })} onOpen={openTool} onRequests={() => go({ requests: true })} />;
  }
  return (
    <div className="fin obr">
      <OfflineBanner />
      {!admin && screen === 'mis' && !view?.tool && !view?.request ? (
        <div className="fin-segmented" role="tablist" aria-label="Herramientas">
          {[['mis', 'Mi obra', null], ['inventario', 'Inventario', { inventory: 'mi_obra' }], ['escanear', 'Escanear QR', { scan: true }]].map(([k, l, v]) => {
            const on = k === 'mis' ? !view : k === 'inventario' ? !!view?.inventory : !!view?.scan;
            return <button key={k} type="button" role="tab" aria-selected={on} className={on ? 'is-on' : ''} onClick={() => go(v)}>{l}</button>;
          })}
        </div>
      ) : null}
      {body}
    </div>
  );
}
