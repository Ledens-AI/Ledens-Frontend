import {cents,decimal,normalize,taxId} from '../bridge/rules.js';
export class PurchaseReviewError extends Error{}
export const hasPurchases=async c=>Boolean((await c.query("SELECT to_regclass('ledens.purchase_documents') name")).rows[0].name);
const reject=reason=>{throw new PurchaseReviewError(reason);};
export async function linkPurchaseFamily(c,p,actorId=null){
 const family=(await c.query('SELECT * FROM ledens.purchase_documents WHERE issuer_tax_id=$1 AND buyer_tax_id=$2 AND order_reference=$3 AND currency=$4 ORDER BY issued_on,document_id LIMIT 201',[p.issuer_tax_id,p.buyer_tax_id,p.order_reference,p.currency])).rows;
 if(family.length>200)return {linked:0,reason:'family_requires_pagination_review'};
 const advances=family.filter(d=>d.kind==='advance');if(advances.length!==1)return {linked:0,reason:advances.length?'ambiguous_advance':'awaiting_advance'};
 const advance=advances[0];let linked=0;
 for(const related of family.filter(d=>d.kind!=='advance')){
  const prior=(await c.query('SELECT * FROM ledens.purchase_settlements WHERE related_document_id=$1',[related.document_id])).rows[0];if(prior)continue;
  const needed=related.kind==='delivery'?related.applied_gross:decimal(-cents(related.nominal_gross));
  const used=(await c.query('SELECT coalesce(sum(gross_amount),0)::text n FROM ledens.purchase_settlements WHERE advance_document_id=$1',[advance.document_id])).rows[0].n;
  // Preserve documents/items even when their linkage needs human review.
  if(cents(used)+cents(needed)>cents(advance.nominal_gross)||Math.abs(+new Date(related.issued_on)-+new Date(advance.issued_on))>365*86400000){
   await c.query('INSERT INTO ledens.purchase_settlement_events(document_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[related.document_id,actorId,'link_requires_review',JSON.stringify({reason:'advance_capacity_or_date',advance_document_id:advance.document_id})]);continue;
  }
  const kind=related.kind==='delivery'?'application':'refund';
  const row=(await c.query('INSERT INTO ledens.purchase_settlements(advance_document_id,related_document_id,kind,gross_amount) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[advance.document_id,related.document_id,kind,needed])).rows[0];
  if(row){linked++;await c.query('INSERT INTO ledens.purchase_settlement_events(document_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[related.document_id,actorId,'linked_'+kind,JSON.stringify({settlement_id:row.id,advance_document_id:advance.document_id,gross_amount:needed})]);
   await c.query("UPDATE ledens.bridge_cases SET next_attempt_at=now(),version=version+1,updated_at=now() WHERE document_id=$1 AND status='pending'",[related.document_id]);}
 }
 return {linked};
}
export async function registerPurchaseDocument(c,documentId,p,{actorId=null}={}){
 if(!await hasPurchases(c))reject('purchase_schema_not_ready');
 await c.query('SELECT pg_advisory_xact_lock(727032)');
 const identity=(await c.query('SELECT * FROM ledens.purchase_documents WHERE issuer_tax_id=$1 AND buyer_tax_id=$2 AND document_number=$3',[p.issuer_tax_id,p.buyer_tax_id,p.document_number])).rows[0];
 if(identity){if(identity.document_id!==documentId||identity.fingerprint!==p.fingerprint)reject('purchase_identity_conflict');return {replay:true,...await linkPurchaseFamily(c,p,actorId)};}
 const prior=(await c.query("SELECT * FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded' FOR UPDATE",[documentId])).rows;
 if(prior.some(r=>r.status!=='pending')||(await c.query('SELECT 1 FROM ledens.project_financial_allocations WHERE record_id=ANY($1::uuid[]) LIMIT 1',[prior.map(r=>r.id)])).rows.length)reject('purchase_assigned_source_requires_review');
 if(p.kind==='delivery'&&prior.some(r=>r.invoice_line_id===null))reject('purchase_existing_source_requires_review');
 const total=p.kind==='advance_refund'?decimal(-cents(p.nominal_gross)):decimal(-cents(p.nominal_gross));
 const direction=p.kind==='advance_refund'?'Cobrar':'Pagar';
 const proof={source:'native-pdf-obramat-v1',kind:p.kind,document_number:p.document_number,order_reference:p.order_reference,currency:p.currency,date:p.issued_on,ledger_total:total,direction,vendor:'OBRAMAT',tax_id:p.issuer_tax_id,buyer_tax_id:p.buyer_tax_id,fingerprint:p.fingerprint};
 await c.query(`UPDATE ledens.documents SET document_on=$2,numerodocumento=$3,tercero=$4,niftercero=CASE WHEN regexp_replace(coalesce(niftercero,''),'[^A-Za-z0-9]','','g')=$5 THEN niftercero ELSE $5 END,total=$6,base_amount=$7,vat_amount=$8,tipo=$9,trimestre=$10 WHERE id=$1`,[documentId,p.issued_on,p.document_number,'OBRAMAT',p.issuer_tax_id,total,decimal(-cents(p.nominal_net)),decimal(-cents(p.nominal_vat)),direction,Math.floor((Number(p.issued_on.slice(5,7))-1)/3)+1+'T-'+p.issued_on.slice(0,4)]);
 await c.query('INSERT INTO ledens.purchase_documents(document_id,kind,issuer_tax_id,buyer_tax_id,document_number,order_reference,currency,issued_on,nominal_gross,goods_gross,goods_net,goods_vat,applied_gross,fingerprint,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[documentId,p.kind,p.issuer_tax_id,p.buyer_tax_id,p.document_number,p.order_reference,p.currency,p.issued_on,p.nominal_gross,p.goods_gross,p.goods_net,p.goods_vat,p.applied_gross,p.fingerprint,JSON.stringify(p)]);
 for(const r of prior){await c.query("UPDATE ledens.financial_records SET source_valid=false,status='excluded',version=version+1,updated_at=now() WHERE id=$1",[r.id]);
  await c.query('INSERT INTO ledens.finance_events(record_id,actor_id,action,reason,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[r.id,actorId,'purchase_source_replaced','Anticipo y aplicación documental no son costes adicionales',JSON.stringify(r),JSON.stringify({kind:p.kind,document_id:documentId})]);}
 for(const line of [...p.lines,...p.settlement_lines]){
  const l=(await c.query('INSERT INTO ledens.invoice_lines(document_id,line_number,description,quantity,net_amount,vat_amount,gross_amount,currency,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(document_id,line_number) DO UPDATE SET description=excluded.description,quantity=excluded.quantity,net_amount=excluded.net_amount,vat_amount=excluded.vat_amount,gross_amount=excluded.gross_amount,currency=excluded.currency,evidence=excluded.evidence RETURNING id',[documentId,line.line_number,line.description,line.quantity,line.net_amount??null,line.vat_amount??null,line.gross_amount,p.currency,JSON.stringify(line.evidence)])).rows[0];
  if(p.kind==='delivery'&&p.lines.some(g=>g.line_number===line.line_number)){
   // No recognition or classification is implied by being delivered or paid.
   await c.query("INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,counterparty,gross_amount,net_amount,vat_amount,currency) VALUES($1,$2,$3,$4,'OBRAMAT',$5,$6,$7,'EUR') ON CONFLICT(invoice_line_id) DO UPDATE SET description=excluded.description,gross_amount=excluded.gross_amount,net_amount=excluded.net_amount,vat_amount=excluded.vat_amount,currency='EUR',source_valid=true,status='pending',version=ledens.financial_records.version+1,updated_at=now()",[l.id,documentId,p.issued_on,line.description,line.gross_amount,line.net_amount,line.vat_amount]);
  }
 }
 await c.query("UPDATE ledens.invoice_ingestions SET purchase_proof=$2,invoice_currency='EUR' WHERE document_id=$1",[documentId,JSON.stringify(proof)]);
 await c.query('INSERT INTO ledens.purchase_settlement_events(document_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[documentId,actorId,'document_registered',JSON.stringify({kind:p.kind,order:p.order_reference,lines:p.lines.length,fingerprint:p.fingerprint,source:'native-pdf-obramat-v1'})]);
 return {proof,...await linkPurchaseFamily(c,p,actorId)};
}
export async function purchaseDetails(c,documentId){
 const p=(await c.query('SELECT * FROM ledens.purchase_documents WHERE document_id=$1',[documentId])).rows[0];if(!p)return null;
 const family=(await c.query('SELECT document_id,kind,document_number,nominal_gross,goods_gross FROM ledens.purchase_documents WHERE issuer_tax_id=$1 AND buyer_tax_id=$2 AND order_reference=$3 AND currency=$4 ORDER BY document_number LIMIT 201',[p.issuer_tax_id,p.buyer_tax_id,p.order_reference,p.currency])).rows;
 if(family.length>200)throw new PurchaseReviewError('purchase_family_too_large');
 const ids=family.map(d=>d.document_id),links=(await c.query('SELECT * FROM ledens.purchase_settlements WHERE advance_document_id=ANY($1::uuid[])',[ids])).rows;
 const total=family.filter(d=>d.kind==='advance').reduce((s,d)=>s+cents(d.nominal_gross),0n),used=links.reduce((s,l)=>s+cents(l.gross_amount),0n);
 const refunds=[];for(const r of family.filter(d=>d.kind==='advance_refund')){const paid=(await c.query("SELECT coalesce(sum(b.allocated_amount),0)::text amount FROM ledens.bank_document_allocations b JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED' AND m.currency='EUR' WHERE b.document_id=$1 AND b.state='Confirmado'",[r.document_id])).rows[0].amount;refunds.push({document_id:r.document_id,expected:decimal(-cents(r.nominal_gross)),received:paid,status:cents(paid)===-cents(r.nominal_gross)?'matched':'pending_bank_refund'});}
 return {link_status:family.filter(d=>d.kind==='advance').length===0?'awaiting_advance':family.filter(d=>d.kind==='advance').length>1?'ambiguous_advance':'documented',order_reference:p.order_reference,currency:p.currency,document:p,family,settlements:links,advance_available:decimal(total-used),refunds};
}

export async function purchaseFundingState(c,id){return (await c.query('SELECT goods_gross,paid::text paid FROM ledens.v_purchase_coverage WHERE document_id=$1',[id])).rows[0];}
