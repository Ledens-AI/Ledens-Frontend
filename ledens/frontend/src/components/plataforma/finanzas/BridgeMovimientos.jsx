import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {eur,fecha} from './format.js';
import {Empty,ErrorBox,Pager} from './ui.jsx';
import {IdFields,useIdFilters} from './idFilters.jsx';

const errors={case_changed:'El documento ha cambiado. Vuelve a seleccionarlo.',bank_changed:'El movimiento ha cambiado. Actualiza la lista.',insufficient_balance:'El importe supera el saldo disponible.',bank_is_worker_payment:'Este movimiento está reservado para pagos a trabajadores.',existing_allocation_requires_review:'El documento tiene un enlace en revisión que debe resolverse antes.',bank_reserved_for_review:'El movimiento tiene un enlace reservado para revisión.',ineligible_bank_movement:'El movimiento debe estar completado, en euros y no ser una transferencia interna.'};
export const message=e=>errors[e.message]||e.message;
// «Asignar documento»: used by Pendiente de conciliación on each bank movement.
export function Assignment({bank,onSaved,onCancel,onConflict}){
 const [q,setQ]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState('');
 const [document,setDocument]=useState(null),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[reload,setReload]=useState(0);
 // Keep the same request id on retry after a lost response; changing the form creates a new one.
 const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
 useEffect(()=>{const t=setTimeout(()=>{setQuery(q);setPage(1);},250);return()=>clearTimeout(t);},[q]);
 useEffect(()=>{let gone=false;setData(null);api.bridgeDocuments(bank.id,{q:query,offset:(page-1)*10,limit:10}).then(d=>{if(!gone)setData(d);},e=>{if(!gone)setError(message(e));});return()=>{gone=true;};},[bank.id,query,page,reload]);
 const choose=d=>{setDocument(d);setAmount(Math.min(Math.abs(Number(bank.remaining)),Number(d.remaining)).toFixed(2));setRequestId(crypto.randomUUID());setError('');};
 const save=async()=>{
  setSaving(true);setError('');
  try{await api.bridgeConfirm(document.id,{bank_movement_id:bank.id,amount:amount.replace(',','.'),currency:'EUR',tipo:Number(bank.total_amount)<0?'Pagar':'Cobrar',reason,version:document.version,document_fingerprint:document.document_fingerprint,bank_fingerprint:bank.bank_fingerprint,request_id:requestId});onSaved();}
  catch(e){setError(message(e));if(e.status===409){setDocument(null);setReload(n=>n+1);onConflict?.(message(e));}}
  finally{setSaving(false);}
 };
 return <section className="fin-stack" aria-label="Asignar documento existente" style={{padding:20}}>
  <strong>Documento para {bank.description||bank.reference||'este movimiento'} · {eur(bank.remaining)} pendientes</strong>
  <label className="fin-field"><span>Buscar documento existente</span><input type="search" value={q} disabled={saving} onChange={e=>setQ(e.target.value)} placeholder="Número de documento, cliente o proveedor" /></label>
  {error?<ErrorBox message={error} />:null}
  {!data?<div className="fin-loading">Buscando documentos…</div>:!data.rows.length?<Empty title="Sin documentos disponibles" text="Prueba otro número, cliente o proveedor. Los documentos completamente conciliados no aparecen." />:<>
   <div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>Seleccionar</th><th>Documento</th><th>Fecha</th><th>Tercero</th><th className="fin-num fin-nowrap">Importe</th><th className="fin-num fin-nowrap">Disponible</th></tr></thead><tbody>{data.rows.map(d=><tr key={d.id} className={document?.id===d.id?'is-selected':''}><td><input type="radio" name={'document-'+bank.id} aria-label={'Seleccionar '+(d.numerodocumento||'documento sin número')} checked={document?.id===d.id} disabled={saving} onChange={()=>choose(d)} /></td><td>{d.numerodocumento||'Sin número'}</td><td>{fecha(d.document_on)}</td><td>{d.tercero||'—'}</td><td className="fin-num fin-nowrap">{eur(d.total)}</td><td className="fin-num fin-nowrap">{eur(d.remaining)}</td></tr>)}</tbody></table></div>
   <Pager page={page} pageSize={10} total={data.total} onPage={n=>{if(!saving)setPage(n);}} />
  </>}
  {document?<><p>Se vinculará <strong>{document.numerodocumento||'el documento seleccionado'}</strong> como {Number(bank.total_amount)<0?'pago':'cobro'}. El importe es positivo en este formulario; el sistema conserva el signo bancario.</p>
   {document.tipo!==(Number(bank.total_amount)<0?'Pagar':'Cobrar')||Math.sign(Number(document.total))!==Math.sign(Number(bank.total_amount))?<div className="fin-warn">Al guardar se corregirá el sentido del documento para que corresponda a este {Number(bank.total_amount)<0?'pago':'cobro'}. El cambio quedará auditado.</div>:null}
   <label className="fin-field"><span>Importe a conciliar (€)</span><input inputMode="decimal" value={amount} disabled={saving} onChange={e=>{setAmount(e.target.value);setRequestId(crypto.randomUUID());}} /></label>
   <label className="fin-field"><span>Motivo de la asignación</span><input value={reason} maxLength={1000} disabled={saving} onChange={e=>{setReason(e.target.value);setRequestId(crypto.randomUUID());}} placeholder="Por ejemplo: el pagador es un familiar del cliente" /></label></>:null}
  <div><button className="fin-btn is-primary" type="button" onClick={save} disabled={!document||saving||reason.trim().length<5||!/^\d+(?:[.,]\d{1,2})?$/.test(amount)||Number(amount.replace(',','.'))<=0}>{saving?'Guardando…':'Guardar'}</button>{' '}<button className="fin-btn" disabled={saving} onClick={onCancel} type="button">Cancelar</button></div>
 </section>;
}
/* Bridge Movimientos Documentos: the saved links between movements and
 * documents. Pending movements are resolved in «Pendiente de conciliación». */
