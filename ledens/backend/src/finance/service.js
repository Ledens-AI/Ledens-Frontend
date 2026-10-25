import {hasPurchases,purchaseDetails} from './purchases.js';
import {createHash} from 'node:crypto';
import {cents} from '../bridge/rules.js';
import {projectSuggestions} from './ingestion.js';

export class FinanceError extends Error {
 constructor(status,code){super(code);this.status=status;}
}
export const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const fail=(status,code)=>{throw new FinanceError(status,code);};
const categories=['materials','labor','subcontract','other_direct','revenue','advance','overhead'];
const absolute=n=>n<0n?-n:n;
export class FinanceService {
 constructor(pool){this.pool=pool;}
 async documentFunding(c=this.pool){
  const native=await hasPurchases(c);
  return {native,funding:native?'SELECT * FROM ledens.v_document_funding':"SELECT b.document_id,b.bank_movement_id,b.allocated_amount,abs(d.total) capacity FROM ledens.bank_document_allocations b JOIN ledens.documents d ON d.id=b.document_id JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED' AND m.currency='EUR' WHERE b.state='Confirmado' AND d.total<>0",capacities:native?'SELECT * FROM ledens.v_document_economic_capacity':'SELECT id document_id,abs(total) capacity FROM ledens.documents'};
 }
 async purchase(user,documentId){
  if(!await hasPurchases(this.pool))return null;
  await this.documentPermission(this.pool,user,documentId);const data=await purchaseDetails(this.pool,documentId);
  if(data)for(const doc of data.family)await this.documentPermission(this.pool,user,doc.document_id);return data;
 }
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(727032)');
   const result=await fn(c);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async permission(c,user,projectId,{write=false,unassigned=false}={}){
   if(user.role==='admin')return;
   if(user.role==='client')fail(403,'finance_forbidden');
   const row=(await c.query(`SELECT 1 FROM ledens.finance_project_permissions
    WHERE user_id=$1 AND (project_id=$2 OR ($3 AND project_id IS NULL AND can_review_unassigned))
    AND (NOT $4 OR can_write) LIMIT 1`,[user.id,projectId,unassigned,write])).rows[0];
   if(!row)fail(403,'finance_forbidden');
 }
 async projects(user,{limit=50,offset=0}={}){
   return (await this.pool.query(`SELECT p.id,p.project_id code,p.name,p.address FROM ledens.projects p
    WHERE $1 OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions f WHERE f.project_id=p.id AND f.user_id=$2)
    ORDER BY p.name,p.id LIMIT $3 OFFSET $4`,[user.role==='admin',user.id,limit,offset])).rows;
 }
 async record(c,id,user,write=false){
   const r=(await c.query('SELECT * FROM ledens.financial_records WHERE id=$1'+(write?' FOR UPDATE':''),[id])).rows[0];
   if(!r)fail(404,'record_not_found');
   const allocations=(await c.query('SELECT a.*,p.name project_name FROM ledens.project_financial_allocations a JOIN ledens.projects p ON p.id=a.project_id WHERE record_id=$1 ORDER BY project_id',[id])).rows;
   if(allocations.length)for(const a of allocations)await this.permission(c,user,a.project_id,{write});
   else await this.permission(c,user,null,{write,unassigned:true});
   let document=null;
   if(r.document_id){
     const d=(await c.query('SELECT id,numerodocumento,document_on,tercero,total,base_amount,vat_amount,enlacearchivo FROM ledens.documents WHERE id=$1',[r.document_id])).rows[0];
     document={id:d.id,numerodocumento:d.numerodocumento,document_on:d.document_on};
     try{await this.documentPermission(c,user,r.document_id);document=d;}catch(e){if(!(e instanceof FinanceError&&e.status===403))throw e;}
   }
   return {...r,document,allocations,suggestions:await projectSuggestions(c,r,user)};
 }
 async documentPermission(c,user,documentId,write=false){
   const projects=(await c.query(`SELECT DISTINCT a.project_id FROM ledens.financial_records r
     LEFT JOIN ledens.project_financial_allocations a ON a.record_id=r.id WHERE r.document_id=$1`,[documentId])).rows;
   if(!projects.length)await this.permission(c,user,null,{write,unassigned:true});
   for(const p of projects)await this.permission(c,user,p.project_id,{write,unassigned:p.project_id===null});
 }
 async list(user,filters){
   const {limit=50,offset=0,type,status,project_id,unassigned,search,from,to,min,max,sort='date_desc'}=filters;
   const orders={date_desc:'r.occurred_on DESC NULLS LAST,r.id',date_asc:'r.occurred_on ASC NULLS LAST,r.id',amount_desc:'abs(r.gross_amount) DESC,r.id'};
   if(!orders[sort])fail(400,'invalid_sort');
   if(project_id)await this.permission(this.pool,user,project_id);
   // A record shared across projects is visible only to users authorized for every share.
   const values=[user.role==='admin',user.id,type||null,status||null,project_id||null,Boolean(unassigned),search||null,from||null,to||null,min||null,max||null,limit,offset];
   const purchaseSchema=await hasPurchases(this.pool);
   const covered=purchaseSchema?"EXISTS(SELECT 1 FROM ledens.v_purchase_coverage pc WHERE pc.document_id=r.document_id AND pc.paid>=pc.goods_gross)":'false';
   const delivery=purchaseSchema?"EXISTS(SELECT 1 FROM ledens.purchase_documents pd WHERE pd.document_id=r.document_id AND pd.kind='delivery')":'false';
   return (await this.pool.query(`SELECT r.*,
    coalesce((SELECT jsonb_agg(jsonb_build_object('project_id',a.project_id,'project_name',p.name,'amount',a.allocated_amount::text)) FROM ledens.project_financial_allocations a JOIN ledens.projects p ON p.id=a.project_id WHERE a.record_id=r.id),'[]'::jsonb) allocations,
    coalesce((SELECT sum(a.allocated_amount) FROM ledens.project_financial_allocations a WHERE a.record_id=r.id),0) allocated_amount,
    r.gross_amount-coalesce((SELECT sum(a.allocated_amount) FROM ledens.project_financial_allocations a WHERE a.record_id=r.id),0) unassigned_amount,
    d.numerodocumento document_number,
    (EXISTS(SELECT 1 FROM ledens.bank_document_allocations b WHERE b.document_id=r.document_id AND b.state='Confirmado') OR (${covered})) reconciled,
    CASE WHEN (${delivery}) THEN CASE WHEN (${covered}) THEN 'covered_by_advance' ELSE 'awaiting_advance_payment' END
      WHEN EXISTS(SELECT 1 FROM ledens.bank_document_allocations b WHERE b.document_id=r.document_id AND b.state IS DISTINCT FROM 'Confirmado') THEN 'review'
      WHEN abs(d.total)=coalesce((SELECT sum(abs(b.allocated_amount)) FROM ledens.bank_document_allocations b WHERE b.document_id=r.document_id AND b.state='Confirmado'),0) AND d.total<>0 THEN 'matched'
      WHEN EXISTS(SELECT 1 FROM ledens.bank_document_allocations b WHERE b.document_id=r.document_id AND b.state='Confirmado') THEN 'partial'
      WHEN r.bank_movement_id IS NOT NULL THEN 'bank_recorded' ELSE 'unmatched' END reconciliation_status
    FROM ledens.financial_records r LEFT JOIN ledens.documents d ON d.id=r.document_id
    WHERE ($1 OR (
      NOT EXISTS(SELECT 1 FROM ledens.project_financial_allocations a WHERE a.record_id=r.id AND NOT EXISTS
       (SELECT 1 FROM ledens.finance_project_permissions f WHERE f.user_id=$2 AND f.project_id=a.project_id))
      AND (EXISTS(SELECT 1 FROM ledens.project_financial_allocations a WHERE a.record_id=r.id)
       OR EXISTS(SELECT 1 FROM ledens.finance_project_permissions f WHERE f.user_id=$2 AND f.can_review_unassigned AND f.project_id IS NULL))))
    AND ($3::text IS NULL OR CASE WHEN r.material_id IS NOT NULL THEN 'materials' WHEN r.worker_payment_id IS NOT NULL THEN 'worker-payments' WHEN r.customer_payment_id IS NOT NULL THEN 'customer-payments' ELSE 'invoice-lines' END=$3)
    AND ($4::text IS NULL OR r.status=$4)
    AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM ledens.project_financial_allocations a WHERE a.record_id=r.id AND a.project_id=$5))
    AND (NOT $6 OR (r.source_valid AND r.status<>'excluded' AND abs(r.gross_amount)>coalesce((SELECT sum(abs(a.allocated_amount)) FROM ledens.project_financial_allocations a WHERE a.record_id=r.id),0)))
    AND ($7::text IS NULL OR concat_ws(' ',r.description,r.counterparty,d.numerodocumento) ILIKE '%'||$7||'%')
    AND ($8::date IS NULL OR r.occurred_on >= $8) AND ($9::date IS NULL OR r.occurred_on <= $9)
    AND ($10::numeric IS NULL OR abs(r.gross_amount)>=$10) AND ($11::numeric IS NULL OR abs(r.gross_amount)<=$11)
    ORDER BY ${orders[sort]} LIMIT $12 OFFSET $13`,values)).rows;
 }
 async audit(c,r,user,action,reason,after){
   await c.query(`INSERT INTO ledens.finance_events(record_id,actor_id,action,reason,before_value,after_value)
    VALUES($1,$2,$3,$4,$5,$6)`,[r.id,user.id,action,reason,JSON.stringify(r),JSON.stringify(after)]);
 }
 async replace(c,user,item,reason){
   if(!uuid(item.record_id)||!Number.isInteger(item.version)||!Array.isArray(item.allocations)||item.allocations.length>50)fail(400,'invalid_assignment');
   const r=await this.record(c,item.record_id,user,true);
   if(!r.source_valid)fail(409,'source_requires_correction');
   if(r.version!==item.version)fail(409,'stale_record');
   const seen=new Set();let sum=0n;const capacity=cents(r.gross_amount);
   for(const a of item.allocations){
     const amount=cents(a.amount);
     if(!uuid(a.project_id)||seen.has(a.project_id)||amount===null||amount===0n||(amount>0n)!==(capacity>0n))fail(400,'invalid_allocation');
     seen.add(a.project_id);sum+=absolute(amount);
     const p=(await c.query('SELECT id FROM ledens.projects WHERE id=$1',[a.project_id])).rows[0];
     if(!p)fail(404,'project_not_found');
     await this.permission(c,user,a.project_id,{write:true});
   }
   if(sum>absolute(capacity))fail(409,'allocation_exceeds_source');
   await c.query('DELETE FROM ledens.project_financial_allocations WHERE record_id=$1',[r.id]);
   for(const a of item.allocations)await c.query(`INSERT INTO ledens.project_financial_allocations
    (record_id,project_id,allocated_amount,created_by,updated_by) VALUES($1,$2,$3,$4,$4)`,[r.id,a.project_id,a.amount,user.id]);
   await c.query('UPDATE ledens.financial_records SET version=version+1,updated_at=now() WHERE id=$1',[r.id]);
   const after=await this.record(c,r.id,user);
   // Removing the last share requires global unassigned permission, checked before the write.
   await this.audit(c,r,user,'replace_allocations',reason,after);return after;
 }
 async bulk(user,body){
   if(!uuid(body.request_id)||!Array.isArray(body.records)||body.records.length<1||body.records.length>100||
     typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>1000)fail(400,'invalid_bulk_request');
   if(new Set(body.records.map(x=>x.record_id)).size!==body.records.length)fail(400,'duplicate_record');
   const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
   return this.transaction(async c=>{
     const old=(await c.query('SELECT * FROM ledens.finance_requests WHERE id=$1',[body.request_id])).rows[0];
     if(old){if(old.actor_id!==user.id||old.payload_hash!==hash)fail(409,'idempotency_conflict');
       for(const r of old.response.records){await this.record(c,r.id,user);for(const a of r.allocations)await this.permission(c,user,a.project_id);}
       return old.response;}
     const records=[];
     for(const item of [...body.records].sort((a,b)=>a.record_id.localeCompare(b.record_id))){
       if(!item.allocations?.length)await this.permission(c,user,null,{write:true,unassigned:true});
       records.push(await this.replace(c,user,item,body.reason));
     }
     const response=JSON.parse(JSON.stringify({records}));await c.query('INSERT INTO ledens.finance_requests(id,actor_id,payload_hash,response) VALUES($1,$2,$3,$4)',[body.request_id,user.id,hash,JSON.stringify(response)]);
     return response;
   });
 }
 async approve(user,id,body){
   return this.transaction(async c=>{
     const r=await this.record(c,id,user,true);
     if(!r.source_valid)fail(409,'source_requires_correction');
     if(r.currency&&r.currency!=='EUR')fail(409,'unsupported_currency');
     if(body.version!==r.version)fail(409,'stale_record');
     const fields=['net_amount','vat_amount','nondeductible_vat','withholding_amount'];
     const amounts=fields.map(f=>cents(body[f]));
     if(amounts.some(a=>a===null)||!categories.includes(body.category)||body.currency!=='EUR'||
      !['approved','excluded'].includes(body.status)||typeof body.reason!=='string'||body.reason.trim().length<5)fail(400,'invalid_recognition');
     const [net,vat,non,withholding]=amounts;
     if(net+vat-withholding!==cents(r.gross_amount)||absolute(non)>absolute(vat)||(non!==0n&&(non>0n)!==(vat>0n)))fail(400,'invalid_tax_amounts');
     if([net,vat,withholding].some(n=>n!==0n&&(n>0n)!==(cents(r.gross_amount)>0n)))fail(400,'inconsistent_tax_sign');
     if(body.category!=='advance'&&!/^\d{4}-\d{2}-\d{2}$/.test(body.recognized_on||''))fail(400,'recognition_date_required');
     // Customer receipts remain treasury/advances: revenue belongs to the issued invoice.
     if(r.customer_payment_id&&body.category!=='advance')fail(409,'customer_receipt_is_not_revenue');
     // A reclassified source (Movimientos conciliados) may be approved in its current category.
     if(r.material_id&&!['materials','overhead',r.category].includes(body.category))fail(409,'source_category_mismatch');
     if(r.worker_payment_id&&!['labor',r.category].includes(body.category))fail(409,'source_category_mismatch');
     // Payroll has no supplier invoice: a worker payment is recognized on its bank
     // movement alone, capped by that movement like an advance.
     const payroll=body.category==='labor'&&r.worker_payment_id&&r.bank_movement_id&&!r.document_id;
     if(body.category!=='advance'&&!payroll&&r.bank_movement_id&&!r.document_id)fail(409,'recognition_requires_document');
     if(payroll){
       const envelope=(await c.query(`SELECT abs(b.total_amount) capacity,coalesce(sum(abs(r.gross_amount)),0) used FROM ledens.bank_movements b
         LEFT JOIN ledens.financial_records r ON r.bank_movement_id=b.id AND r.id<>$2 AND r.status='approved' AND r.category='labor' AND r.document_id IS NULL
         WHERE b.id=$1 GROUP BY b.id`,[r.bank_movement_id,r.id])).rows[0];
       if(!envelope||absolute(cents(r.gross_amount))+cents(envelope.used)>cents(envelope.capacity))fail(409,'bank_amount_exceeded');
     }
     if(body.category!=='advance'&&r.document_id){
       const d=(await c.query('SELECT * FROM ledens.documents WHERE id=$1 FOR UPDATE',[r.document_id])).rows[0];
       const capSql=(await this.documentFunding(c)).capacities;const capacity=(await c.query('SELECT capacity FROM ('+capSql+') caps WHERE document_id=$1',[d.id])).rows[0].capacity;
       if(r.invoice_line_id){
         if(!['Pagar','Cobrar'].includes(d.tipo))fail(409,'document_direction_requires_review');
         const expected=cents(d.total)===0n?cents(capacity):d.tipo==='Pagar'?-cents(d.total):cents(d.total);
         if(expected===0n||(expected>0n)!==(cents(r.gross_amount)>0n)||
           (d.tipo==='Cobrar')!==(body.category==='revenue'))fail(409,'document_direction_mismatch');
       }
       const envelope=(await c.query(`SELECT caps.capacity,coalesce(sum(abs(r.gross_amount)),0) used,
         coalesce(bool_or((r.invoice_line_id IS NULL)<>($3::uuid IS NULL)) FILTER(WHERE r.id IS NOT NULL),false) mixed
         FROM ledens.documents d JOIN (${capSql}) caps ON caps.document_id=d.id LEFT JOIN ledens.financial_records r ON r.document_id=d.id AND r.id<>$2 AND r.status='approved' AND r.category<>'advance'
         WHERE d.id=$1 GROUP BY d.id,caps.capacity`,[r.document_id,r.id,r.invoice_line_id])).rows[0];
       if(envelope.mixed)fail(409,'duplicate_document_representation');
       if(envelope.capacity===null||absolute(cents(r.gross_amount))+cents(envelope.used)>cents(envelope.capacity))fail(409,'document_amount_exceeded');
     }
     if(body.category==='advance'&&r.bank_movement_id){
       const envelope=(await c.query(`SELECT abs(b.total_amount) capacity,coalesce(sum(abs(r.gross_amount)),0) used FROM ledens.bank_movements b
         LEFT JOIN ledens.financial_records r ON r.bank_movement_id=b.id AND r.id<>$2 AND r.status='approved' AND r.category='advance'
         WHERE b.id=$1 GROUP BY b.id`,[r.bank_movement_id,r.id])).rows[0];
       if(!envelope||absolute(cents(r.gross_amount))+cents(envelope.used)>cents(envelope.capacity))fail(409,'bank_amount_exceeded');
     }
     await c.query(`UPDATE ledens.financial_records SET category=$2,status=$3,net_amount=$4,vat_amount=$5,
       nondeductible_vat=$6,withholding_amount=$7,currency='EUR',recognized_on=$8,version=version+1,updated_at=now() WHERE id=$1`,
      [id,body.category,body.status,...fields.map(f=>body[f]),body.recognized_on||null]);
     const after=await this.record(c,id,user);await this.audit(c,r,user,'recognition',body.reason,after);return after;
   });
 }
 async history(user,id,{limit=50,offset=0}={}){
   const record=await this.record(this.pool,id,user);
   const rows=(await this.pool.query('SELECT * FROM ledens.finance_events WHERE record_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[id,limit,offset])).rows;
   if(record.document_id&&record.document&&!Object.hasOwn(record.document,'total')){
     return rows.map(event=>{
       const clean=value=>{const copy={...value};delete copy.document;return copy;};
       return {...event,before_value:event.action==='document_changed'?{id:record.document_id}:clean(event.before_value),
         after_value:event.action==='document_changed'?{id:record.document_id}:clean(event.after_value)};
     });
   }
   return rows;
 }
 async lines(user,documentId,{limit=50,offset=0}={}){
   await this.documentPermission(this.pool,user,documentId);
   return (await this.pool.query(`SELECT l.*,r.id record_id,r.status FROM ledens.invoice_lines l
    LEFT JOIN ledens.financial_records r ON r.invoice_line_id=l.id WHERE l.document_id=$1 ORDER BY l.line_number LIMIT $2 OFFSET $3`,[documentId,limit,offset])).rows;
 }
 async createLine(user,documentId,body){
   if(!Number.isInteger(body.line_number)||body.line_number<1||body.line_number>10000||cents(body.gross_amount)===null||cents(body.gross_amount)===0n||
    typeof body.description!=='string'||!body.description.trim()||body.description.length>1000||typeof body.reason!=='string'||body.reason.trim().length<5)fail(400,'invalid_line');
   return this.transaction(async c=>{
     await this.permission(c,user,null,{write:true,unassigned:true});
     await this.documentPermission(c,user,documentId,true);
     const d=(await c.query('SELECT * FROM ledens.documents WHERE id=$1 FOR UPDATE',[documentId])).rows[0];
     if(!d)fail(404,'document_not_found');
     const capSql=(await this.documentFunding(c)).capacities;const cap=(await c.query('SELECT capacity FROM ('+capSql+') caps WHERE document_id=$1',[d.id])).rows[0].capacity;
     if(absolute(cents(body.gross_amount))>absolute(cents(cap)||0n))fail(409,'document_amount_exceeded');
     const l=(await c.query(`INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3)
       ON CONFLICT(document_id,line_number) DO UPDATE SET document_id=excluded.document_id RETURNING id`,[documentId,body.line_number,body.description])).rows[0];
     const existing=(await c.query('SELECT * FROM ledens.financial_records WHERE invoice_line_id=$1',[l.id])).rows[0];
     if(existing){if(cents(existing.gross_amount)!==cents(body.gross_amount))fail(409,'line_already_registered');return this.record(c,existing.id,user);}
     const r=(await c.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,counterparty,gross_amount,currency)
      VALUES($1,$2,$3,$4,$5,$6,'EUR') RETURNING *`,[l.id,documentId,d.document_on,body.description,d.tercero,body.gross_amount])).rows[0];
     await this.audit(c,r,user,'create_line',body.reason,r);return this.record(c,r.id,user);
   });
 }
 async summary(user,projectId){
   await this.permission(this.pool,user,projectId);
   if(!(await this.pool.query('SELECT id FROM ledens.projects WHERE id=$1',[projectId])).rows[0])fail(404,'project_not_found');
   const economic=(await this.pool.query(`SELECT
    coalesce(sum(economic_amount) FILTER(WHERE category='revenue'),0)::text recognized_revenue,
    coalesce(sum(economic_amount) FILTER(WHERE category='materials'),0)::text material_cost,
    coalesce(sum(economic_amount) FILTER(WHERE category='labor'),0)::text labor_cost,
    coalesce(sum(economic_amount) FILTER(WHERE category='subcontract'),0)::text subcontract_cost,
    coalesce(sum(economic_amount) FILTER(WHERE category='other_direct'),0)::text other_direct_cost,
    coalesce(sum(economic_amount) FILTER(WHERE category IN ('materials','labor','subcontract','other_direct')),0)::text direct_cost,
    coalesce(sum(allocated_amount) FILTER(WHERE category='revenue'),0)::text invoiced_gross
    FROM ledens.v_project_recognized WHERE project_id=$1`,[projectId])).rows[0];
   const {funding,capacities}=await this.documentFunding();
   // Treasury is distributed through the SAME document/Bridge, once per record share.
   // Advances represent the bank receipt only when that bank has no confirmed document link.
   // Cash entries (016) have no bank or Bridge: their approved share is the flow.
   const cashView=(await this.pool.query("SELECT to_regclass('ledens.v_cash_records') IS NOT NULL ok")).rows[0].ok;
   const cash=(await this.pool.query(`WITH shares AS (
    SELECT r.*,a.allocated_amount/r.gross_amount share FROM ledens.financial_records r
    JOIN ledens.project_financial_allocations a ON a.record_id=r.id
    WHERE a.project_id=$1 AND r.status='approved' AND r.currency='EUR'
   ), flows AS (
    SELECT b.bank_movement_id,b.allocated_amount * abs(s.gross_amount/b.capacity)*s.share amount
    FROM shares s JOIN ledens.documents d ON d.id=s.document_id
    JOIN (${funding}) b ON b.document_id=d.id
    WHERE s.category<>'advance' AND b.capacity>0
    UNION ALL
    SELECT m.id,m.total_amount*s.share*abs(s.gross_amount/m.total_amount)
    FROM shares s JOIN ledens.bank_movements m ON m.id=s.bank_movement_id
    WHERE s.category='advance' AND m.state='COMPLETED' AND m.currency='EUR' AND m.total_amount<>0
    AND NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations b WHERE b.bank_movement_id=m.id AND b.state='Confirmado')
    ${cashView?`UNION ALL
    SELECT NULL::uuid,CASE WHEN s.category IN ('advance','revenue') THEN 1 ELSE -1 END*abs(s.gross_amount*s.share)
    FROM shares s WHERE s.document_id IS NULL AND s.bank_movement_id IS NULL AND s.id IN (SELECT record_id FROM ledens.v_cash_records)`:''}
   ) SELECT coalesce(sum(amount) FILTER(WHERE amount>0),0)::text collections,
     coalesce(-sum(amount) FILTER(WHERE amount<0),0)::text payments,coalesce(sum(amount),0)::text net_cash_flow FROM flows`,[projectId])).rows[0];
   const pending=(await this.pool.query(`SELECT count(*)::int pending_review,
    coalesce(sum(abs(r.gross_amount)),0)::text pending_review_gross FROM ledens.financial_records r
    WHERE status='pending' AND EXISTS(SELECT 1 FROM ledens.project_financial_allocations a WHERE a.record_id=r.id AND a.project_id=$1)`,[projectId])).rows[0];
   const due=(await this.pool.query(`WITH capacities AS(${capacities}),funding AS(${funding}),balances AS (
    SELECT r.category,a.allocated_amount*(1-least(1,coalesce((SELECT sum(abs(b.allocated_amount)) FROM funding b
      WHERE b.document_id=d.id),0)/nullif(caps.capacity,0))) due
    FROM ledens.financial_records r JOIN ledens.project_financial_allocations a ON a.record_id=r.id
    JOIN ledens.documents d ON d.id=r.document_id JOIN capacities caps ON caps.document_id=d.id
    WHERE a.project_id=$1 AND r.status='approved' AND r.currency='EUR'
   ) SELECT coalesce(sum(due) FILTER(WHERE category='revenue'),0)::text pending_collections,
    coalesce(sum(due) FILTER(WHERE category IN ('materials','labor','subcontract','other_direct')),0)::text pending_payments FROM balances`,[projectId])).rows[0];
   // Database arithmetic retains NUMERIC precision; money is serialized as decimal strings.
   const result=(await this.pool.query(`SELECT ($1::numeric-$2::numeric)::text direct_result,
     CASE WHEN $1::numeric=0 THEN NULL ELSE round(($1::numeric-$2::numeric)/$1::numeric*100,4)::text END direct_margin_percent`,[economic.recognized_revenue,economic.direct_cost])).rows[0];
   const budget=await this.budget(user,projectId);
   return {project_id:projectId,currency:'EUR',...budget,...economic,...cash,...due,...pending,...result,
     limitations:['Only approved records enter totals','Unassigned amounts are available in the review queue','Cash excludes unidentified currency and unconfirmed Bridge links']};
 }
 async budget(user,projectId){
   await this.permission(this.pool,user,projectId);
   return (await this.pool.query(`WITH approved AS (
    SELECT v.*,b.project_id FROM ledens.budgets b JOIN ledens.budget_versions v ON v.budget_id=b.id
    WHERE b.project_id=$1 AND v.state='accepted'
      AND (SELECT decision FROM ledens.budget_approvals a WHERE a.version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1)='approved'
   ), current_versions AS (SELECT DISTINCT ON(budget_id) budget_id,id FROM approved ORDER BY budget_id,version_number DESC),
    initial_versions AS (SELECT DISTINCT ON(budget_id) budget_id,id FROM approved ORDER BY budget_id,version_number), valid AS (
    SELECT b.id budget_id,v.version_number,v.id,
      (SELECT sum(l.total) FROM ledens.budget_lines l WHERE l.version_id=v.id) amount
    FROM ledens.budgets b JOIN ledens.budget_versions v ON v.budget_id=b.id
    JOIN ledens.finance_budget_basis f ON f.version_id=v.id
    WHERE b.project_id=$1 AND v.state='accepted'
      AND (SELECT decision FROM ledens.budget_approvals a WHERE a.version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1)='approved'
      AND f.lines_hash=(SELECT md5(coalesce(jsonb_agg(jsonb_build_array(l.id,l.quantity,l.unit_price,l.total) ORDER BY l.id)::text,'[]')) FROM ledens.budget_lines l WHERE l.version_id=v.id)
   ), latest AS (SELECT v.budget_id,v.amount FROM valid v JOIN current_versions c ON c.id=v.id),
    initial AS (SELECT v.budget_id,v.amount FROM valid v JOIN initial_versions i ON i.id=v.id)
   SELECT CASE WHEN count(*)=(SELECT count(*) FROM current_versions) THEN sum(latest.amount)::text END budget,
    CASE WHEN count(*)=(SELECT count(*) FROM current_versions) AND count(initial.amount)=count(*) THEN sum(initial.amount)::text END budget_base,
    CASE WHEN count(*)=(SELECT count(*) FROM current_versions) AND count(initial.amount)=count(*) THEN (sum(latest.amount)-sum(initial.amount))::text END budget_approved_revisions,
    CASE WHEN count(*)=0 THEN 'no_verified_approved_net_budget' WHEN count(*)<(SELECT count(*) FROM current_versions) THEN 'incomplete_budget_verification' ELSE 'verified_approved_net' END budget_status
    FROM latest LEFT JOIN initial USING(budget_id)`,[projectId])).rows[0];
 }
 async verifyBudget(user,versionId,body){
   if(body.amount_basis!=='net'||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>1000)fail(400,'invalid_budget_basis');
   return this.transaction(async c=>{
     const v=(await c.query(`SELECT v.*,b.project_id FROM ledens.budget_versions v JOIN ledens.budgets b ON b.id=v.budget_id WHERE v.id=$1 FOR UPDATE OF v`,[versionId])).rows[0];
     if(!v)fail(404,'budget_version_not_found');await this.permission(c,user,v.project_id,{write:true});
     const decision=(await c.query('SELECT decision FROM ledens.budget_approvals WHERE version_id=$1 ORDER BY decided_at DESC,id DESC LIMIT 1',[versionId])).rows[0];
     if(v.state!=='accepted'||decision?.decision!=='approved')fail(409,'budget_not_approved');
     const lines=(await c.query(`SELECT count(*)::int n,bool_and(total IS NOT NULL AND total=round(total,2)) valid,
       md5(coalesce(jsonb_agg(jsonb_build_array(id,quantity,unit_price,total) ORDER BY id)::text,'[]')) hash FROM ledens.budget_lines WHERE version_id=$1`,[versionId])).rows[0];
     if(!lines.n||!lines.valid)fail(409,'invalid_budget_lines');
     const before=(await c.query('SELECT * FROM ledens.finance_budget_basis WHERE version_id=$1',[versionId])).rows;
     await c.query(`INSERT INTO ledens.finance_budget_basis(version_id,amount_basis,lines_hash,reviewed_by,reason) VALUES($1,'net',$2,$3,$4)
      ON CONFLICT(version_id) DO UPDATE SET lines_hash=excluded.lines_hash,reviewed_by=excluded.reviewed_by,reviewed_at=now(),reason=excluded.reason`,[versionId,lines.hash,user.id,body.reason]);
     await c.query(`INSERT INTO public.audit_log(actor_id,actor_label,action,target_id,detail) VALUES($1,$2,'finance_budget_basis',NULL,$3)`,[user.id,user.email||user.id,JSON.stringify({version_id:versionId,before,after:body})]);
     return {updated:true};
   });
 }
 async evolution(user,projectId,{limit=50,offset=0}={}){
   await this.permission(this.pool,user,projectId);
   return (await this.pool.query(`SELECT date_trunc('month',recognized_on)::date AS "month",
    coalesce(sum(economic_amount) FILTER(WHERE category='revenue'),0)::text revenue,
    coalesce(sum(economic_amount) FILTER(WHERE category IN ('materials','labor','subcontract','other_direct')),0)::text direct_cost
    FROM ledens.v_project_recognized WHERE project_id=$1 AND recognized_on IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT $2 OFFSET $3`,[projectId,limit,offset])).rows;
 }
}
