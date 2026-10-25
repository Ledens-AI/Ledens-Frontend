// Spanish UI facade: never writes source project_id or a parallel money ledger.
import {createHash} from 'node:crypto';
import {FinanceService,FinanceError,uuid} from '../finance/service.js';
import {cents,decimal} from '../bridge/rules.js';
export class FinError extends FinanceError {constructor(status,message,extra){super(status,message);this.extra=extra;}}
export const isUuid=uuid;
export const TYPES={material:{label:'Material'},trabajador:{label:'Trabajador'},cliente:{label:'Cliente'},concepto:{label:'Concepto de factura'}};
export const STATES=['pendiente','asignado','parcial','revision'];
const SCOPE=`($1 OR (NOT EXISTS(SELECT 1 FROM ledens.project_financial_allocations ax WHERE ax.record_id=f.id AND NOT EXISTS
 (SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=ax.project_id)) AND
 (EXISTS(SELECT 1 FROM ledens.project_financial_allocations ax WHERE ax.record_id=f.id) OR
 EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id IS NULL AND fp.can_review_unassigned))))`;
const BASE=`WITH base AS (
 SELECT f.id record_id,coalesce(f.material_id,f.worker_payment_id,f.customer_payment_id,f.invoice_line_id) id,
 CASE WHEN f.material_id IS NOT NULL THEN 'material' WHEN f.worker_payment_id IS NOT NULL THEN 'trabajador' WHEN f.customer_payment_id IS NOT NULL THEN 'cliente' ELSE 'concepto' END type,
 f.version,f.status accounting_status,f.category,f.occurred_on fecha,f.gross_amount importe,f.document_id,f.bank_movement_id,
 coalesce(f.counterparty,d.tercero,to_jsonb(w)->>'empleado',to_jsonb(c)->>'cliente') tercero,
 coalesce(f.description,to_jsonb(m)->>'description',to_jsonb(w)->>'categoria',d.numerodocumento) concepto,
 to_jsonb(m)->>'quantity' quantity,to_jsonb(m)->>'und' unidad,to_jsonb(m)->>'unit_price' unit_price,
 d.numerodocumento,d.tipo doc_tipo,coalesce(a.allocated,0) allocated,coalesce(a.n,0) allocation_count,
 CASE WHEN a.n=1 AND a.allocated=f.gross_amount THEN a.project_id END project_id,
 CASE WHEN a.n=1 AND a.allocated=f.gross_amount THEN a.project_label END project_label,
 CASE WHEN a.n=1 AND a.allocated=f.gross_amount THEN 0 ELSE coalesce(a.n,0) END parts,
 coalesce(rv.needs_review,false) needs_review,rv.review_note,abs(f.gross_amount)>coalesce(a.used,0) sin_proyecto,
 CASE ws.role WHEN 'oficial' THEN 'Oficial' WHEN 'ayudante' THEN 'Ayudante' ELSE po.name END rol
 FROM ledens.financial_records f LEFT JOIN ledens.documents d ON d.id=f.document_id
 LEFT JOIN ledens.material_expenses m ON m.id=f.material_id LEFT JOIN ledens.worker_payments w ON w.id=f.worker_payment_id
 LEFT JOIN ledens.worker_payment_splits ws ON ws.worker_payment_id=f.worker_payment_id
 LEFT JOIN ledens.employees em ON em.id=(to_jsonb(w)->>'employee_id')::uuid LEFT JOIN ledens.positions po ON po.id=em.primary_position_id
 LEFT JOIN ledens.customer_payments c ON c.id=f.customer_payment_id
 LEFT JOIN ledens.finance_review_flags rv ON rv.record_id=f.id
 LEFT JOIN LATERAL(SELECT sum(pa.allocated_amount) allocated,sum(abs(pa.allocated_amount)) used,count(*)::int n,
  (array_agg(pa.project_id))[1] project_id,(array_agg(pr.name))[1] project_label FROM ledens.project_financial_allocations pa
  JOIN ledens.projects pr ON pr.id=pa.project_id WHERE pa.record_id=f.id) a ON true WHERE ${SCOPE} AND f.source_valid AND f.status<>'excluded'
), listed AS(SELECT b.*,CASE WHEN needs_review THEN 'revision' WHEN NOT sin_proyecto THEN 'asignado' WHEN allocation_count>0 THEN 'parcial' ELSE 'pendiente' END estado FROM base b)`;
const labels={replace_allocations:'Asignación a proyecto',recognition:'Validación contable',review_flag:'Revisión',source_changed:'Origen actualizado',document_changed:'Factura actualizada'};
const requestFor=(seed,key)=>{const h=createHash('sha256').update(seed+'|'+key).digest('hex').slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
// Pago a trabajadores: how a paid amount (absolute, in cents) is split.
// Above 450 € → Oficial lines of 100 €; 450 € or less → Ayudante lines of 60 €.
// The last line carries whatever does not make a whole unit, so the lines
// always add up to the bank movement.
export const WORKER_SPLIT={threshold:45000n,oficial:10000n,ayudante:6000n,maxLines:200};
export function splitWorkerPayment(total){
 if(typeof total!=='bigint'||total<=0n)throw new FinError(400,'Importe no válido');
 const role=total>WORKER_SPLIT.threshold?'oficial':'ayudante',unit=WORKER_SPLIT[role];
 const lines=Array.from({length:Number(total/unit)},()=>unit);if(total%unit)lines.push(total%unit);
 if(lines.length>WORKER_SPLIT.maxLines)throw new FinError(409,`Importe demasiado alto para segregar automáticamente (más de ${WORKER_SPLIT.maxLines} pagos)`);
 return {role,unit,lines};
}
export function safeDocumentUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&/(^|\.)sharepoint\.com$/i.test(u.hostname)?u.href:null;}catch{return null;}}
export class FinanzasService {
 constructor(pool,user={role:'client',id:null}){this.pool=pool;this.user=user;this.finance=new FinanceService(pool);}
 params(){if(this.user.role==='client')throw new FinError(403,'No tienes acceso a las finanzas');return [this.user.role==='admin',this.user.id];}
 query(sql,params=[]){return this.pool.query(sql,params);}
 async listProjects({q='',limit=30,ids}={}){
  return (await this.query(`SELECT p.id,p.name label,p.project_id code,p.address,to_jsonb(p)->>'municipio' municipio,
   to_jsonb(p)->>'customer_name_source' cliente FROM ledens.projects p WHERE
   ($1 OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=p.id))
   AND concat_ws(' ',p.name,p.project_id,p.address,to_jsonb(p)->>'customer_name_source') ILIKE $3
   AND ($5::uuid[] IS NULL OR p.id=ANY($5)) ORDER BY p.name,p.id LIMIT $4`,[...this.params(),'%'+q+'%',Math.min(100,Math.max(1,Number(limit)||30)),ids||null])).rows;
 }
 filters(f){
  const params=this.params(),where=[];const bind=v=>{params.push(v);return '$'+params.length;};
  if(f.type){if(!TYPES[f.type])throw new FinError(400,'Tipo no válido');const t=bind(f.type);const category={material:'materials',trabajador:'labor',cliente:'revenue'}[f.type];where.push(category?`(l.type=${t} OR (l.type='concepto' AND l.category=${bind(category)}))`:'l.type='+t);}
  if(f.pending)where.push('l.sin_proyecto');
  if(f.estado){if(!STATES.includes(f.estado))throw new FinError(400,'Estado no válido');where.push('l.estado='+bind(f.estado));}
  if(f.project){if(!uuid(f.project))throw new FinError(400,'Proyecto no válido');where.push(`EXISTS(SELECT 1 FROM ledens.project_financial_allocations pa WHERE pa.record_id=l.record_id AND pa.project_id=${bind(f.project)})`);}
  if(f.q)where.push(`concat_ws(' ',l.tercero,l.concepto,l.numerodocumento) ILIKE ${bind('%'+f.q+'%')}`);
  for(const [key,op] of [['from','>='],['to','<=']])if(f[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(f[key]))throw new FinError(400,'Fecha no válida');where.push(`l.fecha ${op} ${bind(f[key])}::date`);}
  for(const [key,op] of [['min','>='],['max','<=']])if(f[key]!==undefined&&f[key]!==''){if(cents(f[key])===null)throw new FinError(400,'Importe no válido');where.push(`abs(l.importe) ${op} abs(${bind(f[key])}::numeric)`);}
  return {params,where:where.length?'WHERE '+where.join(' AND '):''};
 }
 async listRecords(f={}){
  const {params,where}=this.filters(f);const sorts={fecha:'fecha',importe:'importe',tercero:'tercero',concepto:'concepto',tipo:'type',estado:'estado'};
  const page=Math.max(1,Math.min(4000,Number(f.page)||1)),pageSize=Math.max(1,Math.min(100,Number(f.pageSize)||25));
  if(!Number.isInteger(page)||!Number.isInteger(pageSize))throw new FinError(400,'Paginación no válida');
  const rows=(await this.query(`${BASE} SELECT l.* FROM listed l ${where} ORDER BY l.${sorts[f.sort]||'fecha'} ${f.dir==='asc'?'ASC':'DESC'} NULLS LAST,l.id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`,params)).rows;
  const t=(await this.query(`${BASE} SELECT count(*)::int n,coalesce(sum(importe),0)::text importe FROM listed l ${where}`,params)).rows[0];
  return {rows,total:t.n,totalImporte:t.importe,page,pageSize};
 }
 async pendingSummary(){
  const rows=(await this.query(`${BASE} SELECT type,count(*)::int total,count(*) FILTER(WHERE sin_proyecto)::int pendientes,
   coalesce(sum(abs(importe-allocated)) FILTER(WHERE sin_proyecto),0)::text importe_pendiente,
   count(*) FILTER(WHERE needs_review)::int revision FROM listed GROUP BY type`,this.params())).rows;
  const porTipo=Object.fromEntries(Object.keys(TYPES).map(t=>[t,{total:0,pendientes:0,revision:0,importe_pendiente:'0'}]));for(const r of rows)porTipo[r.type]=r;
  return {porTipo,total:rows.reduce((s,r)=>s+r.total,0),pendientes:rows.reduce((s,r)=>s+r.pendientes,0),revision:rows.reduce((s,r)=>s+r.revision,0),importePendiente:decimal(rows.reduce((s,r)=>s+cents(r.importe_pendiente),0n))};
 }
 async source(type,id){if(!TYPES[type]||!uuid(id))throw new FinError(404,'Registro no encontrado');const r=(await this.query(`${BASE} SELECT * FROM listed WHERE type=$3 AND id=$4`,[...this.params(),type,id])).rows[0];if(!r)throw new FinError(404,'Registro no encontrado o sin permiso');return r;}
 async history(type,id){const r=await this.source(type,id);const events=await this.finance.history(this.user,r.record_id);const ids=[...new Set(events.map(e=>e.actor_id).filter(Boolean))];const names=ids.length?(await this.query('SELECT id,coalesce(name,email) label FROM users WHERE id=ANY($1::uuid[])',[ids])).rows:[];return events.map(e=>({id:e.id,at:e.created_at,actor_label:names.find(n=>n.id===e.actor_id)?.label||'Sistema',origin:e.actor_id?'manual':'automatica',action:labels[e.action]||e.action,reason:e.reason,old_allocations:e.before_value.allocations,new_allocations:e.after_value.allocations,old_label:e.before_value.allocations?.length===1?e.before_value.allocations[0].project_name:undefined,new_label:e.after_value.allocations?.length===1?e.after_value.allocations[0].project_name:undefined}));}
 async recentActivity(limit=15){return (await this.query(`${BASE} SELECT e.id,e.created_at at,coalesce(u.name,u.email,'Sistema') actor_label,
  'manual'::text origin,e.action,e.reason,l.type source_type,l.id source_id FROM ledens.finance_events e JOIN listed l ON l.record_id=e.record_id
  LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT $3`,[...this.params(),Math.min(50,Math.max(1,Number(limit)||15))])).rows;}
 async getRecord(type,id){
  const r=await this.source(type,id);const full=await this.finance.record(this.pool,r.record_id,this.user);let documento=full.document;
  if(documento){documento={...documento,archivo:safeDocumentUrl(documento.enlacearchivo)};delete documento.enlacearchivo;}
  let movimiento=null;if(r.bank_movement_id&&this.user.role==='admin')movimiento=(await this.query(`SELECT b.id,b.source_id,b.completed_on,b.description,b.reference,b.payer,b.beneficiary_name,b.total_amount,b.currency,
   (SELECT coalesce(sum(a.allocated_amount),0) FROM ledens.bank_document_allocations a WHERE a.bank_movement_id=b.id AND a.state='Confirmado') confirmed_allocated,
   b.total_amount-(SELECT coalesce(sum(a.allocated_amount),0) FROM ledens.bank_document_allocations a WHERE a.bank_movement_id=b.id AND a.state='Confirmado') difference,
   (SELECT count(*) FROM ledens.bank_document_allocations a WHERE a.bank_movement_id=b.id) document_links FROM ledens.bank_movements b WHERE b.id=$1`,[r.bank_movement_id])).rows[0];
  const suggestion=full.suggestions.length===1?{projectId:full.suggestions[0].project_id,label:full.suggestions[0].project_name,reason:full.suggestions[0].evidence}:undefined;
  return {...r,typeLabel:TYPES[type].label,documento,movimiento,distribucion:r.project_id?[]:full.allocations.map(a=>({project_id:a.project_id,label:a.project_name,amount:a.allocated_amount})),historial:await this.history(type,id),suggestion};
 }
 reason(r,reason,version){if(r.version===version&&(r.project_id||r.parts)&&(!reason||reason.trim().length<5))throw new FinError(400,'Escribe un motivo de al menos cinco caracteres');return reason?.trim()||'Asignación confirmada en gestión financiera';}
 async assign({type,id,projectId,version,requestId,reason}){
  const r=await this.source(type,id);if(!Number.isInteger(version)||!uuid(requestId))throw new FinError(400,'Recarga el registro antes de asignarlo');
  await this.finance.bulk(this.user,{request_id:requestId,reason:this.reason(r,reason,version),records:[{record_id:r.record_id,version,allocations:projectId===null?[]:[{project_id:projectId,amount:r.importe}]}]});return {changed:true};
 }
 async distribute({type,id,parts,version,requestId,reason}){
  const r=await this.source(type,id);if(!Array.isArray(parts)||!parts.length||!Number.isInteger(version)||!uuid(requestId))throw new FinError(400,'Distribución no válida; recarga el registro');
  await this.finance.bulk(this.user,{request_id:requestId,reason:this.reason(r,reason,version),records:[{record_id:r.record_id,version,allocations:parts.map(p=>({project_id:p.projectId,amount:p.amount}))}]});
  return {changed:true,exact:parts.reduce((s,p)=>s+cents(p.amount),0n)===cents(r.importe)};
 }
 async setReview({type,id,needsReview,note,version}){
  if(typeof needsReview!=='boolean'||!Number.isInteger(version))throw new FinError(400,'Revisión no válida');const r=await this.source(type,id);
  return this.finance.transaction(async c=>{const before=await this.finance.record(c,r.record_id,this.user,true);if(before.version!==version)throw new FinError(409,'El registro ha cambiado; recarga');
   await c.query(`INSERT INTO ledens.finance_review_flags(record_id,needs_review,review_note,updated_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(record_id) DO UPDATE SET needs_review=excluded.needs_review,review_note=excluded.review_note,updated_by=excluded.updated_by,updated_at=now()`,[r.record_id,needsReview,note||null,this.user.id]);
   await c.query('UPDATE ledens.financial_records SET version=version+1,updated_at=now() WHERE id=$1',[r.record_id]);
   await this.finance.audit(c,before,this.user,'review_flag',note||'Cambio de marca de revisión',{needsReview,note});return {changed:true};});
 }
 async bulk({items,action,projectId,reason,note,requestId}){
  if(!Array.isArray(items)||!items.length||items.length>100||!['assign','review'].includes(action)||!uuid(requestId))throw new FinError(400,'Lote no válido (máximo 100 registros)');
  const results=[];for(const item of items){try{const value=action==='assign'?await this.assign({...item,projectId,reason,requestId:requestFor(requestId,item.type+'|'+item.id)}):await this.setReview({...item,needsReview:true,note});results.push({...item,ok:true,...value});}catch(e){if(!(e instanceof FinanceError))throw e;results.push({...item,ok:false,error:e.message});}}
  return {results,ok:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
 }
 async automaticImputation(){return {applied:false,suggested:false,reason:'Project evidence is reviewed by the canonical engine'};}
 async profitability(projectId){
  const s=await this.finance.summary(this.user,projectId);const [project]=await this.listProjects({ids:[projectId]});const monthly=await this.finance.evolution(this.user,projectId,{limit:100});
  const counts=(await this.query(`${BASE} SELECT l.type,count(*)::int n FROM listed l WHERE EXISTS(SELECT 1 FROM ledens.project_financial_allocations a WHERE a.record_id=l.record_id AND a.project_id=$3) GROUP BY l.type`,[...this.params(),projectId])).rows;
  const derived=(await this.query("SELECT ($1::numeric-$2::numeric)::text margin,CASE WHEN $1::numeric<>0 THEN (($1::numeric-$2::numeric)/$1::numeric*100)::text END pct,CASE WHEN $1::numeric<>0 THEN ($2::numeric/$1::numeric*100)::text END consumed",[s.budget,s.direct_cost])).rows[0];
  const registros=Object.fromEntries(Object.keys(TYPES).map(t=>[t,counts.find(r=>r.type===t)?.n||0]));
  return {project,kpis:{presupuesto:s.budget,materiales:s.material_cost,trabajadores:s.labor_cost,costeTotal:s.direct_cost,cobros:s.collections,pagos:s.payments,flujoCaja:s.net_cash_flow,
   ingresosReconocidos:s.recognized_revenue,resultadoDirecto:s.direct_result,margenDirectoPct:s.direct_margin_percent,cobrosPendientes:s.pending_collections,pagosPendientes:s.pending_payments,pendientesRevision:s.pending_review,
   margenPrevisto:derived.margin,margenPrevistoPct:derived.pct,consumoPresupuestoPct:derived.consumed,registros,distribucionesParciales:0},
   presupuesto:{lineas:null,versionesAceptadas:null},costesPorCategoria:[{type:'material',categoria:'Materiales',importe:s.material_cost},{type:'trabajador',categoria:'Mano de obra',importe:s.labor_cost},{type:'material',categoria:'Subcontratas',importe:s.subcontract_cost},{type:'material',categoria:'Otros costes directos',importe:s.other_direct_cost}],
   presupuestoVsCoste:s.budget===null?[]:[{categoria:'Total directo',presupuesto:s.budget,coste:s.direct_cost}],
   evolucion:monthly.flatMap(m=>{const mes=String(m.month instanceof Date?m.month.toISOString():m.month).slice(0,7);return [{mes,type:'material',importe:m.direct_cost},{mes,type:'cliente',importe:m.revenue}];}),
   noDisponibles:[{kpi:'Validación pendiente',motivo:`${s.pending_review} registros aún no forman parte del resultado económico`},{kpi:'Beneficio neto',motivo:'El resultado directo no incluye gastos generales, amortización, financiación ni impuesto sobre sociedades.'}]};
 }
 async reconciliation({view='movimientos',page=1,pageSize=25,q='',reason='',from='',to=''}={}){
  if(this.user.role!=='admin')throw new FinError(403,'La conciliación global requiere administrador');
  if(!['registros','movimientos','documentos'].includes(view))throw new FinError(400,'Vista no válida');
  if(reason&&!['sin_documento','sin_bridge','revision','parcial'].includes(reason))throw new FinError(400,'Motivo no válido');
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  if(!Number.isInteger(size)||!Number.isInteger(p))throw new FinError(400,'Paginación no válida');
  const params=[...this.params(),'%'+q+'%'];const where=['$1::boolean AND $2::uuid IS NOT NULL','pendiente',"concat_ws(' ',tercero,concepto,numerodocumento,referencia) ILIKE $3"];
  if(reason){params.push(reason);where.push('$'+params.length+'=ANY(motivos)');}
  for(const [v,op] of [[from,'>='],[to,'<=']])if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))throw new FinError(400,'Fecha no válida');params.push(v);where.push('fecha '+op+' $'+params.length+'::date');}
  // Aggregate each Bridge side before joining: multiple links must never duplicate a source row.
  const bridge=`bridge_doc AS(SELECT document_id,count(*)::int enlaces,count(*) FILTER(WHERE state<>'Confirmado' OR state IS NULL)::int revision,coalesce(sum(allocated_amount) FILTER(WHERE state='Confirmado'),0) confirmado FROM ledens.bank_document_allocations GROUP BY document_id),
  bridge_bank AS(SELECT a.bank_movement_id,count(*)::int enlaces,count(*) FILTER(WHERE a.state<>'Confirmado' OR a.state IS NULL)::int revision,coalesce(sum(a.allocated_amount) FILTER(WHERE a.state='Confirmado'),0) confirmado,string_agg(DISTINCT coalesce(d.numerodocumento,'Sin número'),', ') documentos FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id GROUP BY a.bank_movement_id)`;
  let base;
  if(view==='registros')base=BASE+', '+bridge+`, candidates AS(SELECT l.id,l.type,l.fecha,l.tercero,l.concepto,l.numerodocumento,l.id::text referencia,l.importe,l.document_id,
    coalesce(a.enlaces,0) enlaces,coalesce(a.confirmado,0)::text conciliado,
    array_remove(ARRAY[CASE WHEN l.document_id IS NULL THEN 'sin_documento' END,CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_bridge' END,
     CASE WHEN a.revision>0 THEN 'revision' END,CASE WHEN a.enlaces>0 AND coalesce(a.confirmado,0)<>d.total THEN 'parcial' END],NULL) motivos,
    (l.document_id IS NULL OR coalesce(a.enlaces,0)=0 OR a.revision>0 OR coalesce(a.confirmado,0)<>d.total) pendiente
    FROM listed l LEFT JOIN ledens.documents d ON d.id=l.document_id LEFT JOIN bridge_doc a ON a.document_id=l.document_id)`;
  else {const bank=view==='movimientos';base='WITH '+bridge+`, candidates AS(SELECT x.id,'`+(bank?'movimiento':'documento')+`'::text type,`+(bank?'x.completed_on':'x.document_on')+` fecha,`+(bank?"coalesce(x.beneficiary_name,x.payer)":"x.tercero")+` tercero,`+(bank?'x.description':"to_jsonb(x)->>'descripcion'")+` concepto,`+(bank?'a.documentos':'x.numerodocumento')+` numerodocumento,`+(bank?'x.source_id':'x.id::text')+` referencia,`+(bank?'x.total_amount':'x.total')+` importe,`+(bank?'NULL::uuid':'x.id')+` document_id,coalesce(a.enlaces,0) enlaces,coalesce(a.confirmado,0)::text conciliado,
    array_remove(ARRAY[CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_bridge' END,`+(bank?"CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_documento' END,":"")+`CASE WHEN a.revision>0 THEN 'revision' END,CASE WHEN a.enlaces>0 AND coalesce(a.confirmado,0)<>`+(bank?'x.total_amount':'x.total')+` THEN 'parcial' END],NULL) motivos,
    (coalesce(a.enlaces,0)=0 OR a.revision>0 OR coalesce(a.confirmado,0)<>`+(bank?'x.total_amount':'x.total')+`) pendiente
    FROM ledens.`+(bank?'bank_movements':'documents')+` x LEFT JOIN `+(bank?'bridge_bank a ON a.bank_movement_id':'bridge_doc a ON a.document_id')+`=x.id `+(bank?'WHERE NOT coalesce(x.is_internal_transfer,false) AND NOT EXISTS(SELECT 1 FROM ledens.worker_payment_batches wb WHERE wb.bank_movement_id=x.id)':'')+`)`;}
  const filtered=base+' SELECT *, (importe-coalesce(conciliado::numeric,0))::text por_conciliar FROM candidates WHERE '+where.join(' AND ');
  const rows=(await this.query(filtered+' ORDER BY fecha DESC NULLS LAST,id LIMIT '+size+' OFFSET '+((p-1)*size),params)).rows;
  const total=(await this.query('SELECT count(*)::int n FROM ('+filtered+') matching',params)).rows[0].n;
  return {rows,total,page:p,pageSize:size};
 }
 // ------------------------------------------------------------- pago a trabajadores
 // «Pago a trabajadores» in Pendiente de conciliación (admin, like that inbox):
 // each selected outgoing movement becomes a batch of pending lines and leaves
 // the inbox. One savepoint per movement; the answer says which ones moved.
 async classifyWorkerPayments({movementIds}){
  if(this.user.role!=='admin')throw new FinError(403,'Clasificar movimientos requiere administrador');
  const ids=[...new Set(Array.isArray(movementIds)?movementIds:[])];
  if(!ids.length||ids.length>50||ids.some(id=>!uuid(id)))throw new FinError(400,'Selecciona entre 1 y 50 movimientos');
  return this.finance.transaction(async c=>{
   const results=[];
   for(const [i,id] of ids.entries()){
    await c.query(`SAVEPOINT m${i}`);
    try{const r=await this.classifyOne(c,id);await c.query(`RELEASE SAVEPOINT m${i}`);results.push({id,ok:true,...r});}
    catch(e){await c.query(`ROLLBACK TO SAVEPOINT m${i}`);if(!(e instanceof FinanceError))throw e;results.push({id,ok:false,error:e.message});}
   }
   return {results,ok:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
  });
 }
 async classifyOne(c,id){
  const m=(await c.query('SELECT id,source_id,total_amount,currency,completed_on,is_internal_transfer FROM ledens.bank_movements WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!m)throw new FinError(404,'Movimiento no encontrado');
  if(m.is_internal_transfer)throw new FinError(409,'Es un traspaso interno');
  if(m.currency&&m.currency!=='EUR')throw new FinError(409,'Solo movimientos en euros');
  const total=cents(m.total_amount);
  if(total===null||total>=0n)throw new FinError(409,'Solo se segregan pagos salientes (importe negativo, con céntimos exactos)');
  if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[id])).rows.length)throw new FinError(409,'Ya está en Pendiente de trabajador');
  if((await c.query('SELECT 1 FROM ledens.worker_payments WHERE bank_movement_id=$1 LIMIT 1',[id])).rows.length)throw new FinError(409,'Ya tiene pagos a trabajadores registrados');
  if((await c.query("SELECT 1 FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state='Confirmado' LIMIT 1",[id])).rows.length)throw new FinError(409,'Ya está conciliado con un documento');
  const plan=splitWorkerPayment(-total);
  const b=(await c.query(`INSERT INTO ledens.worker_payment_batches(bank_movement_id,role,unit_amount,total_amount,occurred_on,created_by)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,plan.role,decimal(plan.unit),decimal(-total),m.completed_on,this.user.id])).rows[0];
  for(const [i,amount] of plan.lines.entries())await c.query('INSERT INTO ledens.worker_payment_splits(batch_id,line_number,amount,role) VALUES($1,$2,$3,$4)',[b.id,i+1,decimal(amount),plan.role]);
  return {batchId:b.id,role:plan.role,lines:plan.lines.length};
 }
 // The pending lines are unassigned money: admins, or whoever an admin gave the
 // global «bandeja de pendientes» grant (same rule as unassigned records).
 async workerQueueAccess(c=this.pool){
  this.params();if(this.user.role==='admin')return;
  const ok=(await c.query('SELECT 1 FROM ledens.finance_project_permissions WHERE user_id=$1 AND project_id IS NULL AND can_review_unassigned LIMIT 1',[this.user.id])).rows.length;
  if(!ok)throw new FinError(403,'No tienes acceso a la bandeja de pagos pendientes');
 }
 async workerQueue({page=1,pageSize=20,q=''}={}){
  await this.workerQueueAccess();
  const size=Math.min(50,Math.max(1,Number(pageSize)||20)),p=Math.max(1,Math.min(4000,Number(page)||1));
  const where=`EXISTS(SELECT 1 FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NULL)
   AND concat_ws(' ',m.beneficiary_name,m.payer,m.description,m.reference,m.source_id) ILIKE $1`;
  const rows=(await this.query(`SELECT b.id,b.role,b.unit_amount,b.total_amount,b.occurred_on fecha,m.id bank_movement_id,m.source_id,
    coalesce(m.beneficiary_name,m.payer) tercero,m.description concepto,
    (SELECT json_agg(json_build_object('id',s.id,'line',s.line_number,'amount',s.amount::text,'role',s.role) ORDER BY s.line_number)
      FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NULL) lines,
    (SELECT count(*)::int FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NOT NULL) saved
   FROM ledens.worker_payment_batches b JOIN ledens.bank_movements m ON m.id=b.bank_movement_id
   WHERE ${where} ORDER BY b.occurred_on DESC NULLS LAST,b.id LIMIT ${size} OFFSET ${(p-1)*size}`,['%'+q+'%'])).rows;
  const t=(await this.query(`SELECT count(*)::int batches,coalesce(sum((SELECT count(*) FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NULL)),0)::int lines
   FROM ledens.worker_payment_batches b JOIN ledens.bank_movements m ON m.id=b.bank_movement_id WHERE ${where}`,['%'+q+'%'])).rows[0];
  return {rows,total:t.batches,lines:t.lines,page:p,pageSize:size};
 }
 async employees(){
  this.params();
  return (await this.query(`SELECT e.id,e.name,po.name position FROM ledens.employees e LEFT JOIN ledens.positions po ON po.id=e.primary_position_id
   WHERE coalesce(e.activo,true) AND coalesce(e.name,'')<>'' ORDER BY e.name,e.id`)).rows;
 }
 // Saving a line: create its ledens.worker_payments row (signed like the
 // accounting import: a cost is negative there; 006's trigger registers the
 // financial record) and allocate it entirely to the project through the
 // canonical engine, which checks write permission and writes the audit event.
 async saveWorkerSplits({items}){
  await this.workerQueueAccess();
  if(!Array.isArray(items)||!items.length||items.length>100||items.some(it=>!uuid(it?.splitId)||!uuid(it?.employeeId)||!uuid(it?.projectId)))
   throw new FinError(400,'Cada pago necesita trabajador y proyecto (máximo 100 por vez)');
  return this.finance.transaction(async c=>{
   const results=[];
   for(const [i,it] of items.entries()){
    await c.query(`SAVEPOINT s${i}`);
    try{
     const s=(await c.query(`SELECT s.*,b.bank_movement_id,b.occurred_on,m.source_id FROM ledens.worker_payment_splits s
      JOIN ledens.worker_payment_batches b ON b.id=s.batch_id JOIN ledens.bank_movements m ON m.id=b.bank_movement_id WHERE s.id=$1 FOR UPDATE OF s`,[it.splitId])).rows[0];
     if(!s)throw new FinError(404,'Pago no encontrado');
     if(s.worker_payment_id)throw new FinError(409,'Este pago ya está guardado');
     const e=(await c.query('SELECT id,name FROM ledens.employees WHERE id=$1',[it.employeeId])).rows[0];
     if(!e)throw new FinError(400,'Trabajador no encontrado');
     const w=(await c.query(`INSERT INTO ledens.worker_payments(amount,occurred_on,bank_movement_id,employee_id,empleado)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[decimal(-cents(s.amount)),s.occurred_on,s.bank_movement_id,e.id,e.name])).rows[0];
     const rec=(await c.query('SELECT id,version,gross_amount FROM ledens.financial_records WHERE worker_payment_id=$1',[w.id])).rows[0];
     if(!rec)throw new FinError(503,'No se pudo registrar el pago en la contabilidad');
     await this.finance.replace(c,this.user,{record_id:rec.id,version:rec.version,allocations:[{project_id:it.projectId,amount:rec.gross_amount}]},
      `Pago a ${s.role==='oficial'?'oficial':'ayudante'} segregado del movimiento ${s.source_id}`);
     await c.query('UPDATE ledens.worker_payment_splits SET worker_payment_id=$2,saved_by=$3,saved_at=now() WHERE id=$1',[s.id,w.id,this.user.id]);
     await c.query(`RELEASE SAVEPOINT s${i}`);results.push({splitId:it.splitId,ok:true,workerPaymentId:w.id});
    }catch(err){await c.query(`ROLLBACK TO SAVEPOINT s${i}`);if(!(err instanceof FinanceError))throw err;results.push({splitId:it.splitId,ok:false,error:err.message});}
   }
   return {results,ok:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
  });
 }
 // Undo «Pago a trabajadores» while nothing of the movement has been saved yet.
 async returnWorkerBatch({batchId}){
  if(this.user.role!=='admin')throw new FinError(403,'Devolver a conciliación requiere administrador');
  if(!uuid(batchId))throw new FinError(404,'Movimiento no encontrado');
  return this.finance.transaction(async c=>{
   const b=(await c.query('SELECT id FROM ledens.worker_payment_batches WHERE id=$1 FOR UPDATE',[batchId])).rows[0];
   if(!b)throw new FinError(404,'Movimiento no encontrado');
   if((await c.query('SELECT 1 FROM ledens.worker_payment_splits WHERE batch_id=$1 AND worker_payment_id IS NOT NULL LIMIT 1',[batchId])).rows.length)
    throw new FinError(409,'Ya hay pagos guardados de este movimiento; no se puede devolver');
   await c.query('DELETE FROM ledens.worker_payment_batches WHERE id=$1',[batchId]);return {returned:true};
  });
 }
}
