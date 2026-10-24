import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Empty, ErrorBox, Pager } from './ui.jsx';
const MOTIVOS = {sin_documento:'Sin documento',sin_bridge:'Sin registros en el Bridge',revision:'Bridge en revisión',parcial:'Conciliación parcial o con diferencia'};
const TIPOS = {material:'Material',trabajador:'Trabajador',cliente:'Cliente',concepto:'Concepto de factura',movimiento:'Movimiento bancario',documento:'Documento'};
export default function Conciliacion() {
  const vista='movimientos';
  const [q,setQ]=useState(''),[query,setQuery]=useState('');
  const [motivo,setMotivo]=useState(''),[desde,setDesde]=useState(''),[hasta,setHasta]=useState('');
  const [page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>{setQuery(q);setPage(1);},300);return()=>clearTimeout(t);},[q]);
  useEffect(()=>{
    let cancelled=false;setData(null);setError('');
    api.reconciliation({vista,q:query,motivo,desde,hasta,pagina:page,tam:25}).then(d=>{if(!cancelled)setData(d);},e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[vista,query,motivo,desde,hasta,page,reload]);
  const filter=(setter)=>(e)=>{setter(e.target.value);setPage(1);};
  return <div className="fin-stack">
    <div className="fin-card fin-filters">
      <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Beneficiario, ordenante, descripción o referencia" /></label>
      <label className="fin-field"><span>Motivo pendiente</span><select value={motivo} onChange={filter(setMotivo)}><option value="">Todos los motivos</option>{Object.entries(MOTIVOS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
      <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
      <button className="fin-btn" type="button" onClick={()=>setReload(n=>n+1)}>Actualizar</button>
    </div>
    <p>Movimientos bancarios sin documento conciliado, con enlaces en revisión o con importe pendiente. Cada movimiento aparece una sola vez, aunque tenga varios documentos.</p>
    <div className="fin-card is-flush">
      {error?<ErrorBox message={error} onRetry={()=>setReload(n=>n+1)} />:null}
      {!error&&!data?<div className="fin-loading">Cargando…</div>:null}
      {data&&!data.rows.length?<Empty icon="ri-checkbox-circle-line" title="Nada pendiente" text="No hay elementos pendientes de conciliación con estos filtros." />:null}
      {data&&data.rows.length?<><div className="fin-table-wrap"><table className="fin-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Tercero</th><th>Concepto / referencia</th><th>Documento</th><th className="fin-num">Importe</th><th className="fin-num">Conciliado</th><th className="fin-num">Pendiente</th><th className="fin-num">Enlaces Bridge</th><th>Motivo pendiente</th></tr></thead>
        <tbody>{data.rows.map(r=><tr key={r.type+':'+r.id}>
          <td className="fin-nowrap">{fecha(r.fecha)}</td><td>{TIPOS[r.type]||r.type}</td><td>{r.tercero||'—'}</td>
          <td className="fin-ellipsis is-wide" title={r.concepto||r.referencia}>{r.concepto||r.referencia||'—'}</td><td>{r.numerodocumento||(r.enlaces?'Sin número':'Sin documento')}</td>
          <td className="fin-num fin-nowrap">{eur(r.importe)}</td><td className="fin-num fin-nowrap">{eur(r.conciliado)}</td><td className="fin-num fin-nowrap">{eur(r.por_conciliar)}</td><td className="fin-num">{r.enlaces}</td>
          <td>{r.motivos.map(m=><div key={m}>{MOTIVOS[m]||m}</div>)}</td>
        </tr>)}</tbody>
      </table></div><Pager page={page} pageSize={25} total={data.total} onPage={setPage} /></>:null}
    </div>
  </div>;
}
