import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Dialog, Empty, ErrorBox, Pager } from './ui.jsx';
import { AssignCash, CashForm } from './Efectivo.jsx';
import ProjectPicker from './ProjectPicker.jsx';
const MOTIVOS = {sin_documento:'Sin documento',sin_bridge:'Sin registros en el Bridge',revision:'Bridge en revisión',parcial:'Conciliación parcial o con diferencia',efectivo:'Efectivo sin asignar'};
const TIPOS = {material:'Material',trabajador:'Trabajador',cliente:'Cliente',concepto:'Concepto de factura',movimiento:'Movimiento bancario',documento:'Documento',efectivo:'Efectivo'};
// Only outgoing movements (bank or cash) can be sent to «Pago a trabajadores»;
// incoming bank movements the Bridge did not recognise, to «Pago de clientes»
// (cash receipts have their own «Asignar»).
const payable=(r)=>(r.type==='movimiento'||r.type==='efectivo')&&Number(r.importe)<0;
const receivable=(r)=>r.type==='movimiento'&&Number(r.importe)>0;
const choosable=(r)=>payable(r)||receivable(r);

// Pago de clientes: an optional obra for all the selected receipts.
function ClientesDialog({ count, total, busy, onClose, onConfirm }) {
  const [project, setProject] = useState(null);
  return (
    <Dialog title="Registrar como pago de clientes" onClose={() => !busy && onClose()} actions={<>
      <button type="button" className="fin-btn is-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" disabled={busy} onClick={() => onConfirm(project?.id || null)}>{busy ? 'Registrando…' : 'Registrar'}</button></>}>
      <p>{count === 1
        ? `El cobro seleccionado (${eur(total)}) se registrará en «Pagos de clientes», con el ordenante como cliente, y saldrá de esta lista.`
        : `Los ${count} cobros seleccionados (${eur(total)}) se registrarán en «Pagos de clientes», con el ordenante como cliente, y saldrán de esta lista.`}</p>
      <div className="fin-field"><span>Obra (opcional)</span><ProjectPicker value={project} onChange={setProject} label="Obra" /></div>
      <p className="fin-muted fin-small">{project ? 'Se imputarán enteros a esta obra.' : 'Sin obra quedarán en Pendientes de asignación.'} Si después llega la factura emitida, se podrá conciliar con el cobro en el Bridge.</p>
    </Dialog>
  );
}
export default function Conciliacion({ toast,go,onChanged }) {
  const vista='movimientos';
  const [q,setQ]=useState(''),[query,setQuery]=useState('');
  const [motivo,setMotivo]=useState(''),[desde,setDesde]=useState(''),[hasta,setHasta]=useState('');
  const [page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [selected,setSelected]=useState(()=>new Set()),[moving,setMoving]=useState(false),[failures,setFailures]=useState([]);
  useEffect(()=>{const t=setTimeout(()=>{setQuery(q);setPage(1);},300);return()=>clearTimeout(t);},[q]);
  useEffect(()=>{
    let cancelled=false;setData(null);setError('');
    api.reconciliation({vista,q:query,motivo,desde,hasta,pagina:page,tam:25}).then(d=>{if(!cancelled)setData(d);},e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[vista,query,motivo,desde,hasta,page,reload]);
  const filter=(setter)=>(e)=>{setter(e.target.value);setPage(1);};
  useEffect(()=>{setSelected(new Set());},[query,motivo,desde,hasta,page]);
  const [adding,setAdding]=useState(false),[assigning,setAssigning]=useState(null);
  const drop=(id)=>{setData(d=>d&&({...d,total:Math.max(0,d.total-1),rows:d.rows.filter(r=>r.id!==id)}));setSelected(s=>{const n=new Set(s);n.delete(id);return n;});};
  const removeCash=async(r)=>{
    if(!window.confirm(`¿Eliminar el ${Number(r.importe)<0?'pago':'cobro'} en efectivo de ${eur(Math.abs(r.importe))}?`))return;
    try{await api.deleteCash(r.id);drop(r.id);toast?.('Efectivo eliminado.');}catch(e){toast?.(e.message);}
  };
  const DEST={trabajadores:'Pendiente de trabajador',materiales:'Pagos de materiales',clientes:'Pagos de clientes'};
  const toggle=(id)=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectable=(data?.rows||[]).filter(choosable);
  const allOn=selectable.length>0&&selectable.every(r=>selected.has(r.id));
  // What the selection is: only payments, only receipts, or both (no action fits).
  const chosen=(data?.rows||[]).filter(r=>selected.has(r.id));
  const onlyPayments=chosen.length>0&&chosen.every(payable),onlyReceipts=chosen.length>0&&chosen.every(receivable);
  const [clientes,setClientes]=useState(false);
  // Sends the selection: the ones the server accepts leave this list at once;
  // the refused ones stay selected with the reason.
  const send=async(call,dest)=>{
    setMoving(true);setFailures([]);
    try{
      const res=await call([...selected]);
      const moved=new Set(res.results.filter(r=>r.ok).map(r=>r.id));
      setData(d=>d&&({...d,total:Math.max(0,d.total-moved.size),rows:d.rows.filter(r=>!moved.has(r.id))}));
      setSelected(new Set(res.results.filter(r=>!r.ok).map(r=>r.id)));
      setFailures(res.results.filter(r=>!r.ok));
      if(moved.size)onChanged?.();
      if(moved.size)toast?.(moved.size===1?`Movimiento enviado a ${dest}.`:`${moved.size} movimientos enviados a ${dest}.`);
    }catch(e){toast?.(e.message);}finally{setMoving(false);setClientes(false);}
  };
  const toWorkers=()=>send(ids=>api.classifyWorkerPayments(ids),'Pendiente de trabajador');
  const toClients=(projectId)=>send(ids=>api.classifyCustomerPayments(ids,projectId),'Pagos de clientes');
  return <div className="fin-stack">
    <div className="fin-card fin-filters">
      <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Beneficiario, ordenante, descripción o referencia" /></label>
      <label className="fin-field"><span>Motivo pendiente</span><select value={motivo} onChange={filter(setMotivo)}><option value="">Todos los motivos</option>{Object.entries(MOTIVOS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
      <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
      <button className="fin-btn" type="button" onClick={()=>setReload(n=>n+1)}>Actualizar</button>
      <button className="fin-btn is-primary" type="button" onClick={()=>go?.('pendiente-bridge')}>Resolver Bridge</button>
      <button className="fin-btn is-primary" type="button" onClick={()=>setAdding(true)}><i className="ri-money-euro-circle-line"></i>Añadir efectivo</button>
    </div>
    {adding?<CashForm onClose={()=>setAdding(false)} onSaved={(k)=>{setAdding(false);setReload(n=>n+1);toast?.(k.kind==='pago'?'Pago en efectivo añadido.':'Cobro en efectivo añadido.');}} />:null}
    {assigning?<AssignCash row={assigning} onClose={()=>setAssigning(null)} onDone={(t)=>{drop(assigning.id);setAssigning(null);toast?.('Efectivo enviado a '+DEST[t]+'.');}} />:null}
    {selected.size?<div className="fin-bulkbar" role="region" aria-label="Acciones sobre la selección">
      <strong>{selected.size===1?'1 movimiento seleccionado':selected.size+' movimientos seleccionados'}</strong>
      <span className="fin-muted">{eur((data?.rows||[]).filter(r=>selected.has(r.id)).reduce((a,r)=>a+Number(r.importe),0))}</span>
      <span className="fin-grow"></span>
      {!onlyPayments&&!onlyReceipts?<span className="fin-muted fin-small">Has elegido pagos y cobros: selecciona solo pagos (trabajadores) o solo cobros (clientes).</span>:null}
      <button type="button" className="fin-btn is-primary" disabled={moving||!onlyPayments} onClick={toWorkers}><i className="ri-user-follow-line"></i>{moving?'Enviando…':'Pago a trabajadores'}</button>
      <button type="button" className="fin-btn is-primary" disabled={moving||!onlyReceipts} onClick={()=>setClientes(true)}><i className="ri-hand-coin-line"></i>Pago de clientes</button>
      <button type="button" className="fin-btn is-ghost" disabled={moving} onClick={()=>setSelected(new Set())}>Quitar selección</button>
    </div>:null}
    {clientes?<ClientesDialog count={chosen.length} total={chosen.reduce((a,r)=>a+Number(r.importe),0)} busy={moving} onClose={()=>setClientes(false)} onConfirm={toClients} />:null}
    {failures.length?<div className="fin-warn"><i className="ri-alert-line"></i><span>{failures.length===1?'1 movimiento no se ha podido enviar: ':failures.length+' movimientos no se han podido enviar: '}{failures.map(f=>f.error).filter((x,i,a)=>a.indexOf(x)===i).join(' · ')}</span></div>:null}
    <p>Movimientos bancarios sin documento conciliado, con enlaces en revisión o con importe pendiente, y pagos o cobros en efectivo sin asignar. Cada movimiento aparece una sola vez, aunque tenga varios documentos.</p>
    <div className="fin-card is-flush">
      {error?<ErrorBox message={error} onRetry={()=>setReload(n=>n+1)} />:null}
      {!error&&!data?<div className="fin-loading">Cargando…</div>:null}
      {data&&!data.rows.length?<Empty icon="ri-checkbox-circle-line" title="Nada pendiente" text="No hay elementos pendientes de conciliación con estos filtros." />:null}
      {data&&data.rows.length?<><div className="fin-table-wrap"><table className="fin-table">
        <thead><tr><th className="fin-col-check"><input type="checkbox" aria-label="Seleccionar los movimientos de esta página" disabled={!selectable.length} checked={allOn} onChange={()=>setSelected(s=>{const n=new Set(s);selectable.forEach(r=>allOn?n.delete(r.id):n.add(r.id));return n;})} /></th><th>Fecha</th><th>Tipo</th><th>Tercero</th><th>Concepto / referencia</th><th>Documento</th><th className="fin-num">Importe</th><th className="fin-num">Conciliado</th><th className="fin-num">Pendiente</th><th className="fin-num">Enlaces Bridge</th><th>Motivo pendiente</th><th><span className="fin-sr">Acciones</span></th></tr></thead>
        <tbody>{data.rows.map(r=><tr key={r.type+':'+r.id} className={selected.has(r.id)?'is-selected':''}>
          <td className="fin-col-check">{choosable(r)?<input type="checkbox" aria-label="Seleccionar movimiento" checked={selected.has(r.id)} onChange={()=>toggle(r.id)} />:null}</td>
          <td className="fin-nowrap">{fecha(r.fecha)}</td><td>{TIPOS[r.type]||r.type}</td><td>{r.tercero||'—'}</td>
          <td className="fin-ellipsis is-wide" title={r.concepto||r.referencia}>{r.concepto||r.referencia||'—'}</td><td>{r.type==='efectivo'?'—':r.numerodocumento||(r.enlaces?'Sin número':'Sin documento')}</td>
          <td className="fin-num fin-nowrap">{eur(r.importe)}</td><td className="fin-num fin-nowrap">{eur(r.conciliado)}</td><td className="fin-num fin-nowrap">{eur(r.por_conciliar)}</td><td className="fin-num">{r.enlaces}</td>
          <td>{r.motivos.map(m=><div key={m}>{MOTIVOS[m]||m}</div>)}</td>
          <td>{r.type==='efectivo'?<div className="fin-cash-actions">
            <button type="button" className="fin-btn" onClick={()=>setAssigning(r)}>Asignar</button>
            <button type="button" className="fin-iconbtn" title="Eliminar efectivo" aria-label="Eliminar efectivo" onClick={()=>removeCash(r)}><i className="ri-delete-bin-line"></i></button>
          </div>:null}</td>
        </tr>)}</tbody>
      </table></div><Pager page={page} pageSize={25} total={data.total} onPage={setPage} /></>:null}
    </div>
  </div>;
}
