import {hasPurchases} from '../finance/purchases.js';
// Spanish UI facade: never writes source project_id or a parallel money ledger.
import {createHash} from 'node:crypto';
import {FinanceService,FinanceError,uuid} from '../finance/service.js';
import {cents,decimal,bankFingerprint} from '../bridge/rules.js';
import {extractLines,storeInvoiceLines} from '../finance/ingestion.js';
export class FinError extends FinanceError {constructor(status,message,extra){super(status,message);this.extra=extra;}}
export const isUuid=uuid;
export const TYPES={material:{label:'Material'},trabajador:{label:'Trabajador'},cliente:{label:'Cliente'},concepto:{label:'Concepto de factura'}};
export const STATES=['pendiente','asignado','parcial','revision'];
// «Pendiente de conciliación» → movimientos: every validable row of
// ledens.treasury_movements (028: bank and cash in one, with its origin) still to
// be reconciled. A bank movement leaves once it is a worker batch, a client
// payment or a transfer between the company's accounts (027), or its Bridge
// links cover it; unassigned cash (016) has no Bridge and
// is signed like a bank movement. Cash imported from FactMovimientosEfectivo (030)
// shows its own data: the obra of its «proyecto» when one matches, and a warning
// when an imported source row without bank movement already has its date and
// amount (it may be the same payment: assign it or discard it, never both).
const IMPORTED_DUPLICATE=`x.imported AND CASE x.direction
  WHEN 'pago' THEN EXISTS(SELECT 1 FROM ledens.material_expenses me WHERE me.bank_movement_id IS NULL AND me.occurred_on=x.occurred_on
    AND abs(me.total)=abs(x.amount) AND NOT EXISTS(SELECT 1 FROM ledens.cash_movements c2 WHERE c2.material_id=me.id))
   OR EXISTS(SELECT 1 FROM ledens.worker_payments wp WHERE wp.bank_movement_id IS NULL AND wp.occurred_on=x.occurred_on AND abs(wp.amount)=abs(x.amount)
    AND NOT EXISTS(SELECT 1 FROM ledens.worker_payment_splits ws JOIN ledens.worker_payment_batches wb ON wb.id=ws.batch_id
     WHERE ws.worker_payment_id=wp.id AND wb.cash_movement_id IS NOT NULL))
  ELSE EXISTS(SELECT 1 FROM ledens.customer_payments cp WHERE cp.bank_movement_id IS NULL AND cp.occurred_on=x.occurred_on
    AND abs(cp.total)=abs(x.amount) AND NOT EXISTS(SELECT 1 FROM ledens.cash_movements c2 WHERE c2.customer_payment_id=cp.id)) END`;
const IMPORTED_PROJECT=`(SELECT jsonb_strip_nulls(jsonb_build_object('id',p.id,'label',p.name,'cliente',nullif(btrim(to_jsonb(p)->>'customer_name_source'),''))) FROM ledens.projects p
  WHERE x.imported_detail->>'proyecto' IS NOT NULL AND (p.project_id=x.imported_detail->>'proyecto' OR lower(btrim(p.name))=lower(x.imported_detail->>'proyecto'))
  ORDER BY p.project_id=x.imported_detail->>'proyecto' DESC,p.id LIMIT 1)`;
const TREASURY_CANDIDATES=`candidates AS(SELECT x.id,CASE x.origin WHEN 'bank_movements' THEN 'movimiento' ELSE 'efectivo' END::text type,x.origin,
  x.occurred_on fecha,x.counterparty tercero,CASE x.origin WHEN 'bank_movements' THEN x.description ELSE x.concept END concepto,a.documentos numerodocumento,
  CASE x.origin WHEN 'bank_movements' THEN x.source_id ELSE 'Efectivo' END referencia,x.amount importe,NULL::uuid document_id,
  coalesce(a.enlaces,0) enlaces,coalesce(a.confirmado,0)::text conciliado,
  CASE x.origin WHEN 'cash_movements' THEN array_remove(ARRAY['efectivo',CASE WHEN x.imported THEN 'efectivo_importado' END,
   CASE WHEN ${IMPORTED_DUPLICATE} THEN 'posible_duplicado' END],NULL) ELSE array_remove(ARRAY[CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_bridge' END,
   CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_documento' END,CASE WHEN a.revision>0 THEN 'revision' END,
   CASE WHEN a.enlaces>0 AND coalesce(a.confirmado,0)<>x.amount THEN 'parcial' END],NULL) END motivos,
  (x.origin='cash_movements' OR coalesce(a.enlaces,0)=0 OR a.revision>0 OR coalesce(a.confirmado,0)<>x.amount) pendiente,
  x.imported importado,x.imported_detail detalle_importado,CASE WHEN x.imported THEN ${IMPORTED_PROJECT} END obra_sugerida
 FROM ledens.treasury_movements x LEFT JOIN bridge_bank a ON a.bank_movement_id=x.id
 WHERE x.validable AND CASE x.origin
  WHEN 'bank_movements' THEN NOT EXISTS(SELECT 1 FROM ledens.worker_payment_batches wb WHERE wb.bank_movement_id=x.id)
   AND NOT EXISTS(SELECT 1 FROM ledens.customer_payments cp WHERE cp.bank_movement_id=x.id) AND NOT x.marked_transfer
  ELSE x.assigned_to IS NULL AND NOT EXISTS(SELECT 1 FROM ledens.worker_payment_batches wb WHERE wb.cash_movement_id=x.id) END)`;
const CASH_TARGETS={trabajadores:'pago',materiales:'pago',clientes:'cobro'};
const SCOPE=`($1 OR (NOT EXISTS(SELECT 1 FROM ledens.project_financial_allocations ax WHERE ax.record_id=f.id AND NOT EXISTS
 (SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=ax.project_id)) AND
 (EXISTS(SELECT 1 FROM ledens.project_financial_allocations ax WHERE ax.record_id=f.id) OR
 EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id IS NULL AND fp.can_review_unassigned))))`;
const BASE=`WITH base AS (
 SELECT f.id record_id,coalesce(f.material_id,f.worker_payment_id,f.customer_payment_id,f.invoice_line_id) id,
 CASE WHEN f.material_id IS NOT NULL THEN 'material' WHEN f.worker_payment_id IS NOT NULL THEN 'trabajador' WHEN f.customer_payment_id IS NOT NULL THEN 'cliente' ELSE 'concepto' END type,
 f.version,f.status accounting_status,f.category,f.occurred_on fecha,f.gross_amount importe,f.document_id,f.bank_movement_id,
 coalesce(nullif(btrim(f.counterparty),''),nullif(btrim(d.tercero),''),nullif(btrim(to_jsonb(w)->>'empleado'),''),nullif(btrim(to_jsonb(c)->>'cliente'),''),
  nullif(btrim(bd.tercero),''),CASE WHEN f.gross_amount>0 THEN coalesce(nullif(btrim(bm.payer),''),nullif(btrim(bm.beneficiary_name),''))
  ELSE coalesce(nullif(btrim(bm.beneficiary_name),''),nullif(btrim(bm.payer),'')) END,nullif(btrim(km.counterparty),''),nullif(btrim(a.cliente),''),
  CASE WHEN f.customer_payment_id IS NOT NULL OR f.category IN ('revenue','advance') THEN 'Cliente sin identificar' END) tercero,
 coalesce(f.description,to_jsonb(m)->>'description',to_jsonb(w)->>'categoria',d.numerodocumento) concepto,
 coalesce(to_jsonb(m)->>'quantity',il.quantity::text) quantity,to_jsonb(m)->>'und' unidad,coalesce(to_jsonb(m)->>'unit_price',il.evidence->>'unit_price') unit_price,
 il.line_number,il.evidence->>'product_code' product_code,
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
 LEFT JOIN ledens.invoice_lines il ON il.id=f.invoice_line_id
 LEFT JOIN ledens.bank_movements bm ON bm.id=coalesce(f.bank_movement_id,c.bank_movement_id)
 LEFT JOIN LATERAL(SELECT bdd.tercero FROM ledens.bank_document_allocations ba JOIN ledens.documents bdd ON bdd.id=ba.document_id
  WHERE ba.bank_movement_id=bm.id AND nullif(btrim(bdd.tercero),'') IS NOT NULL ORDER BY ba.state='Confirmado' DESC,bdd.document_on DESC NULLS LAST,bdd.id LIMIT 1) bd ON true
 LEFT JOIN ledens.cash_movements km ON km.customer_payment_id=f.customer_payment_id AND f.customer_payment_id IS NOT NULL
 LEFT JOIN ledens.finance_review_flags rv ON rv.record_id=f.id
 LEFT JOIN LATERAL(SELECT sum(pa.allocated_amount) allocated,sum(abs(pa.allocated_amount)) used,count(*)::int n,
  (array_agg(pa.project_id))[1] project_id,(array_agg(pr.name))[1] project_label,
  (array_agg(to_jsonb(pr)->>'customer_name_source' ORDER BY abs(pa.allocated_amount) DESC) FILTER (WHERE nullif(btrim(to_jsonb(pr)->>'customer_name_source'),'') IS NOT NULL))[1] cliente FROM ledens.project_financial_allocations pa
  JOIN ledens.projects pr ON pr.id=pa.project_id WHERE pa.record_id=f.id) a ON true WHERE ${SCOPE} AND f.source_valid AND f.status<>'excluded'
), listed AS(SELECT b.*,CASE WHEN needs_review THEN 'revision' WHEN NOT sin_proyecto THEN 'asignado' WHEN allocation_count>0 THEN 'parcial' ELSE 'pendiente' END estado FROM base b)`;
// «Movimientos conciliados»: the three business classes map onto canonical
// categories; a reclassification changes financial_records.category only, never
// moves a row between the imported source tables.
export const CLASES={materiales:'materials',trabajadores:'labor',clientes:'revenue'};
const CLASE_SQL=`CASE WHEN l.category IN ('materials','overhead') THEN 'materiales' WHEN l.category='labor' THEN 'trabajadores'
 WHEN l.category IN ('revenue','advance') THEN 'clientes' WHEN l.category='unclassified' THEN 'sin_clasificar' ELSE 'otros' END`;
// A record is a payment or a receipt by its document, else its source, else its bank movement.
const direction=r=>r.doc_tipo==='Cobrar'||r.customer_payment_id?'cobro':r.doc_tipo==='Pagar'||r.material_id||r.worker_payment_id?'pago':
 r.bank_total!==null&&r.bank_total!==undefined?(Number(r.bank_total)<0?'pago':'cobro'):null;
