import {BridgeError} from './service.js';
import {bankFingerprint,documentFingerprint,day} from './rules.js';

const page=f=>{
 const limit=Number(f.limit??25),offset=Number(f.offset??0);
 if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>100000)throw new BridgeError(400,'invalid_pagination');
 if(typeof (f.q??'')!=='string'||(f.q??'').length>120)throw new BridgeError(400,'invalid_search');
 for(const d of [f.from,f.to])if(d&&day(d)===null)throw new BridgeError(400,'invalid_date');
 if(f.from&&f.to&&f.from>f.to)throw new BridgeError(400,'invalid_date_range');
 return {limit,offset,q:'%'+(f.q??'')+'%',from:f.from||null,to:f.to||null};
};
const totals=`LEFT JOIN LATERAL(SELECT count(*)::int links,count(*) FILTER(WHERE a.state IS DISTINCT FROM 'Confirmado')::int review_links,
 coalesce(sum(a.allocated_amount) FILTER(WHERE a.state='Confirmado'),0) confirmed,
 string_agg(DISTINCT coalesce(d.numerodocumento,'Sin número'),', ') documents
 FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id WHERE a.bank_movement_id=b.id) x ON true`;
export class BridgeWorkspace {
 constructor(pool){this.pool=pool;}
 async movements(filters={}){
  const f=page(filters),workers=Boolean((await this.pool.query("SELECT to_regclass('ledens.worker_payment_batches') name")).rows[0].name);
  const where=`NOT coalesce(b.is_internal_transfer,false)
   ${workers?'AND NOT EXISTS(SELECT 1 FROM ledens.worker_payment_batches wb WHERE wb.bank_movement_id=b.id)':''}
   AND ($1::boolean=false OR x.links=0 OR x.review_links>0 OR x.confirmed<>b.total_amount)
   AND concat_ws(' ',b.description,b.reference,b.payer,b.beneficiary_name,x.documents) ILIKE $2
   AND ($3::date IS NULL OR b.completed_on>=$3) AND ($4::date IS NULL OR b.completed_on<=$4)`;
  const params=[filters.pending!==false,f.q,f.from,f.to];
  const total=(await this.pool.query(`SELECT count(*)::int n FROM ledens.bank_movements b ${totals} WHERE ${where}`,params)).rows[0].n;
  const rows=(await this.pool.query(`SELECT b.*,x.links,x.review_links,x.confirmed::text confirmed,x.documents,
   (b.total_amount-x.confirmed)::text remaining FROM ledens.bank_movements b ${totals} WHERE ${where}
   ORDER BY b.completed_on DESC NULLS LAST,b.id LIMIT $5 OFFSET $6`,[...params,f.limit,f.offset])).rows;
  return {rows:rows.map(b=>({...b,bank_fingerprint:bankFingerprint(b)})),total,limit:f.limit,offset:f.offset};
 }
 async counts(){
  const pending=(await this.movements({limit:1})).total;
  const cash=Boolean((await this.pool.query("SELECT to_regclass('ledens.cash_movements') name")).rows[0].name);
  const cashPending=cash?(await this.pool.query("SELECT count(*)::int n FROM ledens.cash_movements WHERE kind IN ('pago','cobro') AND assigned_to IS NULL")).rows[0].n:0;
  return {pending,reconciliation:pending+cashPending};
 }
 async allocations(filters={}){
  const f=page(filters),params=[f.q,f.from,f.to];
  const from=`FROM ledens.bank_document_allocations a JOIN ledens.documents d ON d.id=a.document_id JOIN ledens.bank_movements b ON b.id=a.bank_movement_id
   WHERE concat_ws(' ',d.numerodocumento,d.tercero,b.description,b.reference) ILIKE $1
   AND ($2::date IS NULL OR b.completed_on>=$2) AND ($3::date IS NULL OR b.completed_on<=$3)`;
  const total=(await this.pool.query('SELECT count(*)::int n '+from,params)).rows[0].n;
  const rows=(await this.pool.query(`SELECT a.id,a.document_id,a.bank_movement_id,a.allocated_amount,a.state,a.reconciled_on,a.observaciones,
   d.numerodocumento,d.tercero,d.document_on,d.total document_total,b.completed_on,b.description,b.reference,b.total_amount bank_total,b.currency
   ${from} ORDER BY a.reconciled_on DESC NULLS LAST,a.id LIMIT $4 OFFSET $5`,[...params,f.limit,f.offset])).rows;
  return {rows,total,limit:f.limit,offset:f.offset};
 }
 async documents(bankId,filters={}){
  const f=page(filters),bank=(await this.pool.query('SELECT * FROM ledens.bank_movements WHERE id=$1',[bankId])).rows[0];
  if(!bank)throw new BridgeError(404,'bank_not_found');
  const params=[bank.total_amount,f.q];
  const base=`FROM ledens.documents d LEFT JOIN ledens.invoice_ingestions i ON i.document_id=d.id LEFT JOIN ledens.bridge_cases c ON c.document_id=d.id
   LEFT JOIN LATERAL(SELECT coalesce(sum(abs(a.allocated_amount)) FILTER(WHERE a.state='Confirmado'),0) used FROM ledens.bank_document_allocations a WHERE a.document_id=d.id) x ON true
   WHERE d.total<>0 AND abs(d.total)>x.used AND (sign(d.total)=sign($1::numeric) OR NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=d.id))
   AND coalesce(c.status,'pending')='pending' AND (i.invoice_currency IS NULL OR i.invoice_currency='EUR')
   AND concat_ws(' ',d.numerodocumento,d.tercero,d.niftercero) ILIKE $2`;
  const total=(await this.pool.query('SELECT count(*)::int n '+base,params)).rows[0].n;
  const rows=(await this.pool.query(`SELECT d.*,i.invoice_currency,coalesce(c.version,0) version,(abs(d.total)-x.used)::text remaining ${base}
   ORDER BY abs(abs(d.total)-abs($1::numeric)),abs(d.document_on-$3::date) NULLS LAST,d.id LIMIT $4 OFFSET $5`,[...params,bank.completed_on,f.limit,f.offset])).rows;
  return {rows:rows.map(d=>({...d,document_fingerprint:documentFingerprint(d)})),total,limit:f.limit,offset:f.offset};
 }
}