export default function BridgeMovimientos({go}){
 const [q,setQ]=useState(''),[query,setQuery]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{const t=setTimeout(()=>{setQuery(q);setPage(1);},250);return()=>clearTimeout(t);},[q]);
 const idf=useIdFilters(()=>setPage(1)),ids=idf.ids;
 useEffect(()=>{let gone=false;setData(null);setError('');api.bridgeAllocations({q:query,...ids,from,to,offset:(page-1)*25,limit:25}).then(d=>{if(!gone)setData(d);},e=>{if(!gone)setError(message(e));});return()=>{gone=true;};},[query,ids,from,to,page,reload]);
 return <div className="fin-stack">
  <div className="fin-card fin-filters"><label className="fin-field fin-grow"><span>Buscar</span><input type="search" placeholder="Documento, tercero, movimiento o ID" value={q} onChange={e=>setQ(e.target.value)} /></label><IdFields f={idf} /><label className="fin-field"><span>Desde</span><input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}} /></label><label className="fin-field"><span>Hasta</span><input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}} /></label><button className="fin-btn" onClick={()=>setReload(n=>n+1)}>Actualizar</button><button className="fin-btn" onClick={()=>go('conciliacion')}>Resolver pendientes</button></div>
  {error?<ErrorBox message={error} onRetry={()=>setReload(n=>n+1)} />:null}
  {!data&&!error?<div className="fin-loading">Cargando…</div>:null}
  {data?<div className="fin-card is-flush">{!data.rows.length?<Empty title="Sin enlaces" text="Las conciliaciones guardadas aparecerán aquí." />:<><div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>Fecha bancaria</th><th>MovimientoID</th><th>Movimiento</th><th>DocumentoID</th><th>Documento</th><th>Tercero</th><th className="fin-num fin-nowrap">Importe bancario</th><th className="fin-num fin-nowrap">Importe del enlace</th><th>Estado</th><th>Origen / motivo</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.id}><td className="fin-nowrap">{fecha(r.completed_on)}</td><td className="fin-nowrap">{r.movimientoid||'—'}</td><td>{r.description||r.reference||'—'}</td><td className="fin-nowrap">{r.documentoid||'—'}</td><td className="fin-nowrap">{r.numerodocumento||'Sin número'}</td><td>{r.tercero||'—'}</td><td className="fin-num fin-nowrap">{eur(r.bank_total)}</td><td className="fin-num fin-nowrap">{eur(r.allocated_amount)}</td><td>{r.state}</td><td>{r.observaciones||'—'}</td></tr>)}</tbody></table></div><Pager page={page} pageSize={25} total={data.total} onPage={setPage} /></>}</div>:null}
 </div>;
}