// Materiales / Pagos a trabajadores follow the category, so a reclassified
// record moves tab; an imported source keeps its tab until reclassified.
const PERIODS={semana:'week',mes:'month',anio:'year'};
const TYPE_FILTER={
 material:t=>`((l.type=${t} AND l.category<>'labor') OR (l.type<>${t} AND l.type<>'cliente' AND l.category='materials'))`,
 trabajador:t=>`((l.type=${t} AND l.category NOT IN ('materials','overhead')) OR (l.type<>${t} AND l.type<>'cliente' AND l.category='labor'))`,
 cliente:t=>`(l.type=${t} OR (l.type='concepto' AND l.category='revenue'))`,
};
// «Concepto de movimientos»: the class a record gives its movement ('x' = not one
// of the three, so the movement stays pending).
const CAT_CLASE=c=>`CASE WHEN ${c} IN ('materials','overhead') THEN 'materiales' WHEN ${c}='labor' THEN 'trabajadores' WHEN ${c} IN ('revenue','advance') THEN 'clientes' ELSE 'x' END`;
export const MOVEMENT_CLASSES=['pendiente','materiales','trabajadores','clientes','reembolso_proveedor','transferencia','mixto'];
// «Transferencia entre cuentas»: only with another account of the company itself.
export const OWN_COMPANY_TEXT="'sociedad\\s+inversora\\s+navarro'";
const OWN_COMPANY_RE=/sociedad\s+inversora\s+navarro/i;
// A bank «TRASPASO» with no beneficiary nor payer (the bank names no other party):
// a transfer between the company's own accounts too. The person decides.
const TRASPASO_SQL=t=>`(${t}.description ~* '^\\s*traspaso' AND nullif(btrim(coalesce(${t}.beneficiary_name,'')),'') IS NULL AND nullif(btrim(coalesce(${t}.payer,'')),'') IS NULL)`;
const isTraspaso=b=>/^\s*traspaso/i.test(b.description||'')&&!String(b.beneficiary_name||'').trim()&&!String(b.payer||'').trim();
const ownTransfer=b=>OWN_COMPANY_RE.test([b.beneficiary_name,b.payer,b.description].filter(Boolean).join(' '))||isTraspaso(b);
// «Reembolso de proveedor»: money a supplier gives back (a return, a credit note).
// It is a material with the sign of a receipt, so it lowers the material cost of
// the obra it is assigned to instead of counting as a client receipt.
const MOVEMENT_CLASES={...CLASES,reembolso_proveedor:'materials'};
// Obramat («Adeo Obramat», formerly Bricoman): every payment or receipt is a Pago
// de materiales. A movement is Obramat's by its bank text or by a reconciled
// document of that supplier (name or tax id).
export const OBRAMAT_TAX_ID='B84406289';
const OBRAMAT_TEXT="'(obramat|bricoman)'";
const isObramatDoc=d=>`(${d}.tercero ~* ${OBRAMAT_TEXT} OR regexp_replace(upper(coalesce(${d}.niftercero,'')),'[^A-Z0-9]','','g')='${OBRAMAT_TAX_ID}')`;
// A native Obramat advance or advance refund (014) never has records of its own:
// the cost enters with the delivery invoice, so such a movement is materials as is.
const movementsSql=purchases=>`WITH links AS(SELECT bank_movement_id,document_id FROM ledens.bank_document_allocations WHERE state='Confirmado'),
 recs AS(SELECT DISTINCT x.mov,r.id,r.version,r.category FROM (
  SELECT f.bank_movement_id mov,f.id FROM ledens.financial_records f WHERE f.bank_movement_id IS NOT NULL
  UNION ALL SELECT l.bank_movement_id,f.id FROM links l JOIN ledens.financial_records f ON f.document_id=l.document_id
  UNION ALL SELECT t.id,f.id FROM ledens.treasury_movements t JOIN ledens.financial_records f ON f.material_id=t.material_id OR f.customer_payment_id=t.customer_payment_id
   WHERE t.origin='cash_movements'
 ) x JOIN ledens.financial_records r ON r.id=x.id WHERE r.source_valid AND r.status<>'excluded'),
 agg AS(SELECT mov,count(*)::int n,array_agg(DISTINCT ${CAT_CLASE('category')}) clases,md5(string_agg(id::text||':'||version,',' ORDER BY id)) version FROM recs GROUP BY mov),
 movs AS(
  SELECT t.id,CASE t.origin WHEN 'bank_movements' THEN 'banco' ELSE 'efectivo' END::text tipo,t.origin,t.occurred_on fecha,t.counterparty tercero,t.concept concepto,
   CASE t.origin WHEN 'bank_movements' THEN t.source_id ELSE 'Efectivo' END referencia,t.amount importe,
   d.documentos,coalesce(d.n,0) n_docs,coalesce(d.sin_registros,false) doc_sin_registros,
   EXISTS(SELECT 1 FROM ledens.worker_payment_batches wb WHERE CASE t.origin WHEN 'bank_movements' THEN wb.bank_movement_id ELSE wb.cash_movement_id END=t.id) lote,
   EXISTS(SELECT 1 FROM ledens.provisional_material_payments pm WHERE pm.bank_movement_id=t.id AND pm.replaced_at IS NULL) provisional,
   t.amount>0 AND EXISTS(SELECT 1 FROM ledens.material_expenses me WHERE me.bank_movement_id=t.id) reembolso,
   (t.customer_payment_id IS NOT NULL OR EXISTS(SELECT 1 FROM ledens.customer_payments cp WHERE cp.bank_movement_id=t.id)) cobro_cliente,
   (t.search_text ~* ${OBRAMAT_TEXT} OR coalesce(d.obramat_doc,false)) obramat,
   coalesce(d.solo_compras,false) solo_compras,
   t.marked_transfer transferencia,
   -- Active records of the movement itself (an imported worker payment or material,
   -- a provisional, a refund, a client receipt): they classify it, whatever its
   -- reconciled documents still lack.
   t.origin='bank_movements' AND EXISTS(SELECT 1 FROM ledens.financial_records f WHERE f.bank_movement_id=t.id AND f.source_valid AND f.status<>'excluded') propios,
   t.origin='bank_movements' AND (concat_ws(' ',t.beneficiary_name,t.payer,t.description) ~* ${OWN_COMPANY_TEXT} OR ${TRASPASO_SQL('t')}) propia
  FROM ledens.treasury_movements t LEFT JOIN LATERAL(SELECT string_agg(DISTINCT coalesce(dd.numerodocumento,'Sin número'),', ') documentos,count(*)::int n,
    bool_or(NOT EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.document_id=dd.id AND r.source_valid AND r.status<>'excluded')) sin_registros,
    bool_or(${isObramatDoc('dd')}) obramat_doc,
    ${purchases?"bool_and(EXISTS(SELECT 1 FROM ledens.purchase_documents pd WHERE pd.document_id=dd.id AND pd.kind IN ('advance','advance_refund')))":'false'} solo_compras
   FROM links l JOIN ledens.documents dd ON dd.id=l.document_id WHERE l.bank_movement_id=t.id) d ON true
  WHERE t.validable AND t.amount<>0),
 cls AS(SELECT m.*,coalesce(a.n,0) registros,coalesce(a.version,md5('')) version,
  ARRAY(SELECT DISTINCT e FROM unnest(array_remove(coalesce(a.clases,'{}'::text[]),'x')||CASE WHEN m.lote THEN ARRAY['trabajadores'] ELSE '{}'::text[] END) e ORDER BY e) conocidas,
  -- A reconciled document without concepts no longer leaves it pending: what it
  -- registered classifies it (nothing registered: pending), and the missing
  -- concepts are reported when a record is assigned to an obra.
  ('x'=ANY(coalesce(a.clases,'{}'::text[]))) desconocido
  FROM movs m LEFT JOIN agg a ON a.mov=m.id),
 fin AS(SELECT c.*,CASE WHEN c.transferencia THEN 'transferencia' WHEN c.obramat AND c.solo_compras THEN 'materiales' WHEN c.desconocido OR cardinality(c.conocidas)=0 THEN 'pendiente'
   WHEN cardinality(c.conocidas)=1 THEN CASE WHEN c.conocidas[1]='materiales' AND c.importe>0 THEN 'reembolso_proveedor' ELSE c.conocidas[1] END ELSE 'mixto' END clase,
  CASE WHEN c.importe<0 THEN 'pago' ELSE 'cobro' END sentido FROM cls c)`;
// One row of «Concepto de movimientos» (list and single movement).
const MOVEMENT_COLUMNS=' SELECT id,tipo,origin,fecha::text fecha,tercero,concepto,referencia,importe::text importe,documentos,clase,conocidas,sentido,version,registros,lote,obramat,propia,'+
 "CASE WHEN transferencia THEN 'transferencia' WHEN obramat AND solo_compras THEN 'compra_obramat' WHEN provisional THEN 'provisional' WHEN reembolso THEN 'registro' WHEN n_docs>0 THEN 'bridge' WHEN lote THEN 'trabajadores' WHEN registros>0 THEN 'registro' ELSE 'ninguno' END origen";
// «Adjuntar detalle»: the product detail of a reconciled document without
// concepts is read with the invoice OCR (Document Intelligence, F0: 4 MB).
export const DETAIL_MAX_BYTES=4*1024*1024;
const DETAIL_TYPES=[['application/pdf',b=>b.subarray(0,5).toString()==='%PDF-'],['image/png',b=>b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))],
 ['image/jpeg',b=>b[0]===255&&b[1]===216&&b[2]===255]];
