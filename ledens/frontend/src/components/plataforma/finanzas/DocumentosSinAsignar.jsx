import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha, num } from './format.js';
import { Badge, Empty, ErrorBox, Kpi, Pager } from './ui.jsx';

const MOTIVO = {
  awaiting_evaluation: 'Pendiente de evaluar', no_match: 'Sin movimiento candidato', ambiguous_match: 'Varios movimientos posibles',
  too_many_candidates: 'Demasiados movimientos posibles', unverified_currency: 'Moneda sin verificar', bridge_failed: 'Error al buscar movimiento',
};
const TIPO_DOC = {
  Pagar: { label: 'Factura recibida', bg: '#E3E7F3', fg: '#3E4D85' },
  Cobrar: { label: 'Factura emitida', bg: '#FDF0F4', fg: '#B84371' },
};

/* Documentos sin asignar (admins): processed documents with no confirmed bank
 * movement in the Bridge. Read-only: movements are assigned from «Pendiente de
 * conciliación» («Asignar documento»). */
export default function DocumentosSinAsignar({ go }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [tipo, setTipo] = useState(''), [estado, setEstado] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    api.unassignedDocuments({ q: query, tipo, estado, desde, hasta, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, tipo, estado, desde, hasta, page, reload]);
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const filtered = query || tipo || estado || desde || hasta;
  return (
    <div className="fin-stack">
      <div className="fin-kpis">
        <Kpi label="Documentos sin asignar" value={data ? num(data.total) : '…'} icon="ri-file-warning-line" tone={data?.total ? 'warn' : undefined} />
        <Kpi label="Facturas recibidas (importe)" value={data ? eur(data.importes.pagar) : '…'} icon="ri-arrow-right-up-line" active={tipo === 'Pagar'} onClick={() => { setTipo((t) => (t === 'Pagar' ? '' : 'Pagar')); setPage(1); }} />
        <Kpi label="Facturas emitidas (importe)" value={data ? eur(data.importes.cobrar) : '…'} icon="ri-arrow-left-down-line" active={tipo === 'Cobrar'} onClick={() => { setTipo((t) => (t === 'Cobrar' ? '' : 'Cobrar')); setPage(1); }} />
      </div>
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº de documento, tercero o NIF" /></label>
        <label className="fin-field"><span>Tipo</span>
          <select value={tipo} onChange={filter(setTipo)}><option value="">Todos</option><option value="Pagar">Facturas recibidas</option><option value="Cobrar">Facturas emitidas</option></select></label>
        <label className="fin-field"><span>Estado</span>
          <select value={estado} onChange={filter(setEstado)}><option value="">Todos</option><option value="sin_enlace">Sin ningún enlace</option><option value="revision">Con enlace en revisión</option></select></label>
        <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
        <button className="fin-btn" type="button" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
        <button className="fin-btn" type="button" onClick={() => go?.('conciliacion')}>Ir a Pendiente de conciliación</button>
      </div>
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
        {data && !data.rows.length ? (filtered
          ? <Empty icon="ri-search-line" title="Ningún documento coincide" text="Prueba con otros filtros." />
          : <Empty icon="ri-checkbox-circle-line" title="Todos los documentos tienen movimiento" text="Cada documento procesado está conciliado con algún movimiento." />) : null}
        {data && data.rows.length ? <>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr><th>Fecha</th><th>Documento</th><th>Tipo</th><th>Tercero</th><th>NIF</th><th className="fin-num">Total</th><th>Estado en el Bridge</th><th><span className="fin-sr">Archivo</span></th></tr></thead>
            <tbody>{data.rows.map((d) => {
              const t = TIPO_DOC[d.tipo];
              return (
                <tr key={d.id}>
                  <td className="fin-nowrap">{fecha(d.fecha)}</td>
                  <td className="fin-nowrap">{d.numerodocumento || <span className="fin-muted">Sin número</span>}</td>
                  <td>{t ? <Badge bg={t.bg} fg={t.fg}>{t.label}</Badge> : (d.tipo || '—')}</td>
                  <td className="fin-ellipsis" title={d.tercero || ''}>{d.tercero || '—'}</td>
                  <td className="fin-nowrap">{d.niftercero || '—'}</td>
                  <td className="fin-num fin-nowrap">{eur(d.total)}</td>
                  <td>{d.revision ? <Badge bg="#FBF1DE" fg="#7A4E0E" icon="ri-time-line">Enlace en revisión</Badge>
                    : d.bridge_estado === 'dismissed' ? <span className="fin-muted">Descartado{d.bridge_motivo ? ` · ${MOTIVO[d.bridge_motivo] || d.bridge_motivo}` : ''}</span>
                    : <span className="fin-muted">{MOTIVO[d.bridge_motivo] || 'Sin movimiento asignado'}</span>}</td>
                  <td>{d.archivo ? <a className="fin-btn is-ghost" href={d.archivo} target="_blank" rel="noopener noreferrer">Ver archivo</a> : null}</td>
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
