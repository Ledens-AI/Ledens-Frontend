import {randomUUID,createHash} from 'node:crypto';
const escape=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reasons={duplicate_content:'El archivo ya estaba registrado; no se ha duplicado el documento',invoice_date_requires_review:'La fecha del documento no se ha validado',ocr_failed:'El extractor no ha podido leer el documento',ocr_rejected_document:'El extractor ha rechazado el documento',no_match:'No se ha encontrado un movimiento compatible',ambiguous_match:'Existen varios movimientos posibles',insufficient_evidence:'No hay evidencias suficientes para conciliar',auto_confirmed:'Conciliación automática confirmada',partial_or_existing_allocation:'Existen imputaciones previas o parciales',invoice_issue:'El documento requiere revisión',awaiting_evaluation:'Pendiente de evaluar'};
const states={duplicate:'Duplicado detectado; documento conservado sin duplicar',received:'Recibido',ready:'Extracción correcta',review:'Revisión necesaria',archived:'Original archivado',pending:'Conciliación pendiente',matched:'Conciliado',Confirmado:'Conciliación confirmada',Revisar:'Conciliación en revisión',error:'Fallo técnico',replace_allocations:'Asignación a proyecto actualizada',recognition:'Validación contable actualizada',review_flag:'Revisión actualizada'};
export function formatAlert(a,context={}){
 const label=states[a.status]||a.status;
 const title='[Ledens] '+label+' · '+(a.payload.filename||a.payload.document?.number||a.document_id||a.event_type);
 const detail={evento:a.id,fecha_evento:a.created_at,tipo:a.event_type,estado:label,motivo:reasons[a.reason]||a.reason,documento_id:a.document_id,datos_del_evento:a.payload,estado_actual:context};
 return {subject:title.replace(/[\r\n]/g,' ').slice(0,250),html:'<h2>'+escape(label)+'</h2><p>'+escape(reasons[a.reason]||a.reason||'Operación completada')+'</p><p>Detalle del evento y estado actual (los importes conservan su signo):</p><pre>'+escape(JSON.stringify(detail,null,2))+'</pre><p><a href="https://ambitious-island-05d1d8a03.2.azurestaticapps.net/plataforma">Abrir Ledens</a></p>'};
}
export class AlertService{
 constructor(pool){this.pool=pool;}
 async error({type='ingestion',documentId=null,reason='operation_failed',filename=null}){
  // Collapse identical errors within one hour, never persist bodies, tokens or exception messages.
  const bucket=new Date().toISOString().slice(0,13),key=createHash('sha256').update(JSON.stringify([type,documentId,reason,filename,bucket])).digest('hex');
  await this.pool.query(`INSERT INTO ledens.transaction_alerts(event_key,event_type,status,reason,document_id,payload) VALUES($1,$2,'error',$3,$4,$5) ON CONFLICT DO NOTHING`,['error:'+key,type,String(reason).slice(0,100),documentId,JSON.stringify({filename:typeof filename==='string'?filename.slice(0,250):null})]);
 }
 async claim(){
  const token=randomUUID();
  const {rows}=await this.pool.query(`WITH pending AS(SELECT id FROM ledens.transaction_alerts WHERE delivered_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED)
   UPDATE ledens.transaction_alerts a SET lease_token=$1,lease_until=now()+interval '30 minutes',attempts=attempts+1 FROM pending p WHERE a.id=p.id RETURNING a.*`,[token]);
  const messages=[];
  for(const a of rows){
   const context=a.document_id?(await this.pool.query(`SELECT jsonb_build_object('numero',d.numerodocumento,'fecha',d.document_on,'tercero',d.tercero,'importe_total',d.total,'base',d.base_amount,'iva',d.vat_amount,'movimientos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'referencia',m.reference,'descripcion',m.description,'fecha',m.completed_on,'importe',m.total_amount,'moneda',m.currency,'importe_bridge',x.allocated_amount,'estado_bridge',x.state)) FROM ledens.bank_document_allocations x JOIN ledens.bank_movements m ON m.id=x.bank_movement_id WHERE x.document_id=d.id),'[]'::jsonb),'conceptos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'concepto',f.description,'importe',f.gross_amount,'categoria',f.category,'estado',f.status,'importe_sin_asignar',abs(f.gross_amount)-coalesce((SELECT sum(abs(pa.allocated_amount)) FROM ledens.project_financial_allocations pa WHERE pa.record_id=f.id),0))) FROM ledens.financial_records f WHERE f.document_id=d.id),'[]'::jsonb)) detail FROM ledens.documents d WHERE d.id=$1`,[a.document_id])).rows[0]?.detail||{}:{};
   messages.push({id:a.id,lease_token:token,...formatAlert(a,context)});
  }
  return {messages};
 }
 async acknowledge(id,token,delivered){
  if(typeof delivered!=='boolean')return false;
  const r=await this.pool.query(`UPDATE ledens.transaction_alerts SET delivered_at=CASE WHEN $3 THEN now() END,lease_token=NULL,lease_until=NULL,last_error=CASE WHEN $3 THEN NULL ELSE 'email_delivery_failed' END,next_attempt_at=now()+interval '15 minutes' WHERE id=$1 AND lease_token=$2 AND delivered_at IS NULL RETURNING id`,[id,token,delivered]);return r.rows.length===1;
 }
}
