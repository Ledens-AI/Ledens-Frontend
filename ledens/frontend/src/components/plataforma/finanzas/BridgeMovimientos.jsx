import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {eur,fecha} from './format.js';
import {Empty,ErrorBox,Pager} from './ui.jsx';

const errors={case_changed:'El documento ha cambiado. Vuelve a seleccionarlo.',bank_changed:'El movimiento ha cambiado. Actualiza la lista.',insufficient_balance:'El importe supera el saldo disponible.',bank_is_worker_payment:'Este movimiento está reservado para pagos a trabajadores.',existing_allocation_requires_review:'El documento tiene un enlace en revisión que debe resolverse antes.',bank_reserved_for_review:'El movimiento tiene un enlace reservado para revisión.',ineligible_bank_movement:'El movimiento debe estar completado, en euros y no ser una transferencia interna.'};
const message=e=>errors[e.message]||e.message;
function Assignment({bank,onSaved,onCancel,onConflict}){
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
export default function BridgeMovimientos({pending=false,onChanged,toast,go}){
 const [q,setQ]=useState(''),[query,setQuery]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[active,setActive]=useState(null);
 useEffect(()=>{const t=setTimeout(()=>{setQuery(q);setPage(1);},250);return()=>clearTimeout(t);},[q]);
 useEffect(()=>{let gone=false;setData(null);setError('');setActive(null);const f={q:query,from,to,offset:(page-1)*25,limit:25};(pending?api.bridgeMovements(f):api.bridgeAllocations(f)).then(d=>{if(!gone)setData(d);},e=>{if(!gone)setError(message(e));});return()=>{gone=true;};},[pending,query,from,to,page,reload]);
 const saved=()=>{setActive(null);setReload(n=>n+1);onChanged?.();toast?.('Conciliación guardada. Los importes restantes siguen pendientes.');};
 return <div className="fin-stack">
  <div className="fin-card fin-filters"><label className="fin-field fin-grow"><span>Buscar</span><input type="search" placeholder="Documento, tercero o movimiento" value={q} onChange={e=>setQ(e.target.value)} /></label><label className="fin-field"><span>Desde</span><input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}} /></label><label className="fin-field"><span>Hasta</span><input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}} /></label><button className="fin-btn" onClick={()=>{setReload(n=>n+1);onChanged?.();}}>Actualizar</button><button className="fin-btn" onClick={()=>go(pending?'bridge':'pendiente-bridge')}>{pending?'Ver Bridge':'Resolver pendientes'}</button></div>
  {error?<ErrorBox message={error} onRetry={()=>setReload(n=>n+1)} />:null}
  {!data&&!error?<div className="fin-loading">Cargando…</div>:null}
  {data?<div className="fin-card is-flush">{!data.rows.length?<Empty title={pending?'Nada pendiente':'Sin enlaces'} text={pending?'No hay movimientos pendientes con estos filtros.':'Las conciliaciones guardadas aparecerán aquí.'} />:<><div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>Fecha bancaria</th><th>Movimiento</th><th>Documento</th>{!pending?<th>Tercero</th>:null}<th className="fin-num fin-nowrap">Importe bancario</th><th className="fin-num fin-nowrap">{pending?'Conciliado':'Importe del enlace'}</th>{pending?<th className="fin-num fin-nowrap">Pendiente</th>:<th>Estado</th>}<th>{pending?'Acción':'Origen / motivo'}</th></tr></thead><tbody>{data.rows.map(r=><React.Fragment key={r.id}><tr><td className="fin-nowrap">{fecha(r.completed_on)}</td><td>{r.description||r.reference||'—'}</td><td className="fin-nowrap">{pending?r.documents||'Sin documento':r.numerodocumento||'Sin número'}</td>{!pending?<td>{r.tercero||'—'}</td>:null}<td className="fin-num fin-nowrap">{eur(pending?r.total_amount:r.bank_total)}</td><td className="fin-num fin-nowrap">{eur(pending?r.confirmed:r.allocated_amount)}</td>{pending?<td className="fin-num fin-nowrap">{eur(r.remaining)}</td>:<td>{r.state}</td>}<td>{pending?<button className="fin-btn" disabled={r.state!=='COMPLETED'||r.currency!=='EUR'||Number(r.remaining)===0} onClick={()=>setActive(active===r.id?null:r.id)}>Asignar documento</button>:r.observaciones||'—'}</td></tr>{pending&&active===r.id?<tr><td colSpan={7}><Assignment bank={r} onSaved={saved} onCancel={()=>setActive(null)} onConflict={m=>{setActive(null);setReload(n=>n+1);onChanged?.();toast?.(m+' Selecciona de nuevo el movimiento y el documento.');}} /></td></tr>:null}</React.Fragment>)}</tbody></table></div><Pager page={page} pageSize={25} total={data.total} onPage={setPage} /></>}</div>:null}
 </div>;
}
