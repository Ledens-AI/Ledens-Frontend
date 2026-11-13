import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { PendingMoves } from './Transferencias.jsx';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';

/* «Herramientas de mi obra» — the jefe's starting point on site: what each of
 * his obras has, what is on its way, what must go back; and the three actions
 * of every day (request, scan, see my tools). Each number opens its list. */
export default function MisHerramientas({ readOnly, toast, onRequest, onScan, onInventory, onOpen, onRequests }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => tools.myObras().then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div className="tl">
      <div className="tl-head"><div><h2>Herramientas de mi obra</h2><p>Lo que tienes, lo que llega y lo que tienes que devolver.</p></div></div>
      <div className="tl-actions">
        {!readOnly ? <button type="button" className="tl-action is-primary" onClick={() => onRequest()}><i className="ri-add-circle-line" aria-hidden="true"></i><div><strong>Solicitar herramienta</strong><span>Para una fecha y una obra</span></div></button> : null}
        <button type="button" className="tl-action" onClick={onScan}><i className="ri-qr-scan-2-line" aria-hidden="true"></i><div><strong>Escanear QR</strong><span>Abre la ficha y sus acciones</span></div></button>
        <button type="button" className="tl-action" onClick={() => onInventory('mi_obra')}><i className="ri-hammer-line" aria-hidden="true"></i><div><strong>Ver mis herramientas</strong><span>Todas las de mis obras</span></div></button>
      </div>
      <PendingMoves compact readOnly={readOnly} toast={toast} onOpen={onOpen} onCount={() => load()} />
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {!data && !error ? <div className="fin-loading fin-muted">Cargando tus obras…</div> : null}
      {data && !data.obras.length ? <Empty icon="ri-building-2-line" title="No tienes obras con herramientas" text="Cuando tengas una obra asignada aparecerá aquí." /> : null}
      {data?.obras.map((o) => (
        <section key={o.project.id} className="fin-card tl-obra" aria-label={o.project.name}>
          <div className="tl-obra-title"><strong>{o.project.name}</strong><span className="fin-muted">{o.project.code}</span></div>
          <div className="tl-counts">
            <Count n={o.assigned} label="Herramientas asignadas" onClick={() => onInventory('mi_obra')} />
            <Count n={o.incoming} label="Pendientes de recibir" tone={o.incoming ? 'warn' : ''} />
            <Count n={o.requests} label="Solicitudes en curso" onClick={onRequests} />
            <Count n={o.incidents} label="Con incidencias" tone={o.incidents ? 'bad' : ''} onClick={() => onInventory('averiadas')} />
            <Count n={o.returnsDue} label={o.overdue ? `Por devolver (${o.overdue} vencidas)` : 'Por devolver (3 días)'} tone={o.overdue ? 'bad' : o.returnsDue ? 'warn' : ''} />
          </div>
        </section>
      ))}
    </div>
  );
}

function Count({ n, label, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} className={'tl-count' + (tone ? ` is-${tone}` : '')} onClick={onClick}><b>{n}</b><span>{label}</span></Tag>;
}