// A supplier refund record: a material registered from a bank receipt (negative cost, no document).
const isRefund=r=>r.type==='material'&&!r.document_id&&Boolean(r.bank_movement_id)&&cents(r.importe)<0n;
const hasTransfers=async c=>Boolean((await c.query("SELECT to_regclass('ledens.internal_transfers') name")).rows[0].name);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const labels={reclassified:'Cambio de clasificación',replace_allocations:'Asignación a proyecto',recognition:'Validación contable',review_flag:'Revisión',source_changed:'Origen actualizado',document_changed:'Factura actualizada'};
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
  if(f.type){if(!TYPES[f.type])throw new FinError(400,'Tipo no válido');const t=bind(f.type);where.push(TYPE_FILTER[f.type]?.(t)??'l.type='+t);}
  if(f.pending)where.push('l.sin_proyecto');
  if(f.estado){if(!STATES.includes(f.estado))throw new FinError(400,'Estado no válido');where.push('l.estado='+bind(f.estado));}
  if(f.project){if(!uuid(f.project))throw new FinError(400,'Proyecto no válido');where.push(`EXISTS(SELECT 1 FROM ledens.project_financial_allocations pa WHERE pa.record_id=l.record_id AND pa.project_id=${bind(f.project)})`);}
  if(f.q)where.push(`concat_ws(' ',l.tercero,l.concepto,l.numerodocumento) ILIKE ${bind('%'+f.q+'%')}`);
  // «Pagos a trabajadores»: one worker (as listed, '' = none) and one role.
  if(f.tercero!==undefined&&f.tercero!==null){where.push(`coalesce(l.tercero,'')=${bind(String(f.tercero).slice(0,200))}`);}
  if(f.rol)where.push(`l.rol=${bind(String(f.rol).slice(0,100))}`);
  for(const [key,op] of [['from','>='],['to','<=']])if(f[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(f[key]))throw new FinError(400,'Fecha no válida');where.push(`l.fecha ${op} ${bind(f[key])}::date`);}
  for(const [key,op] of [['min','>='],['max','<=']])if(f[key]!==undefined&&f[key]!==''){if(cents(f[key])===null)throw new FinError(400,'Importe no válido');where.push(`abs(l.importe) ${op} abs(${bind(f[key])}::numeric)`);}
  return {params,where:where.length?'WHERE '+where.join(' AND '):''};
 }
 // «Pagos a trabajadores» chart: what each worker was paid per week, month or
 // year, with the same filters as the table. `trabajadores` lists every worker
 // ever paid (ignoring the filters, biggest total first) so the screen can give
 // each one a colour that does not change when the filters do.
 async workerPaymentSeries(f={}){
  const unit=PERIODS[f.periodo||'semana'];if(!unit)throw new FinError(400,'Periodo no válido');
  const {params,where}=this.filters({...f,type:'trabajador'});
  const series=(await this.query(`${BASE} SELECT date_trunc('${unit}',l.fecha)::date::text periodo,coalesce(l.tercero,'') trabajador,
   sum(l.importe)::text importe,count(*)::int pagos FROM listed l ${where} GROUP BY 1,2 ORDER BY 1,2`,params)).rows;
  const all=this.filters({type:'trabajador'});
  const trabajadores=(await this.query(`${BASE} SELECT coalesce(l.tercero,'') nombre,array_remove(array_agg(DISTINCT l.rol),NULL) roles,
   sum(l.importe)::text total FROM listed l ${all.where} GROUP BY 1 ORDER BY sum(abs(l.importe)) DESC,1`,all.params)).rows;
  return {periodo:f.periodo||'semana',series,trabajadores};
 }
 async listRecords(f={}){
  const {params,where}=this.filters(f);const sorts={fecha:'fecha',importe:'importe',tercero:'tercero',concepto:'concepto',tipo:'type',estado:'estado'};
  const page=Math.max(1,Math.min(4000,Number(f.page)||1)),pageSize=Math.max(1,Math.min(100,Number(f.pageSize)||25));
  if(!Number.isInteger(page)||!Number.isInteger(pageSize))throw new FinError(400,'Paginación no válida');
  const rows=(await this.query(`${BASE} SELECT l.* FROM listed l ${where} ORDER BY l.${sorts[f.sort]||'fecha'} ${f.dir==='asc'?'ASC':'DESC'} NULLS LAST,l.id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`,params)).rows;
  const t=(await this.query(`${BASE} SELECT count(*)::int n,coalesce(sum(importe),0)::text importe FROM listed l ${where}`,params)).rows[0];
  // A provisional material payment waits for its invoice's concepts («Segregar conceptos»).
  const mats=rows.filter(r=>r.type==='material').map(r=>r.id);
  if(mats.length&&this.user.role==='admin'&&(await this.query("SELECT to_regclass('ledens.provisional_material_payments') IS NOT NULL ok")).rows[0].ok){
   const open=new Set((await this.query('SELECT material_id FROM ledens.provisional_material_payments WHERE material_id=ANY($1::uuid[]) AND replaced_at IS NULL',[mats])).rows.map(r=>r.material_id));
   for(const r of rows)if(r.type==='material')r.provisional=open.has(r.id);
  }
  return {rows,total:t.n,totalImporte:t.importe,page,pageSize};
 }
 async pendingSummary(){
  const rows=(await this.query(`${BASE} SELECT type,count(*)::int total,count(*) FILTER(WHERE sin_proyecto)::int pendientes,
   coalesce(sum(abs(importe-allocated)) FILTER(WHERE sin_proyecto),0)::text importe_pendiente,
   count(*) FILTER(WHERE needs_review)::int revision FROM listed GROUP BY type`,this.params())).rows;
  const porTipo=Object.fromEntries(Object.keys(TYPES).map(t=>[t,{total:0,pendientes:0,revision:0,importe_pendiente:'0'}]));for(const r of rows)porTipo[r.type]=r;
  // «Materiales pendiente de asignación» lists what the Materiales tab shows
  // (imported materials and anything classified as materials), without a project.
  const params=this.params();params.push('material');
  const materiales=(await this.query(`${BASE} SELECT count(*)::int pendientes,coalesce(sum(abs(l.importe-l.allocated)),0)::text importe_pendiente
   FROM listed l WHERE l.sin_proyecto AND ${TYPE_FILTER.material('$3')}`,params)).rows[0];
  // «Pagos de clientes» without a project, counted with the tab's own filter
  // (client receipts and revenue concepts): the sidebar badge of that tab.
  const cparams=this.params();cparams.push('cliente');
  const clientes=(await this.query(`${BASE} SELECT count(*)::int pendientes,coalesce(sum(abs(l.importe-l.allocated)),0)::text importe_pendiente
   FROM listed l WHERE l.sin_proyecto AND ${TYPE_FILTER.cliente('$3')}`,cparams)).rows[0];
  return {porTipo,materiales,clientes,total:rows.reduce((s,r)=>s+r.total,0),pendientes:rows.reduce((s,r)=>s+r.pendientes,0),revision:rows.reduce((s,r)=>s+r.revision,0),importePendiente:decimal(rows.reduce((s,r)=>s+cents(r.importe_pendiente),0n))};
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
  let purchaseSettlement=null;if(r.document_id){try{purchaseSettlement=await this.finance.purchase(this.user,r.document_id);}catch(e){if(!(e instanceof FinanceError&&e.status===403))throw e;}}
  return {...r,typeLabel:TYPES[type].label,documento,movimiento,purchaseSettlement,distribucion:r.project_id?[]:full.allocations.map(a=>({project_id:a.project_id,label:a.project_name,amount:a.allocated_amount})),historial:await this.history(type,id),suggestion};
 }
 reason(r,reason,version){if(r.version===version&&(r.project_id||r.parts)&&(!reason||reason.trim().length<5))throw new FinError(400,'Escribe un motivo de al menos cinco caracteres');return reason?.trim()||'Asignación confirmada en gestión financiera';}
 // Assigning a record to an obra needs the concepts of every document reconciled
 // with its movement (its own bank movement, or the movements of its document):
 // this is where a document without concepts is reported, never when the
 // movement is classified in Concepto de movimientos.
 async missingConcepts(c,{bankMovementId=null,documentId=null,refund=false}){
  // A supplier refund is registered from the movement itself and never uses its
  // credit note's concepts (they are excluded on purpose, refund_replaced).
  if(refund)return;
  const d=(await c.query(`SELECT d.numerodocumento FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id
   WHERE a.state='Confirmado' AND (a.bank_movement_id=$1 OR a.bank_movement_id IN(SELECT bank_movement_id FROM ledens.bank_document_allocations WHERE document_id=$2 AND state='Confirmado'))
    AND NOT EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.document_id=d.id AND r.source_valid AND r.status<>'excluded')
   ORDER BY d.numerodocumento LIMIT 1`,[bankMovementId,documentId])).rows[0];
  if(d)throw new FinError(409,`El documento ${d.numerodocumento||'conciliado'} no tiene conceptos registrados; revisa su ingesta (o adjunta su detalle con «Segregar conceptos») antes de asignarlo a una obra`);
 }
 async assign({type,id,projectId,version,requestId,reason}){
  const r=await this.source(type,id);if(!Number.isInteger(version)||!uuid(requestId))throw new FinError(400,'Recarga el registro antes de asignarlo');
  if(projectId!==null)await this.missingConcepts(this.pool,{bankMovementId:r.bank_movement_id,documentId:r.document_id,refund:isRefund(r)});
  await this.finance.bulk(this.user,{request_id:requestId,reason:this.reason(r,reason,version),records:[{record_id:r.record_id,version,allocations:projectId===null?[]:[{project_id:projectId,amount:r.importe}]}]});return {changed:true};
 }
 async distribute({type,id,parts,version,requestId,reason}){
  const r=await this.source(type,id);if(!Array.isArray(parts)||!parts.length||!Number.isInteger(version)||!uuid(requestId))throw new FinError(400,'Distribución no válida; recarga el registro');
  await this.missingConcepts(this.pool,{bankMovementId:r.bank_movement_id,documentId:r.document_id,refund:isRefund(r)});
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
 // «Rentabilidad por proyecto»: ingresos − costes of every project from the
 // movements assigned to it (one row per record and project, so a split record
 // counts its share in each). Every assigned record counts, approved or not:
 // the result does not wait for accounting validation or for the movements
 // still pending classification. A record is income when its category is
 // revenue/advance (or it is a client payment); anything else is a cost, so a
 // supplier refund (negative cost) lowers the cost. The chart ignores the
 // project filter; the table and totals honour it.
 async projectResults(f={}){
  const params=this.params(),where=[];const bind=v=>{params.push(v);return '$'+params.length;};
  const tipos={ingresos:'r.ingreso',materiales:"NOT r.ingreso AND r.category IN ('materials','overhead')",trabajadores:"NOT r.ingreso AND r.category='labor'",
   otros:"NOT r.ingreso AND r.category NOT IN ('materials','overhead','labor')"};
  if(f.tipo){if(!tipos[f.tipo])throw new FinError(400,'Tipo no válido');where.push(tipos[f.tipo]);}
  if(f.contable){const s={aprobado:'approved',pendiente:'pending'}[f.contable];if(!s)throw new FinError(400,'Estado contable no válido');where.push('r.accounting_status='+bind(s));}
  if(f.q)where.push(`concat_ws(' ',r.tercero,r.concepto,r.numerodocumento) ILIKE ${bind('%'+f.q+'%')}`);
  for(const [key,op] of [['from','>='],['to','<=']])if(f[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(f[key]))throw new FinError(400,'Fecha no válida');where.push(`r.fecha ${op} ${bind(f[key])}::date`);}
  const common=where.length?where.join(' AND '):'true';
  let projectWhere=common;
  if(f.project){if(!uuid(f.project))throw new FinError(400,'Proyecto no válido');projectWhere+=' AND r.project_id='+bind(f.project);}
  const sql=`${BASE}, alloc AS (SELECT l.record_id,l.id,l.type,l.category,l.accounting_status,l.fecha,l.tercero,l.concepto,l.numerodocumento,l.line_number,l.document_id,
    l.importe,pa.allocated_amount asignado,pa.project_id,pr.name project_label,pr.project_id project_code,
    (l.category IN ('revenue','advance') OR l.type='cliente') ingreso
   FROM listed l JOIN ledens.project_financial_allocations pa ON pa.record_id=l.record_id JOIN ledens.projects pr ON pr.id=pa.project_id
   WHERE ($1 OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions fp WHERE fp.user_id=$2 AND fp.project_id=pa.project_id))),
   r AS (SELECT r.*,CASE WHEN r.ingreso THEN r.asignado ELSE -r.asignado END resultado FROM alloc r)`;
  const projects=(await this.query(`${sql} SELECT r.project_id id,r.project_label label,r.project_code code,
    coalesce(sum(r.resultado) FILTER(WHERE r.ingreso),0)::text ingresos,coalesce(-sum(r.resultado) FILTER(WHERE NOT r.ingreso),0)::text costes,
    sum(r.resultado)::text resultado,count(*)::int movimientos FROM r WHERE ${common} GROUP BY 1,2,3 ORDER BY sum(r.resultado) DESC,2`,params.slice(0,params.length-(f.project?1:0)))).rows;
  const t=(await this.query(`${sql} SELECT count(*)::int n,coalesce(sum(r.resultado) FILTER(WHERE r.ingreso),0)::text ingresos,
    coalesce(-sum(r.resultado) FILTER(WHERE NOT r.ingreso),0)::text costes,coalesce(sum(r.resultado),0)::text resultado FROM r WHERE ${projectWhere}`,params)).rows[0];
  const sorts={fecha:'r.fecha',importe:'r.resultado',tercero:'r.tercero',concepto:'r.concepto',proyecto:'r.project_label'};
  const page=Math.max(1,Math.min(4000,Number(f.page)||1)),pageSize=Math.max(1,Math.min(100,Number(f.pageSize)||25));
  if(!Number.isInteger(page)||!Number.isInteger(pageSize))throw new FinError(400,'Paginación no válida');
  const rows=(await this.query(`${sql} SELECT r.id,r.type,r.category,r.accounting_status,r.fecha::text fecha,r.tercero,r.concepto,r.numerodocumento,r.line_number,r.document_id,
    r.importe::text importe,r.asignado::text asignado,r.resultado::text resultado,r.ingreso,r.project_id,r.project_label,r.project_code
    FROM r WHERE ${projectWhere} ORDER BY ${sorts[f.sort]||'r.fecha'} ${f.dir==='asc'?'ASC':'DESC'} NULLS LAST,r.record_id,r.project_id
    LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`,params)).rows;
  return {proyectos:projects,totales:{movimientos:t.n,ingresos:t.ingresos,costes:t.costes,resultado:t.resultado},rows,total:t.n,page,pageSize};
 }
 // ------------------------------------------------------------- movimientos conciliados
 // Every record behind a reconciled movement (confirmed Bridge link of its
 // document, or the movement itself), with how it is classified. Admin, like the inbox.
 async reconciled({page=1,pageSize=25,q='',clase='',from='',to=''}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Los movimientos conciliados requieren administrador');
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  const params=[...this.params(),'%'+String(q).slice(0,100)+'%'],where=["concat_ws(' ',tercero,concepto,numerodocumento,movimiento) ILIKE $3"];
  if(clase){if(![...Object.keys(CLASES),'sin_clasificar','otros'].includes(clase))throw new FinError(400,'Clasificación no válida');params.push(clase);where.push('clase=$'+params.length);}
  for(const [v,op] of [[from,'>='],[to,'<=']])if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))throw new FinError(400,'Fecha no válida');params.push(v);where.push('fecha_movimiento '+op+' $'+params.length+'::date');}
  const sql=BASE+`, rec AS(SELECT l.*,${CLASE_SQL} clase,mv.fecha_movimiento,mv.movimiento,mv.origin,mv.pago,
    CASE WHEN l.type='cliente' OR l.doc_tipo='Cobrar' THEN 'cobro' WHEN l.doc_tipo='Pagar' OR l.type IN ('material','trabajador') THEN 'pago'
     WHEN mv.pago THEN 'pago' ELSE 'cobro' END sentido
    FROM listed l JOIN LATERAL(SELECT count(*)::int n,max(t.occurred_on) fecha_movimiento,bool_or(t.amount<0) pago,
     string_agg(DISTINCT coalesce(t.concept,t.source_id),' · ') movimiento,string_agg(DISTINCT t.origin,',') origin FROM ledens.treasury_movements t
     WHERE CASE t.origin WHEN 'bank_movements' THEN t.id=l.bank_movement_id
       OR t.id IN(SELECT a.bank_movement_id FROM ledens.bank_document_allocations a WHERE a.document_id=l.document_id AND a.state='Confirmado')
      ELSE (l.type='material' AND t.material_id=l.id) OR (l.type='cliente' AND t.customer_payment_id=l.id)
       OR (l.type='trabajador' AND EXISTS(SELECT 1 FROM ledens.worker_payment_batches wb JOIN ledens.worker_payment_splits ws ON ws.batch_id=wb.id
        WHERE wb.cash_movement_id=t.id AND ws.worker_payment_id=l.id)) END) mv ON mv.n>0)
   SELECT record_id,type,version,category,clase,sentido,accounting_status,fecha,importe,tercero,concepto,numerodocumento,line_number,project_label,parts,estado,
    fecha_movimiento::text fecha_movimiento,movimiento,origin FROM rec WHERE `+where.join(' AND ');
  const rows=(await this.query(sql+` ORDER BY fecha_movimiento DESC NULLS LAST,numerodocumento,line_number NULLS FIRST,record_id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows;
  const total=(await this.query('SELECT count(*)::int n FROM ('+sql+') x',params)).rows[0].n;
  return {rows,total,page:p,pageSize:size};
 }
 async reclassify({recordId,clase,version,reason}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Cambiar la clasificación requiere administrador');
  if(!uuid(recordId))throw new FinError(404,'Registro no encontrado');
  if(!CLASES[clase])throw new FinError(400,'Clasificación no válida');
  if(!Number.isInteger(version))throw new FinError(400,'Versión no válida');
  const why=typeof reason==='string'?reason.trim():'';
  if(why.length<5||why.length>500)throw new FinError(400,'Indica el motivo del cambio (entre 5 y 500 caracteres)');
  return this.finance.transaction(async c=>{
   const r=(await c.query('SELECT * FROM ledens.financial_records WHERE id=$1 FOR UPDATE',[recordId])).rows[0];
   if(!r)throw new FinError(404,'Registro no encontrado');
   if(r.version!==version)throw new FinError(409,'El registro ha cambiado. Actualiza la lista.');
   if(!r.source_valid)throw new FinError(409,'El origen del registro necesita corrección');
   const ctx=(await c.query(`SELECT d.tipo doc_tipo,b.total_amount bank_total FROM ledens.financial_records f LEFT JOIN ledens.documents d ON d.id=f.document_id
    LEFT JOIN ledens.bank_movements b ON b.id=f.bank_movement_id WHERE f.id=$1`,[recordId])).rows[0];
   const sentido=direction({...r,...ctx});
   if(r.customer_payment_id)throw new FinError(409,'Un cobro de cliente siempre es de clientes');
   if(sentido==='pago'&&clase==='clientes')throw new FinError(409,'Un pago no puede clasificarse como cobro de clientes');
   if(sentido==='cobro'&&clase!=='clientes')throw new FinError(409,'Un cobro solo puede clasificarse como de clientes');
   const target=CLASES[clase];
   if(r.category===target||(target==='materials'&&r.category==='overhead'))throw new FinError(409,'Ya está clasificado así');
   const after=(await c.query('UPDATE ledens.financial_records SET category=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[recordId,target])).rows[0];
   await this.finance.audit(c,r,this.user,'reclassified',why,after);
   return {record_id:after.id,category:after.category,clase,version:after.version};
  });
 }
 async reconciliation({view='movimientos',page=1,pageSize=25,q='',reason='',from='',to=''}={}){
  if(this.user.role!=='admin')throw new FinError(403,'La conciliación global requiere administrador');
  if(!['registros','movimientos','documentos'].includes(view))throw new FinError(400,'Vista no válida');
  if(reason&&!['sin_documento','sin_bridge','revision','parcial','efectivo','efectivo_importado','posible_duplicado'].includes(reason))throw new FinError(400,'Motivo no válido');
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  if(!Number.isInteger(size)||!Number.isInteger(p))throw new FinError(400,'Paginación no válida');
  const params=[...this.params(),'%'+q+'%'];const where=['$1::boolean AND $2::uuid IS NOT NULL','pendiente',"concat_ws(' ',tercero,concepto,numerodocumento,referencia) ILIKE $3"];
  if(reason){params.push(reason);where.push('$'+params.length+'=ANY(motivos)');}
  for(const [v,op] of [[from,'>='],[to,'<=']])if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))throw new FinError(400,'Fecha no válida');params.push(v);where.push('fecha '+op+' $'+params.length+'::date');}
  // Aggregate each Bridge side before joining: multiple links must never duplicate a source row.
  const bridge=`bridge_doc AS(SELECT document_id,count(*)::int enlaces,count(*) FILTER(WHERE state<>'Confirmado' OR state IS NULL)::int revision,coalesce(sum(allocated_amount) FILTER(WHERE state='Confirmado'),0) confirmado FROM ledens.bank_document_allocations GROUP BY document_id),
  bridge_bank AS(SELECT a.bank_movement_id,count(*)::int enlaces,count(*) FILTER(WHERE a.state<>'Confirmado' OR a.state IS NULL)::int revision,coalesce(sum(a.allocated_amount) FILTER(WHERE a.state='Confirmado'),0) confirmado,string_agg(DISTINCT coalesce(d.numerodocumento,'Sin número'),', ') documentos FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id GROUP BY a.bank_movement_id)`;
  const hideCovered=await hasPurchases(this.pool)?"NOT EXISTS(SELECT 1 FROM ledens.v_purchase_coverage pc WHERE pc.document_id=x.id AND pc.paid>=pc.goods_gross)":'true';
  let base;
  if(view==='registros')base=BASE+', '+bridge+`, candidates AS(SELECT l.id,l.type,l.fecha,l.tercero,l.concepto,l.numerodocumento,l.id::text referencia,l.importe,l.document_id,
    coalesce(a.enlaces,0) enlaces,coalesce(a.confirmado,0)::text conciliado,
    array_remove(ARRAY[CASE WHEN l.document_id IS NULL THEN 'sin_documento' END,CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_bridge' END,
     CASE WHEN a.revision>0 THEN 'revision' END,CASE WHEN a.enlaces>0 AND coalesce(a.confirmado,0)<>d.total THEN 'parcial' END],NULL) motivos,
    (l.document_id IS NULL OR coalesce(a.enlaces,0)=0 OR a.revision>0 OR coalesce(a.confirmado,0)<>d.total) pendiente
    FROM listed l LEFT JOIN ledens.documents d ON d.id=l.document_id LEFT JOIN bridge_doc a ON a.document_id=l.document_id)`;
  else if(view==='movimientos')base='WITH '+bridge+', '+TREASURY_CANDIDATES;
  else base='WITH '+bridge+`, candidates AS(SELECT x.id,'documento'::text type,x.document_on fecha,x.tercero,to_jsonb(x)->>'descripcion' concepto,x.numerodocumento,x.id::text referencia,x.total importe,x.id document_id,
    coalesce(a.enlaces,0) enlaces,coalesce(a.confirmado,0)::text conciliado,
    array_remove(ARRAY[CASE WHEN coalesce(a.enlaces,0)=0 THEN 'sin_bridge' END,CASE WHEN a.revision>0 THEN 'revision' END,CASE WHEN a.enlaces>0 AND coalesce(a.confirmado,0)<>x.total THEN 'parcial' END],NULL) motivos,
    (coalesce(a.enlaces,0)=0 OR a.revision>0 OR coalesce(a.confirmado,0)<>x.total) pendiente
    FROM ledens.documents x LEFT JOIN bridge_doc a ON a.document_id=x.id WHERE `+hideCovered+`)`;
  const filtered=base+' SELECT *, (importe-coalesce(conciliado::numeric,0))::text por_conciliar FROM candidates WHERE '+where.join(' AND ');
  const rows=(await this.query(filtered+' ORDER BY fecha DESC NULLS LAST,id LIMIT '+size+' OFFSET '+((p-1)*size),params)).rows;
  const total=(await this.query('SELECT count(*)::int n FROM ('+filtered+') matching',params)).rows[0].n;
  // «Asignar documento» (former «Pendiente de bridge movimientos documentos») works
  // on each bank movement of this inbox: it needs the movement as the Bridge sees it.
  const ids=rows.filter(r=>r.type==='movimiento').map(r=>r.id);
  if(ids.length){
   const banks=new Map((await this.query('SELECT * FROM ledens.bank_movements WHERE id=ANY($1::uuid[])',[ids])).rows.map(b=>[b.id,b]));
   for(const r of rows){const b=r.type==='movimiento'&&banks.get(r.id);if(b)r.bank={id:b.id,description:b.description,reference:b.reference,total_amount:String(b.total_amount),
    remaining:r.por_conciliar,state:b.state,currency:b.currency,bank_fingerprint:bankFingerprint(b)};}
  }
  return {rows,total,page:p,pageSize:size};
 }
 // ------------------------------------------------------------- documentos sin asignar
 // Every processed document (ledens.documents, non-zero total) with no movement
 // assigned: no confirmed Bridge link. A delivery already paid by an Obramat
 // advance needs no movement and is left out. Admin, like the Bridge.
 async unassignedDocuments({page=1,pageSize=25,q='',tipo='',estado='',from='',to=''}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Los documentos sin asignar requieren administrador');
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  if(!Number.isInteger(size)||!Number.isInteger(p))throw new FinError(400,'Paginación no válida');
  const params=['%'+String(q).slice(0,100)+'%'],where=["concat_ws(' ',d.numerodocumento,d.tercero,d.niftercero) ILIKE $1"];
  if(tipo){if(!['Pagar','Cobrar'].includes(tipo))throw new FinError(400,'Tipo no válido');params.push(tipo);where.push('d.tipo=$'+params.length);}
  if(estado){if(!['sin_enlace','revision'].includes(estado))throw new FinError(400,'Estado no válido');where.push(estado==='revision'?'x.revision>0':'x.revision=0');}
  for(const [v,op] of [[from,'>='],[to,'<=']])if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))throw new FinError(400,'Fecha no válida');params.push(v);where.push('d.document_on '+op+' $'+params.length+'::date');}
  const covered=await hasPurchases(this.pool)?' AND NOT EXISTS(SELECT 1 FROM ledens.v_purchase_coverage pc WHERE pc.document_id=d.id AND pc.paid>=pc.goods_gross)':'';
  const from_=`FROM ledens.documents d LEFT JOIN ledens.bridge_cases c ON c.document_id=d.id
   LEFT JOIN LATERAL(SELECT count(*) FILTER(WHERE a.state IS DISTINCT FROM 'Confirmado')::int revision,count(*) FILTER(WHERE a.state='Confirmado')::int confirmados
    FROM ledens.bank_document_allocations a WHERE a.document_id=d.id) x ON true
   WHERE d.total<>0 AND x.confirmados=0${covered} AND `+where.join(' AND ');
  const rows=(await this.query(`SELECT d.id,d.document_on::text fecha,d.numerodocumento,d.tercero,d.niftercero,d.tipo,d.total::text total,d.enlacearchivo,
   coalesce(c.status,'pending') bridge_estado,c.reason bridge_motivo,x.revision,
   (SELECT count(*)::int FROM ledens.financial_records r WHERE r.document_id=d.id AND r.source_valid AND r.status<>'excluded') registros
   ${from_} ORDER BY d.document_on DESC NULLS LAST,d.numerodocumento,d.id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows
   .map(({enlacearchivo,...r})=>({...r,archivo:safeDocumentUrl(enlacearchivo)}));
  const t=(await this.query(`SELECT count(*)::int n,coalesce(sum(abs(d.total)) FILTER(WHERE d.tipo='Pagar'),0)::text pagar,
   coalesce(sum(abs(d.total)) FILTER(WHERE d.tipo='Cobrar'),0)::text cobrar ${from_}`,params)).rows[0];
  return {rows,total:t.n,importes:{pagar:t.pagar,cobrar:t.cobrar},page:p,pageSize:size};
 }
 // ------------------------------------------------------------- concepto de movimientos
 // Every bank movement (internal transfers aside) and cash entry, classified as
 // Pago de materiales, Pago a trabajadores or Cobro de clientes. The class is
 // concluded from what is registered for it: the records of the documents the
 // Bridge confirmed for it, its own records (imported source rows, client
 // receipts, cash) and its worker batch. Anything unknown, or nothing at all,
 // leaves it «pendiente»: profitability needs every movement classified.
 async movements({page=1,pageSize=25,q='',clase='',from='',to=''}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Clasificar movimientos requiere administrador');
  const size=Math.min(100,Math.max(1,Number(pageSize)||25)),p=Math.max(1,Math.min(4000,Number(page)||1));
  if(!Number.isInteger(size)||!Number.isInteger(p))throw new FinError(400,'Paginación no válida');
  const params=['%'+String(q).slice(0,100)+'%'],where=["concat_ws(' ',tercero,concepto,referencia,documentos) ILIKE $1"];
  for(const [v,op] of [[from,'>='],[to,'<=']])if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))throw new FinError(400,'Fecha no válida');params.push(v);where.push('fecha '+op+' $'+params.length+'::date');}
  const MOVEMENTS_SQL=await this.movementsSql();
  const counts=(await this.query(MOVEMENTS_SQL+' SELECT clase,count(*)::int n FROM fin WHERE '+where.join(' AND ')+' GROUP BY clase',params)).rows;
  const resumen=Object.fromEntries(MOVEMENT_CLASSES.map(k=>[k,0]));for(const r of counts)resumen[r.clase]=r.n;
  if(clase){if(!MOVEMENT_CLASSES.includes(clase))throw new FinError(400,'Clasificación no válida');params.push(clase);where.push('clase=$'+params.length);}
  const sql=MOVEMENTS_SQL+MOVEMENT_COLUMNS+' FROM fin WHERE '+where.join(' AND ');
  const rows=(await this.query(sql+` ORDER BY fecha DESC NULLS LAST,id LIMIT ${size} OFFSET ${(p-1)*size}`,params)).rows;
  const total=(await this.query('SELECT count(*)::int n FROM ('+sql+') x',params)).rows[0].n;
  return {rows,total,resumen,page:p,pageSize:size};
 }
 async movementsSql(c=this.pool){return movementsSql(await hasPurchases(c));}
 // What the Obramat rule needs to know about one movement (bank or cash).
 async obramatInfo(c,id,b,k){
  const text=(b?[b.beneficiary_name,b.payer,b.description,b.reference]:[k.counterparty,k.concept]).filter(Boolean).join(' ');
  const purchases=await hasPurchases(c);
  const docs=b?(await c.query(`SELECT ${isObramatDoc('d')} obramat,${purchases?"EXISTS(SELECT 1 FROM ledens.purchase_documents pd WHERE pd.document_id=d.id AND pd.kind IN ('advance','advance_refund'))":'false'} compra
   FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id WHERE a.bank_movement_id=$1 AND a.state='Confirmado'`,[id])).rows:[];
  const obramat=/obramat|bricoman/i.test(text)||docs.some(d=>d.obramat);
  return {obramat,soloCompras:obramat&&docs.length>0&&docs.every(d=>d.compra)};
 }
 // «Regla Obramat»: every pending Obramat movement is classified as Pago de
 // materiales (a receipt, as Reembolso de proveedor), through classifyMovement,
 // so each one follows the usual paths and checks. Only movements the Bridge has
 // already reconciled with a document: before that, it could not tell a native
 // advance (no record must be created) from an ordinary purchase. Runs after each periodic
 // Bridge run and from Concepto de movimientos; what cannot be classified stays
 // pending with its reason.
 async applyObramatRule({limit=200}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Clasificar movimientos requiere administrador');
  const rows=(await this.query(await this.movementsSql()+" SELECT id,version,importe FROM fin WHERE obramat AND clase='pendiente' AND n_docs>0 ORDER BY fecha,id LIMIT $1",[Math.min(500,Math.max(1,Number(limit)||200))])).rows;
  const results=[];
  for(const r of rows){
   const clase=Number(r.importe)>0?'reembolso_proveedor':'materiales';
   try{results.push({id:r.id,ok:true,...await this.classifyMovement({id:r.id,clase,version:r.version,reason:'Regla Obramat: sus pagos y cobros son siempre pagos de materiales'})});}
   catch(e){if(!(e instanceof FinanceError))throw e;results.push({id:r.id,ok:false,clase,error:e.message});}
  }
  return {evaluados:rows.length,clasificados:results.filter(r=>r.ok).length,errores:results.filter(r=>!r.ok).length,results};
 }
 // ------------------------------------------------------------- materiales sin registro
 // ledens.material_expenses rows with no financial record: 006's backfill and
 // sync trigger skip a material whose total is NULL, zero or has more than two
 // decimals (an imported line with a long unit price), so it counts nowhere — not
 // in any list nor in profitability — and its bank movement stays pending. The
 // source row is never changed. A record is created with the total rounded to
 // cents, only when it cannot count twice:
 //  * NULL / zero total: left out;
 //  * linked to a bank movement: only if the movement (and its reconciled
 //    documents) has no active record, and the movement's unregistered materials
 //    add up to the payment; without a document of its own each becomes the
 //    provisional payment (026/029 replace it with the invoice's concepts);
 //  * linked only to a document: only if the document has no active record;
 //  * neither: registered.
 // apply=false only reports the plan.
 async registerOrphans(c=this.pool,{bankMovementId=null,ids=null,apply=false,limit=2000}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Registrar materiales requiere administrador');
  if(ids&&(!Array.isArray(ids)||ids.length>500||ids.some(x=>!uuid(x))))throw new FinError(400,'Lista de materiales no válida');
  const rows=(await c.query(`SELECT me.id,me.total::text total,round(-me.total,2)::text gross,me.description,me.occurred_on::text fecha,me.bank_movement_id,me.document_id,me.project_id,
    CASE WHEN me.total IS NULL THEN 'sin_importe' WHEN me.total=0 THEN 'importe_cero' WHEN me.total<>round(me.total,2) THEN 'mas_de_2_decimales' ELSE 'sin_registro' END motivo,
    b.total_amount::text pago,b.description concepto_pago,d.numerodocumento,
    (me.bank_movement_id IS NOT NULL AND EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.source_valid AND r.status<>'excluded' AND (r.bank_movement_id=me.bank_movement_id
      OR r.document_id IN(SELECT document_id FROM ledens.bank_document_allocations WHERE bank_movement_id=me.bank_movement_id AND state='Confirmado')))) movimiento_con_registros,
    (me.document_id IS NOT NULL AND EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.document_id=me.document_id AND r.source_valid AND r.status<>'excluded')) documento_con_registros
   FROM ledens.material_expenses me LEFT JOIN ledens.bank_movements b ON b.id=me.bank_movement_id LEFT JOIN ledens.documents d ON d.id=me.document_id
   WHERE NOT EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.material_id=me.id)
    AND ($1::uuid IS NULL OR me.bank_movement_id=$1) AND ($2::uuid[] IS NULL OR me.id=ANY($2::uuid[]))
   ORDER BY me.occurred_on DESC NULLS LAST,me.id LIMIT ${Math.min(5000,Math.max(1,Number(limit)||2000))}`,[bankMovementId,ids])).rows;
  // The movement's unregistered materials must add up to the payment.
  const sums=new Map();
  for(const r of rows)if(r.bank_movement_id&&!['sin_importe','importe_cero'].includes(r.motivo))sums.set(r.bank_movement_id,(sums.get(r.bank_movement_id)||0n)+(cents(r.gross)??0n));
  const filas=rows.map(r=>{
   const f={...r,accion:'registrar',motivo_accion:null,provisional:false};
   const omit=m=>Object.assign(f,{accion:'omitir',motivo_accion:m});
   if(r.motivo==='sin_importe')return omit('el material no tiene importe');
   if(r.motivo==='importe_cero'||cents(r.gross)===0n)return omit('el importe es cero');
   if(r.bank_movement_id){
    if(r.movimiento_con_registros)return omit('su movimiento ya tiene registros: contaría dos veces');
    const sum=sums.get(r.bank_movement_id),pago=cents(r.pago);
    if(pago===null||sum!==-pago)return omit(`los materiales sin registro de su movimiento suman ${decimal(sum??0n)} € y el pago ${decimal(pago===null?0n:(pago<0n?-pago:pago))} €`);
    f.provisional=!r.document_id;
   }else if(r.documento_con_registros)return omit('su documento ya tiene conceptos: contaría dos veces');
   return f;
  });
  const resumen={total:filas.length,registrar:filas.filter(x=>x.accion==='registrar').length,omitir:filas.filter(x=>x.accion==='omitir').length,
   por_motivo:Object.fromEntries([...new Set(filas.map(x=>x.motivo))].map(m=>[m,filas.filter(x=>x.motivo===m).length]))};
  if(!apply)return {resumen,filas};
  const run=async t=>{
   for(const f of filas.filter(x=>x.accion==='registrar')){
    const rec=(await t.query(`INSERT INTO ledens.financial_records(material_id,document_id,bank_movement_id,occurred_on,description,category,gross_amount)
     VALUES($1,$2,$3,$4,$5,'materials',$6) RETURNING *`,[f.id,f.document_id,f.bank_movement_id,f.fecha,f.description,f.gross])).rows[0];
    if(f.project_id)await t.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES($1,$2,$3)',[rec.id,f.project_id,rec.gross_amount]);
    if(f.provisional)await t.query('INSERT INTO ledens.provisional_material_payments(material_id,bank_movement_id,created_by) VALUES($1,$2,$3) ON CONFLICT(material_id) DO UPDATE SET replaced_at=NULL,replaced_by_document_id=NULL',[f.id,f.bank_movement_id,this.user.id]);
    await this.finance.audit(t,rec,this.user,'source_registered',`Material importado sin registro contable (${f.motivo}): registrado con ${f.gross} €${f.provisional?' como pago de materiales provisional':''}`,rec);
    f.record_id=rec.id;
   }
  };
  if(c===this.pool)await this.finance.transaction(run);else await run(c);
  return {resumen,filas};
 }
 // Read-only diagnosis of one movement (admins): everything Concepto de
 // movimientos decides from, including excluded records and their last events,
 // so a movement that cannot be classified can be explained without database
 // access. Reads only; never changes anything.
 async movementDiagnosis(id){
  if(this.user.role!=='admin')throw new FinError(403,'El diagnóstico de movimientos requiere administrador');
  if(!uuid(id))throw new FinError(404,'Movimiento no encontrado');
  const one=async(sql,p=[id])=>(await this.query(sql,p)).rows;
  const bank=(await one(`SELECT id,source_id,completed_on::text fecha,type,state,description,reference,payer,beneficiary_name,total_amount::text total_amount,currency,is_internal_transfer
   FROM ledens.bank_movements WHERE id=$1`))[0]||null;
  const cash=bank?null:(await one(`SELECT id,kind,amount::text amount,occurred_on::text fecha,concept,counterparty,assigned_to,material_id,customer_payment_id FROM ledens.cash_movements WHERE id=$1`))[0]||null;
  if(!bank&&!cash)throw new FinError(404,'Movimiento no encontrado');
  const fila=(await one((await this.movementsSql())+MOVEMENT_COLUMNS+' FROM fin WHERE id=$1'))[0]||null;
  const purchases=await hasPurchases(this.pool);
  const documentos=bank?await one(`SELECT a.document_id,d.numerodocumento,d.tipo,d.total::text total,d.tercero,a.state,a.allocated_amount::text asignado,
    (SELECT count(*)::int FROM ledens.financial_records r WHERE r.document_id=d.id AND r.source_valid AND r.status<>'excluded') conceptos_activos,
    (SELECT count(*)::int FROM ledens.financial_records r WHERE r.document_id=d.id AND NOT (r.source_valid AND r.status<>'excluded')) conceptos_excluidos,
    ${purchases?'(SELECT pd.kind FROM ledens.purchase_documents pd WHERE pd.document_id=d.id)':'NULL'} compra_nativa
   FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id WHERE a.bank_movement_id=$1 ORDER BY d.numerodocumento`):[];
  const registros=await one(`SELECT r.id,CASE WHEN r.material_id IS NOT NULL THEN 'material' WHEN r.worker_payment_id IS NOT NULL THEN 'trabajador' WHEN r.customer_payment_id IS NOT NULL THEN 'cliente' ELSE 'concepto' END tipo,
    r.material_id,r.worker_payment_id,r.customer_payment_id,r.document_id,r.bank_movement_id,r.category,r.status,r.source_valid,r.gross_amount::text importe,r.created_at,
    (SELECT json_agg(e ORDER BY e.id DESC) FROM (SELECT e.id,e.action,e.reason,e.created_at FROM ledens.finance_events e WHERE e.record_id=r.id ORDER BY e.id DESC LIMIT 5) e) eventos,
    (SELECT json_agg(json_build_object('project_id',pa.project_id,'importe',pa.allocated_amount)) FROM ledens.project_financial_allocations pa WHERE pa.record_id=r.id) obras
   FROM ledens.financial_records r WHERE r.bank_movement_id=$1
    OR r.document_id IN(SELECT document_id FROM ledens.bank_document_allocations WHERE bank_movement_id=$1)
    OR r.material_id IN(SELECT id FROM ledens.material_expenses WHERE bank_movement_id=$1)
    OR r.material_id=$2 OR r.customer_payment_id=$3
    -- Worker payments saved from its batch (a cash batch's have no bank movement).
    OR r.worker_payment_id IN(SELECT s.worker_payment_id FROM ledens.worker_payment_splits s JOIN ledens.worker_payment_batches wb ON wb.id=s.batch_id
     WHERE (wb.bank_movement_id=$1 OR wb.cash_movement_id=$1) AND s.worker_payment_id IS NOT NULL)
   ORDER BY r.created_at,r.id`,[id,cash?.material_id||null,cash?.customer_payment_id||null]);
  const provisionales=bank?await one(`SELECT material_id,created_at,replaced_at,replaced_by_document_id,carried_project_id FROM ledens.provisional_material_payments WHERE bank_movement_id=$1`):[];
  const lote=(await one('SELECT id,role,total_amount::text total FROM ledens.worker_payment_batches WHERE bank_movement_id=$1 OR cash_movement_id=$1'))[0]||null;
  const transferencia=bank&&await hasTransfers(this.pool)?(await one('SELECT marked_at,reason FROM ledens.internal_transfers WHERE bank_movement_id=$1'))[0]||null:null;
  const materiales=bank?await one(`SELECT me.id,me.total::text total,me.document_id,me.project_id,
    EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.material_id=me.id) con_registro FROM ledens.material_expenses me WHERE me.bank_movement_id=$1 ORDER BY me.id`):[];
  return {movimiento:bank||cash,origen:bank?'banco':'efectivo',fila,documentos,registros,materiales,provisionales,lote,transferencia};
 }
 // Sidebar badge of «Concepto de movimientos»: movements still pending of classification.
 async movementsPending(){
  if(this.user.role!=='admin')throw new FinError(403,'Clasificar movimientos requiere administrador');
  return {pendientes:(await this.query(await this.movementsSql()+" SELECT count(*)::int n FROM fin WHERE clase='pendiente'")).rows[0].n};
 }
 // Manual class of one movement. With records (its documents' or its own) their
 // category changes, audited per record; with nothing registered the movement
 // enters through the usual flow: Pendiente de trabajador, a client payment or a
 // material expense tied to it (006's triggers then create its record).
 async classifyMovement({id,clase,version,reason}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Clasificar movimientos requiere administrador');
  if(!uuid(id))throw new FinError(404,'Movimiento no encontrado');
  if(!MOVEMENT_CLASES[clase]&&clase!=='transferencia')throw new FinError(400,'Clasificación no válida');
  if(typeof version!=='string'||!/^[0-9a-f]{32}$/.test(version))throw new FinError(400,'Versión no válida');
  const why=typeof reason==='string'?reason.trim():'';
  if(why.length>500)throw new FinError(400,'Motivo no válido (máximo 500 caracteres)');
  return this.finance.transaction(async c=>{
   // The view tells where the movement lives; the row is locked in its own table.
   const t=(await c.query('SELECT origin,validable FROM ledens.treasury_movements WHERE id=$1',[id])).rows[0];
   if(!t||(t.origin==='cash_movements'&&!t.validable))throw new FinError(404,'Movimiento no encontrado');
   const b=t.origin==='bank_movements'?(await c.query('SELECT * FROM ledens.bank_movements WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
   // abs_amount: an imported amount keeps its sign and scale (-80.0000); cents() reads two decimals.
   const k=t.origin==='cash_movements'?(await c.query('SELECT *,round(abs(amount),2)::text abs_amount FROM ledens.cash_movements WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
   if(!b&&!k)throw new FinError(404,'Movimiento no encontrado');
   if(b?.is_internal_transfer)throw new FinError(409,'Es un traspaso interno');
   // An imported cash amount keeps its own sign (030): the direction is its kind.
   const cash=k?cents(k.abs_amount):null;
   const amount=b?cents(b.total_amount):cash===null?null:k.kind==='pago'?-cash:cash;
   if(amount===null||amount===0n)throw new FinError(409,'El movimiento no tiene un importe válido');
   // «Transferencia entre cuentas»: marked, or unmarked to classify it otherwise.
   const transfers=await hasTransfers(c);
   const marked=b&&transfers&&(await c.query('SELECT 1 FROM ledens.internal_transfers WHERE bank_movement_id=$1',[id])).rows.length>0;
   if(clase==='transferencia'){
    if(!transfers)throw new FinError(503,'Las transferencias entre cuentas no están disponibles todavía');
    if(!b)throw new FinError(409,'Un movimiento en efectivo no puede ser una transferencia entre cuentas');
    if(marked)throw new FinError(409,'Ya está clasificado así');
    if(!ownTransfer(b))throw new FinError(409,'Solo un movimiento con otra cuenta de Sociedad Inversora Navarro Robinson (o un «TRASPASO» sin beneficiario ni ordenante) puede ser una transferencia entre cuentas');
    if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[id])).rows.length)throw new FinError(409,'Está en Pendiente de trabajador: devuélvelo a conciliación desde esa pantalla para cambiarlo');
    if((await c.query("SELECT 1 FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state='Confirmado' LIMIT 1",[id])).rows.length)throw new FinError(409,'Está conciliado con un documento: una transferencia entre cuentas no tiene factura');
    if((await c.query("SELECT 1 FROM ledens.financial_records WHERE bank_movement_id=$1 AND source_valid AND status<>'excluded' LIMIT 1",[id])).rows.length)throw new FinError(409,'Ya tiene registros contables: no puede ser una transferencia entre cuentas');
    await c.query('INSERT INTO ledens.internal_transfers(bank_movement_id,marked_by,reason) VALUES($1,$2,$3)',[id,this.user.id,why||null]);
    return {id,clase,via:'transferencia'};
   }
   if(marked){
    if(why.length<5)throw new FinError(400,'Indica el motivo del cambio (al menos cinco caracteres)');
    await c.query('DELETE FROM ledens.internal_transfers WHERE bank_movement_id=$1',[id]);
   }
   if(amount<0n&&clase==='clientes')throw new FinError(409,'Un pago no puede clasificarse como cobro de clientes');
   if(amount<0n&&clase==='reembolso_proveedor')throw new FinError(409,'Un pago no puede ser un reembolso de proveedor');
   if(amount>0n&&!['clientes','reembolso_proveedor'].includes(clase))throw new FinError(409,'Un cobro solo puede ser cobro de clientes o reembolso de proveedor');
   const ob=await this.obramatInfo(c,id,b,k);
   if(ob.obramat&&!['materiales','reembolso_proveedor'].includes(clase))throw new FinError(409,'Los movimientos de Obramat siempre son pagos de materiales');
   if(ob.soloCompras)throw new FinError(409,'Es una compra de Obramat con anticipo: ya cuenta como pago de materiales y su coste entra con la factura de entrega');
   const ids=(await c.query(`SELECT DISTINCT r.id FROM ledens.financial_records r WHERE r.source_valid AND r.status<>'excluded' AND (
     r.bank_movement_id=$1 OR r.document_id IN(SELECT document_id FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state='Confirmado')
     OR r.material_id=$2 OR r.customer_payment_id=$3)`,[id,k?.material_id||null,k?.customer_payment_id||null])).rows.map(r=>r.id);
   const records=(await c.query('SELECT * FROM ledens.financial_records WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
   const current=createHash('md5').update(records.map(r=>r.id+':'+r.version).join(',')).digest('hex');
   if(current!==version)throw new FinError(409,'El movimiento ha cambiado. Actualiza la lista.');
   if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE bank_movement_id=$1 OR cash_movement_id=$1',[id])).rows.length)
    throw new FinError(409,clase==='trabajadores'?'Ya está en pagos a trabajadores':'Está en Pendiente de trabajador: devuélvelo a conciliación desde esa pantalla para cambiarlo');
   // A reconciled document without concepts never blocks the classification here:
   // with nothing registered the movement enters through its usual flow (a
   // provisional material that waits for every invoice, 029; a worker batch; a
   // client receipt; a refund), and with records those are classified. What the
   // document lacks is reported when its record is assigned to an obra
   // (missingConcepts).
   // A supplier refund is registered as a material from the movement itself. A
   // receipt that already has records (its reconciled document, a client receipt)
   // keeps them: those records carry the sign of revenue, so turning them into
   // materials would add cost instead of lowering it.
   if(clase==='reembolso_proveedor'){
    if(!b)throw new FinError(409,'Un reembolso de proveedor en efectivo todavía no se puede registrar');
    // A credit note reconciled with the refund, with its concepts unclassified:
    // its lines carry the sign of revenue, so they are excluded (never deleted,
    // audited) and the refund is registered once, from the movement, as a
    // material that lowers the cost.
    if(records.length){
     const docs=(await c.query("SELECT a.document_id,d.tipo FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id WHERE a.bank_movement_id=$1 AND a.state='Confirmado'",[id])).rows;
     const notes=new Map(docs.map(d=>[d.document_id,d.tipo]));
     const allocated=(await c.query('SELECT DISTINCT record_id FROM ledens.project_financial_allocations WHERE record_id=ANY($1::uuid[])',[records.map(r=>r.id)])).rows.length;
     if(allocated||records.some(r=>!r.invoice_line_id||notes.get(r.document_id)!=='Cobrar'||r.status!=='pending'||r.category!=='unclassified'))
      throw new FinError(409,'Este cobro tiene registros ya clasificados, aprobados o con obra (o un cobro de cliente): revísalos antes de registrarlo como reembolso de proveedor');
     // A credit note's lines may be stored negative (the usual sign of an abono) or
     // positive (as a Cobrar document): they are excluded anyway, so only their
     // size has to match the refund, all with the same sign.
     const sum=records.reduce((t,r)=>t+cents(r.gross_amount),0n);
     if(new Set(records.map(r=>cents(r.gross_amount)>0n)).size>1)throw new FinError(409,'Los conceptos del abono conciliado mezclan importes positivos y negativos: revisa el abono antes de registrarlo como reembolso de proveedor');
     if((sum<0n?-sum:sum)!==amount)throw new FinError(409,`Los conceptos del abono conciliado suman ${decimal(sum)} € y el cobro ${decimal(amount)} €: revisa el abono antes de registrarlo como reembolso de proveedor`);
     for(const r of records){
      const after=(await c.query("UPDATE ledens.financial_records SET status='excluded',source_valid=false,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[r.id])).rows[0];
      await this.finance.audit(c,r,this.user,'refund_replaced','Concepto del abono sustituido por el reembolso de proveedor registrado desde el movimiento',after);
     }
    }
    return {id,clase,via:'material',...await this.materialPaymentOne(c,b,{provisional:false})};
   }
   if(amount>0n&&records.some(r=>r.material_id))throw new FinError(409,'Es un reembolso de proveedor registrado en Materiales; no se puede cambiar desde aquí');
   if(records.length){
    const target=CLASES[clase],same=r=>r.category===target||(target==='materials'&&r.category==='overhead');
    const changing=records.filter(r=>!same(r));
    if(!changing.length)throw new FinError(409,'Ya está clasificado así');
    if(changing.some(r=>r.customer_payment_id))throw new FinError(409,'Un cobro de cliente siempre es de clientes');
    // Changing what was already classified needs its reason, like «Movimientos conciliados».
    if(changing.some(r=>r.category!=='unclassified')&&why.length<5)throw new FinError(400,'Indica el motivo del cambio (al menos cinco caracteres)');
    const text=why||'Clasificación del movimiento en Concepto de movimientos';
    for(const r of changing){
     const after=(await c.query('UPDATE ledens.financial_records SET category=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[r.id,target])).rows[0];
     await this.finance.audit(c,r,this.user,'reclassified',text,after);
    }
    return {id,clase,via:'registros',changed:changing.length};
   }
   if(clase==='trabajadores')return {id,clase,via:'pendiente-trabajador',...(b?await this.classifyOne(c,id,{allowReconciled:true}):await this.classifyCash(c,id))};
   if(!b){const kk=await this.cashForUpdate(c,id);return {id,clase,via:'efectivo',...await this.assignCashIn(c,kk,clase,null,'')};}
   if(clase==='clientes')return {id,clase,via:'cobro-cliente',...await this.customerPaymentOne(c,id,null,{allowReconciled:true})};
   return {id,clase,via:'material',...await this.materialPaymentOne(c,b)};
  });
 }
 // «Segregar conceptos» in Materiales pendiente de asignación: a provisional
 // material (a bank payment classified as Pago de materiales) is replaced by the
 // concepts of the invoice the Bridge reconciled with its movement (026). When
 // that invoice has no concepts, segregating fails with its number, and the
 // admin can attach the document with the detail of its products (below).
 async segregateMaterial(materialId){
  if(this.user.role!=='admin')throw new FinError(403,'Segregar conceptos requiere administrador');
  if(!uuid(materialId))throw new FinError(404,'Material no encontrado');
  return this.finance.transaction(async c=>{
   const p=(await c.query('SELECT * FROM ledens.provisional_material_payments WHERE material_id=$1 FOR UPDATE',[materialId])).rows[0];
   if(!p||p.replaced_at)throw new FinError(409,'No es un pago de materiales provisional: no hay conceptos de factura que segregar');
   const docs=(await c.query(`SELECT d.id,d.numerodocumento,d.total::text total,
     EXISTS(SELECT 1 FROM ledens.financial_records r WHERE r.document_id=d.id AND r.source_valid AND r.status<>'excluded') conceptos
     FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id
     WHERE a.bank_movement_id=$1 AND a.state='Confirmado' ORDER BY d.numerodocumento,d.id`,[p.bank_movement_id])).rows;
   if(!docs.length)throw new FinError(409,'El movimiento de este pago no tiene ninguna factura conciliada: concíliala en el Bridge para segregar sus conceptos');
   const bare=docs.filter(d=>!d.conceptos);
   if(bare.length)throw new FinError(409,`El documento ${bare[0].numerodocumento||'conciliado'} no tiene conceptos registrados; revisa su ingesta o adjunta el documento con el detalle de sus productos para segregar sus conceptos`,
    {movimiento_id:p.bank_movement_id,sin_conceptos:bare.map(({conceptos,...d})=>d)});
   // Normally done by 026's triggers already; this covers a document whose records came first.
   await c.query('SELECT ledens.replace_provisional_materials($1)',[p.bank_movement_id]);
   return {material_id:materialId,segregado:true,documentos:docs.map(d=>d.numerodocumento)};
  });
 }
 // «Adjuntar detalle»: a document the Bridge reconciled with this bank movement
 // has no concepts (its OCR found no lines). The admin attaches the document with the detail
 // of its products (albarán, ticket, invoice copy); the OCR reads its lines and
 // they become the document's concepts, through the same storeInvoiceLines as the
 // ingestion, only when they add up exactly to the document's total. Nothing is
 // stored otherwise, and the file itself is not kept (only its hash, audited).
 async attachDocumentDetail({id,documentId,content,ocr,timeoutMs=40000,pollMs=1500}={}){
  if(this.user.role!=='admin')throw new FinError(403,'Adjuntar el detalle de un documento requiere administrador');
  if(!uuid(id))throw new FinError(404,'Movimiento no encontrado');
  if(!uuid(documentId))throw new FinError(404,'Documento no encontrado');
  if(!Buffer.isBuffer(content)||!content.length)throw new FinError(400,'Adjunta el documento con el detalle de los productos');
  if(content.length>DETAIL_MAX_BYTES)throw new FinError(413,'El documento supera 4 MB, el máximo que admite el lector');
  const type=DETAIL_TYPES.find(([,ok])=>ok(content))?.[0];
  if(!type)throw new FinError(415,'Formato no admitido: adjunta un PDF, JPG o PNG');
  if(!ocr)throw new FinError(503,'La lectura de documentos no está configurada');
  const check=async c=>{
   const d=(await c.query(`SELECT d.* FROM ledens.documents d JOIN ledens.bank_document_allocations a ON a.document_id=d.id
    WHERE d.id=$1 AND a.bank_movement_id=$2 AND a.state='Confirmado' LIMIT 1`,[documentId,id])).rows[0];
   if(!d)throw new FinError(404,'El documento no está conciliado con este movimiento');
   if((await c.query("SELECT 1 FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded' LIMIT 1",[documentId])).rows.length)
    throw new FinError(409,'El documento ya tiene conceptos registrados');
   if(!['Pagar','Cobrar'].includes(d.tipo))throw new FinError(409,'El documento no tiene dirección (pago o cobro); revisa su ingesta');
   return d;
  };
  await check(this.pool);
  // The OCR runs outside the transaction: no row stays locked while it reads.
  let result;
  try{
   const url=await ocr.start(content,type),until=Date.now()+timeoutMs;
   for(;;){result=await ocr.poll(url);if(!['running','notStarted'].includes(result.status))break;
    if(Date.now()>until)throw new FinError(504,'El lector tarda más de lo normal; inténtalo de nuevo en un momento');await sleep(pollMs);}
  }catch(e){if(e instanceof FinError)throw e;throw new FinError(e.transient===false?422:503,e.transient===false?'El lector no ha podido procesar el archivo':'El lector de documentos no está disponible; inténtalo de nuevo en un momento');}
  if(result.status!=='succeeded')throw new FinError(422,'El lector no ha podido leer el documento');
  const hash=createHash('sha256').update(content).digest('hex');
  const lines=extractLines(result).map(l=>({...l,evidence:{...l.evidence,attached_detail:true,attachment_sha256:hash}}));
  if(!lines.length)throw new FinError(422,'No se han encontrado productos en el documento adjunto');
  return this.finance.transaction(async c=>{
   const d=await check(c);
   const r=await storeInvoiceLines(c,documentId,lines,{currency:'EUR',direction:d.tipo,actorId:this.user.id,reason:'Detalle de productos adjuntado en Concepto de movimientos'});
   if(!r?.balanced){
    const read=lines.map(l=>cents(l.gross_amount));
    const sum=read.every(n=>n!==null)?decimal(read.reduce((a,n)=>a+n,0n)):null;
    const total=decimal(cents(d.total)<0n?-cents(d.total):cents(d.total));
    // Throwing rolls back the lines stored without records (and any envelope).
    throw new FinError(422,sum===null
     ?`Se han leído ${lines.length} productos, pero no se han podido cuadrar sus importes con el total del documento (${total} €). Adjunta un documento con el importe de cada producto.`
     :`Los productos leídos suman ${sum} € y el documento ${d.numerodocumento||''} ${total} €: no cuadran, así que no se ha registrado nada.`);
   }
   await c.query('INSERT INTO ledens.bridge_events(document_id,bank_movement_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)',
    [documentId,id,this.user.id,'detail_attached',JSON.stringify({lineas:r.line_count,attachment_sha256:hash,type})]);
   return {document_id:documentId,lineas:r.line_count};
  }).then(async res=>{
   // 026's deferred trigger has replaced the provisional material by these concepts on commit.
   const open=(await this.query('SELECT count(*)::int n FROM ledens.provisional_material_payments WHERE bank_movement_id=$1 AND replaced_at IS NULL',[id])).rows[0].n;
   return {...res,segregado:open===0};
  });
 }
 // A bank payment with no document classified as materials: a material expense
 // tied to the movement, signed like the import (a cost is negative there). It is
 // provisional: when the Bridge confirms the movement's invoice, 026 excludes it
 // and the invoice's records inherit its class and obra (no double count).
 // A supplier refund (a receipt) uses the same row with a positive total, so its
 // record lowers the material cost. It is not provisional: 026 would hand its
 // class to the lines of a receipt document, which carry the sign of revenue.
 async materialPaymentOne(c,b,{provisional=true}={}){
  if(b.currency&&b.currency!=='EUR')throw new FinError(409,'Solo movimientos en euros');
  const prev=(await c.query(`SELECT me.id material_id,me.total::text total,r.id record_id,r.status,r.source_valid,r.created_at,
    pm.material_id provisional,pm.replaced_at,pm.carried_project_id,
    (SELECT e.action FROM ledens.finance_events e WHERE e.record_id=r.id ORDER BY e.id DESC LIMIT 1) last_action
   FROM ledens.material_expenses me LEFT JOIN ledens.financial_records r ON r.material_id=me.id
   LEFT JOIN ledens.provisional_material_payments pm ON pm.material_id=me.id WHERE me.bank_movement_id=$1
   ORDER BY (pm.material_id IS NOT NULL) DESC,r.created_at DESC NULLS LAST,me.id`,[b.id])).rows;
  if(prev.length){
   if(prev.some(x=>x.record_id&&x.source_valid&&x.status!=='excluded'))throw new FinError(409,'Ya está registrado como material');
   // A material of this movement that no longer counts (026 replaced it by an
   // invoice whose concepts are gone since, or it was excluded otherwise) while
   // nothing active represents the payment: it is restored as a provisional
   // payment (audited) and 026/029 replace it again once every invoice has its
   // concepts. Never one excluded on purpose by a native Obramat purchase (its
   // cost comes with the delivery invoice), nor one for another amount.
   // A material of the movement with no financial record at all (loaded by an old
   // import that bypassed 006's trigger): it counts nowhere and blocks a new one.
   // Its record is created the usual way (006's sync trigger, by touching the row)
   // and it becomes the provisional payment, so 026/029 replace it with the
   // invoice's concepts instead of counting the cost twice.
   // Materials of the movement with no financial record at all (registerOrphans):
   // registered the safe way, as the provisional payment, when they add up to it.
   if(provisional&&prev.some(x=>!x.record_id)){
    const res=await this.registerOrphans(c,{bankMovementId:b.id,apply:true});
    const done=res.filas.filter(x=>x.accion==='registrar');
    if(done.length)return {materialId:done[0].id,recordId:done[0].record_id,provisional:true,restored:true,registrados:done.length};
    const omit=res.filas.find(x=>x.accion==='omitir');
    if(omit&&!prev.some(x=>x.record_id))throw new FinError(409,`El material de este movimiento no tiene registro contable y no se puede registrar: ${omit.motivo_accion}`);
   }
   const p=provisional?prev.find(x=>x.record_id&&x.last_action!=='purchase_source_replaced'&&cents(x.total)===cents(b.total_amount)):null;
   if(p){
    const before=(await c.query('SELECT * FROM ledens.financial_records WHERE id=$1 FOR UPDATE',[p.record_id])).rows[0];
    const after=(await c.query("UPDATE ledens.financial_records SET status='pending',source_valid=true,category='materials',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[p.record_id])).rows[0];
    // 026 took its obra away (carried_project_id) when it replaced it: give it back.
    if(p.carried_project_id&&!(await c.query('SELECT 1 FROM ledens.project_financial_allocations WHERE record_id=$1',[p.record_id])).rows.length){
     await c.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES($1,$2,$3)',[p.record_id,p.carried_project_id,after.gross_amount]);
     const name=(await c.query('SELECT name FROM ledens.projects WHERE id=$1',[p.carried_project_id])).rows[0]?.name||null;
     await c.query(`INSERT INTO ledens.finance_events(record_id,actor_id,action,reason,before_value,after_value) VALUES($1,$2,'replace_allocations','Obra recuperada al restaurar el pago de materiales provisional',$3,$4)`,
      [p.record_id,this.user.id,JSON.stringify({allocations:[]}),JSON.stringify({allocations:[{project_id:p.carried_project_id,project_name:name,allocated_amount:String(after.gross_amount)}]})]);
    }
    if(p.provisional)await c.query('UPDATE ledens.provisional_material_payments SET replaced_at=NULL,replaced_by_document_id=NULL,carried_project_id=NULL WHERE material_id=$1',[p.material_id]);
    else await c.query('INSERT INTO ledens.provisional_material_payments(material_id,bank_movement_id,created_by) VALUES($1,$2,$3)',[p.material_id,b.id,this.user.id]);
    await this.finance.audit(c,before,this.user,'provisional_restored',`Pago de materiales provisional restaurado: no contaba (${p.last_action||(before.source_valid?before.status:'origen no válido')}) y nada activo representaba el pago`,after);
    return {materialId:p.material_id,recordId:p.record_id,provisional:true,restored:true};
   }
   const why=prev.map(x=>(x.last_action||(x.record_id?x.status:'sin registro'))+(cents(x.total)!==cents(b.total_amount)?`, material de ${x.total} € y pago de ${decimal(cents(b.total_amount))} €`:'')).join('; ');
   throw new FinError(409,`Este movimiento ya tuvo un material que se excluyó (${why}) y no se puede recuperar: revisa la ingesta de su documento conciliado`);
  }
  const total=decimal(cents(b.total_amount));
  const m=(await c.query(`INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on,bank_movement_id)
   VALUES('ud',$1,1,$2,$2,$3,$4) RETURNING id`,[b.description||b.reference||b.source_id||(provisional?'Pago de materiales':'Reembolso de proveedor'),total,b.completed_on,b.id])).rows[0];
  const r=(await c.query('SELECT id FROM ledens.financial_records WHERE material_id=$1',[m.id])).rows[0];
  if(!r)throw new FinError(503,'No se pudo registrar el material en la contabilidad');
  if(!provisional)return {materialId:m.id,recordId:r.id,provisional:false};
  // Provisional until the Bridge reconciles its invoice (026 replaces it then).
  await c.query('INSERT INTO ledens.provisional_material_payments(material_id,bank_movement_id,created_by) VALUES($1,$2,$3)',[m.id,b.id,this.user.id]);
  return {materialId:m.id,recordId:r.id,provisional:true};
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
 // From Concepto de movimientos a reconciled payment may also go to Pendiente de
 // trabajador (allowReconciled); the conciliation inbox only sends unreconciled ones.
 async classifyOne(c,id,{allowReconciled=false}={}){
  const m=(await c.query('SELECT id,source_id,total_amount,currency,completed_on,is_internal_transfer FROM ledens.bank_movements WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!m)return this.classifyCash(c,id);
  if(m.is_internal_transfer)throw new FinError(409,'Es un traspaso interno');
  if(m.currency&&m.currency!=='EUR')throw new FinError(409,'Solo movimientos en euros');
  const total=cents(m.total_amount);
  if(total===null||total>=0n)throw new FinError(409,'Solo se segregan pagos salientes (importe negativo, con céntimos exactos)');
  if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[id])).rows.length)throw new FinError(409,'Ya está en Pendiente de trabajador');
  if((await c.query('SELECT 1 FROM ledens.worker_payments WHERE bank_movement_id=$1 LIMIT 1',[id])).rows.length)throw new FinError(409,'Ya tiene pagos a trabajadores registrados');
  if(!allowReconciled&&(await c.query("SELECT 1 FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state='Confirmado' LIMIT 1",[id])).rows.length)throw new FinError(409,'Ya está conciliado con un documento');
  const plan=splitWorkerPayment(-total);
  const b=(await c.query(`INSERT INTO ledens.worker_payment_batches(bank_movement_id,role,unit_amount,total_amount,occurred_on,created_by)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,plan.role,decimal(plan.unit),decimal(-total),m.completed_on,this.user.id])).rows[0];
  return this.splitBatch(c,b.id,plan);
 }
 // «Pago de clientes» in Pendiente de conciliación (admin): an incoming bank
 // movement the Bridge did not recognise becomes a ledens.customer_payments row
 // tied to that movement (006's trigger registers it as a client receipt, an
 // advance), allocated to a project when one is given. It leaves the inbox; an
 // issued invoice can still be reconciled with it later through the Bridge.
 async classifyCustomerPayments({movementIds,projectId}){
  if(this.user.role!=='admin')throw new FinError(403,'Clasificar movimientos requiere administrador');
  const ids=[...new Set(Array.isArray(movementIds)?movementIds:[])];
  if(!ids.length||ids.length>50||ids.some(id=>!uuid(id)))throw new FinError(400,'Selecciona entre 1 y 50 movimientos');
  if(projectId&&!uuid(projectId))throw new FinError(400,'Obra no válida');
  return this.finance.transaction(async c=>{
   if(projectId&&!(await c.query('SELECT 1 FROM ledens.projects WHERE id=$1',[projectId])).rows.length)throw new FinError(400,'Obra no encontrada');
   const results=[];
   for(const [i,id] of ids.entries()){
    await c.query(`SAVEPOINT c${i}`);
    try{const r=await this.customerPaymentOne(c,id,projectId);await c.query(`RELEASE SAVEPOINT c${i}`);results.push({id,ok:true,...r});}
    catch(e){await c.query(`ROLLBACK TO SAVEPOINT c${i}`);if(!(e instanceof FinanceError))throw e;results.push({id,ok:false,error:e.message});}
   }
   return {results,ok:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
  });
 }
 // From Concepto de movimientos a reconciled receipt may also become a client
 // receipt (allowReconciled): profitability then takes its cash from the
 // reconciled document, never from the receipt (no double count).
 async customerPaymentOne(c,id,projectId,{allowReconciled=false}={}){
  const m=(await c.query('SELECT id,source_id,total_amount,currency,completed_on,is_internal_transfer,payer,beneficiary_name FROM ledens.bank_movements WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!m)throw new FinError(404,'Movimiento no encontrado');
  if(m.is_internal_transfer)throw new FinError(409,'Es un traspaso interno');
  if(m.currency&&m.currency!=='EUR')throw new FinError(409,'Solo movimientos en euros');
  const total=cents(m.total_amount);
  if(total===null||total<=0n)throw new FinError(409,'Solo se registran cobros (importe positivo)');
  if((await c.query('SELECT 1 FROM ledens.customer_payments WHERE bank_movement_id=$1 LIMIT 1',[id])).rows.length)throw new FinError(409,'Ya está registrado como pago de cliente');
  if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[id])).rows.length)throw new FinError(409,'Está en Pendiente de trabajador');
  if(!allowReconciled&&(await c.query("SELECT 1 FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state='Confirmado' LIMIT 1",[id])).rows.length)throw new FinError(409,'Ya está conciliado con un documento');
  // The client is the ordering party; failing that, a reconciled document's or the obra's.
  const cliente=m.payer?.trim()||m.beneficiary_name?.trim()||(await c.query(`SELECT d.tercero FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id
   WHERE a.bank_movement_id=$1 AND nullif(btrim(d.tercero),'') IS NOT NULL ORDER BY a.state='Confirmado' DESC,d.document_on DESC NULLS LAST LIMIT 1`,[id])).rows[0]?.tercero||
   (projectId&&await this.projectCustomer(c,projectId))||null;
  const p=(await c.query(`INSERT INTO ledens.customer_payments(occurred_on,id_pago,cliente,total,bank_movement_id)
   VALUES($1,$2,$3,$4,$5) RETURNING id`,[m.completed_on,m.source_id,cliente,decimal(total),id])).rows[0];
  const r=(await c.query('SELECT id,version,gross_amount FROM ledens.financial_records WHERE customer_payment_id=$1',[p.id])).rows[0];
  if(!r)throw new FinError(503,'No se pudo registrar el cobro en la contabilidad');
  if(projectId)await this.finance.replace(c,this.user,{record_id:r.id,version:r.version,allocations:[{project_id:projectId,amount:r.gross_amount}]},`Cobro de cliente del movimiento ${m.source_id}`);
  return {customerPaymentId:p.id,recordId:r.id};
 }
 async projectCustomer(c,projectId){
  return (await c.query(`SELECT nullif(btrim(to_jsonb(p)->>'customer_name_source'),'') cliente FROM ledens.projects p WHERE id=$1`,[projectId])).rows[0]?.cliente||null;
 }
 async splitBatch(c,batchId,plan){
  for(const [i,amount] of plan.lines.entries())await c.query('INSERT INTO ledens.worker_payment_splits(batch_id,line_number,amount,role) VALUES($1,$2,$3,$4)',[batchId,i+1,decimal(amount),plan.role]);
  return {batchId,role:plan.role,lines:plan.lines.length};
 }
 // A cash payment sent to «Pago a trabajadores»: same split as a bank movement.
 async classifyCash(c,id){
  const k=(await this.cashForUpdate(c,id));
  if(k.kind!=='pago')throw new FinError(409,'Solo se segregan pagos salientes');
  const plan=splitWorkerPayment(cents(k.amount));
  await c.query("UPDATE ledens.cash_movements SET assigned_to='trabajadores',assigned_by=$2,assigned_at=now() WHERE id=$1",[id,this.user.id]);
  const b=(await c.query(`INSERT INTO ledens.worker_payment_batches(cash_movement_id,role,unit_amount,total_amount,occurred_on,created_by)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,plan.role,decimal(plan.unit),k.amount,k.occurred_on,this.user.id])).rows[0];
  return this.splitBatch(c,b.id,plan);
 }
 // ------------------------------------------------------------- efectivo
 // Pagos y cobros en efectivo (016), admin only like the inbox they live in.
 async cashForUpdate(c,id){
  if(!uuid(id))throw new FinError(404,'Movimiento no encontrado');
  // An imported row keeps the sign and scale it had in the import (030): read as two decimals.
  const k=(await c.query('SELECT id,kind,round(abs(amount),2)::text amount,occurred_on::text occurred_on,concept,counterparty,assigned_to,imported FROM ledens.cash_movements WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!k||!k.kind)throw new FinError(404,'Movimiento no encontrado');
  if(k.assigned_to==='descartado')throw new FinError(409,'Este efectivo está descartado');
  if(k.assigned_to)throw new FinError(409,'Este efectivo ya está asignado');
  return k;
 }
 cashAdmin(){if(this.user.role!=='admin')throw new FinError(403,'El efectivo requiere administrador');}
 async createCash(body={}){
  this.cashAdmin();
  const kind=body.kind,amount=cents(body.amount),concept=String(body.concept??'').trim(),counterparty=String(body.counterparty??'').trim()||null;
  if(!['pago','cobro'].includes(kind))throw new FinError(400,'Indica si es un pago o un cobro');
  if(amount===null||amount<=0n)throw new FinError(400,'El importe debe ser positivo y con 2 decimales como máximo');
  if(amount>100000000n)throw new FinError(400,'El importe es demasiado alto para efectivo');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date||'')||!Number.isFinite(Date.parse(body.date)))throw new FinError(400,'Fecha no válida');
  if(!concept||concept.length>300)throw new FinError(400,'El concepto es obligatorio (máximo 300 caracteres)');
  if(counterparty&&counterparty.length>200)throw new FinError(400,'El tercero admite 200 caracteres como máximo');
  // A client receipt always names its client (it is the «Cliente» of Pagos de clientes).
  if(kind==='cobro'&&!counterparty)throw new FinError(400,'Indica el cliente que hace el cobro');
  return (await this.pool.query(`INSERT INTO ledens.cash_movements(kind,amount,occurred_on,concept,counterparty,created_by)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id,kind,amount::text,occurred_on::text fecha,concept,counterparty`,[kind,decimal(amount),body.date,concept,counterparty,this.user.id])).rows[0];
 }
 // Only while unassigned: a mistyped entry is removed, not kept as a fake movement.
 async deleteCash(id){
  this.cashAdmin();
  return this.finance.transaction(async c=>{
   const k=await this.cashForUpdate(c,id);
   if(k.imported)throw new FinError(409,'Es un movimiento importado del Excel: no se elimina, se descarta indicando el motivo');
   if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE cash_movement_id=$1',[id])).rows.length)throw new FinError(409,'Este efectivo ya está en Pendiente de trabajador');
   await c.query('DELETE FROM ledens.cash_movements WHERE id=$1',[id]);return {deleted:true};
  });
 }
 // An imported entry that is not a cost or an income of its own (already recorded
 // as a payment, a deposit into the bank...) is discarded with a reason: it stays
 // in the table, out of the screens and of the results.
 async discardCash({id,reason}={}){
  this.cashAdmin();
  const why=typeof reason==='string'?reason.trim():'';
  if(why.length<5||why.length>500)throw new FinError(400,'Indica el motivo (entre 5 y 500 caracteres)');
  return this.finance.transaction(async c=>{
   const k=await this.cashForUpdate(c,id);
   if(!k.imported)throw new FinError(409,'Solo se descarta un efectivo importado; el añadido a mano se elimina');
   if((await c.query('SELECT 1 FROM ledens.worker_payment_batches WHERE cash_movement_id=$1',[id])).rows.length)throw new FinError(409,'Este efectivo ya está en Pendiente de trabajador');
   await c.query("UPDATE ledens.cash_movements SET assigned_to='descartado',discard_reason=$2,assigned_by=$3,assigned_at=now() WHERE id=$1",[id,why,this.user.id]);
   return {discarded:true};
  });
 }
 // Pago → «Pagos de materiales» or cobro → «Pagos de clientes». The source row is
 // signed like the accounting import (a material cost is negative there); 006's
 // trigger registers it, and a project, if given, is allocated through the engine.
 async assignCash({id,target,projectId,description,counterparty}={}){
  this.cashAdmin();
  if(!['materiales','clientes'].includes(target))throw new FinError(400,'Destino no válido');
  if(projectId&&!uuid(projectId))throw new FinError(400,'Obra no válida');
  const text=String(description??'').trim();
  if(text.length>300)throw new FinError(400,'La descripción admite 300 caracteres como máximo');
  const client=String(counterparty??'').trim();
  if(client.length>200)throw new FinError(400,'El cliente admite 200 caracteres como máximo');
  return this.finance.transaction(async c=>this.assignCashIn(c,await this.cashForUpdate(c,id),target,projectId,text,client));
 }
 async assignCashIn(c,k,target,projectId,text,client=''){
  const id=k.id;
  if(CASH_TARGETS[target]!==k.kind)throw new FinError(409,target==='clientes'?'Solo un cobro puede ir a Pagos de clientes':'Solo un pago puede ir a Pagos de materiales');
  if(projectId&&!(await c.query('SELECT 1 FROM ledens.projects WHERE id=$1',[projectId])).rows.length)throw new FinError(400,'Obra no encontrada');
  let source;
  if(target==='materiales'){
   const m=(await c.query(`INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on)
    VALUES('ud',$1,1,$2,$2,$3) RETURNING id`,[text||k.concept,decimal(-cents(k.amount)),k.occurred_on])).rows[0];
   await c.query("UPDATE ledens.cash_movements SET assigned_to='materiales',material_id=$2,assigned_by=$3,assigned_at=now() WHERE id=$1",[id,m.id,this.user.id]);
   source=(await c.query('SELECT id,version,gross_amount FROM ledens.financial_records WHERE material_id=$1',[m.id])).rows[0];
  }else{
   // Older cobros could be saved without a client: the one typed now, else the obra's.
   const cliente=k.counterparty?.trim()||client||(projectId&&await this.projectCustomer(c,projectId));
   if(!cliente)throw new FinError(400,'Indica el cliente que hace el cobro');
   if(!k.counterparty?.trim())await c.query('UPDATE ledens.cash_movements SET counterparty=$2 WHERE id=$1',[id,cliente]);
   const p=(await c.query(`INSERT INTO ledens.customer_payments(occurred_on,id_pago,cliente,total)
    VALUES($1,'Efectivo',$2,$3) RETURNING id`,[k.occurred_on,cliente,k.amount])).rows[0];
   await c.query("UPDATE ledens.cash_movements SET assigned_to='clientes',customer_payment_id=$2,assigned_by=$3,assigned_at=now() WHERE id=$1",[id,p.id,this.user.id]);
   source=(await c.query('SELECT id,version,gross_amount FROM ledens.financial_records WHERE customer_payment_id=$1',[p.id])).rows[0];
  }
  if(!source)throw new FinError(503,'No se pudo registrar el efectivo en la contabilidad');
  if(projectId)await this.finance.replace(c,this.user,{record_id:source.id,version:source.version,allocations:[{project_id:projectId,amount:source.gross_amount}]},
   `${k.kind==='pago'?'Pago':'Cobro'} en efectivo del ${k.occurred_on}`);
  return {assigned:target,recordId:source.id};
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
   AND concat_ws(' ',m.beneficiary_name,m.payer,m.description,m.reference,m.source_id,k.concept,k.counterparty) ILIKE $1`;
  const rows=(await this.query(`SELECT b.id,b.role,b.unit_amount,b.total_amount,b.occurred_on fecha,m.id bank_movement_id,b.cash_movement_id,coalesce(m.source_id,'Efectivo') source_id,
    coalesce(m.beneficiary_name,m.payer,k.counterparty) tercero,coalesce(m.description,k.concept) concepto,
    (SELECT json_agg(json_build_object('id',s.id,'line',s.line_number,'amount',s.amount::text,'role',s.role) ORDER BY s.line_number)
      FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NULL) lines,
    (SELECT count(*)::int FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NOT NULL) saved
   FROM ledens.worker_payment_batches b LEFT JOIN ledens.bank_movements m ON m.id=b.bank_movement_id LEFT JOIN ledens.cash_movements k ON k.id=b.cash_movement_id
   WHERE ${where} ORDER BY b.occurred_on DESC NULLS LAST,b.id LIMIT ${size} OFFSET ${(p-1)*size}`,['%'+q+'%'])).rows;
  const t=(await this.query(`SELECT count(*)::int batches,coalesce(sum((SELECT count(*) FROM ledens.worker_payment_splits s WHERE s.batch_id=b.id AND s.worker_payment_id IS NULL)),0)::int lines
   FROM ledens.worker_payment_batches b LEFT JOIN ledens.bank_movements m ON m.id=b.bank_movement_id LEFT JOIN ledens.cash_movements k ON k.id=b.cash_movement_id WHERE ${where}`,['%'+q+'%'])).rows[0];
  return {rows,total:t.batches,lines:t.lines,page:p,pageSize:size};
 }
 // Sidebar badge of «Pendiente de trabajador»: money still waiting for a worker
 // and a project (every unsaved line, whatever the search or page).
 async workerQueueSummary(){
  await this.workerQueueAccess();
  const r=(await this.query(`SELECT count(*)::int lineas,count(DISTINCT s.batch_id)::int movimientos,coalesce(sum(s.amount),0)::text importe
   FROM ledens.worker_payment_splits s WHERE s.worker_payment_id IS NULL`)).rows[0];
  return r;
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
     const s=(await c.query(`SELECT s.*,b.bank_movement_id,b.cash_movement_id,b.occurred_on,m.source_id FROM ledens.worker_payment_splits s
      JOIN ledens.worker_payment_batches b ON b.id=s.batch_id LEFT JOIN ledens.bank_movements m ON m.id=b.bank_movement_id WHERE s.id=$1 FOR UPDATE OF s`,[it.splitId])).rows[0];
     if(!s)throw new FinError(404,'Pago no encontrado');
     if(s.worker_payment_id)throw new FinError(409,'Este pago ya está guardado');
     if(s.bank_movement_id)await this.missingConcepts(c,{bankMovementId:s.bank_movement_id});
     const e=(await c.query('SELECT id,name FROM ledens.employees WHERE id=$1',[it.employeeId])).rows[0];
     if(!e)throw new FinError(400,'Trabajador no encontrado');
     const w=(await c.query(`INSERT INTO ledens.worker_payments(amount,occurred_on,bank_movement_id,employee_id,empleado)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[decimal(-cents(s.amount)),s.occurred_on,s.bank_movement_id,e.id,e.name])).rows[0];
     const rec=(await c.query('SELECT id,version,gross_amount FROM ledens.financial_records WHERE worker_payment_id=$1',[w.id])).rows[0];
     if(!rec)throw new FinError(503,'No se pudo registrar el pago en la contabilidad');
     await this.finance.replace(c,this.user,{record_id:rec.id,version:rec.version,allocations:[{project_id:it.projectId,amount:rec.gross_amount}]},
      `Pago a ${s.role==='oficial'?'oficial':'ayudante'} segregado ${s.cash_movement_id?'de un pago en efectivo':'del movimiento '+s.source_id}`);
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
   await c.query(`UPDATE ledens.cash_movements SET assigned_to=NULL,assigned_by=NULL,assigned_at=NULL
    WHERE id=(SELECT cash_movement_id FROM ledens.worker_payment_batches WHERE id=$1)`,[batchId]);
   await c.query('DELETE FROM ledens.worker_payment_batches WHERE id=$1',[batchId]);return {returned:true};
  });
 }
}
