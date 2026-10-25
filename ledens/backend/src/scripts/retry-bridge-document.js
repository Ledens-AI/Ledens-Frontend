import pg from 'pg';
import {InvoiceOcr,extractInvoice} from '../ingestion/ocr.js';
import {BridgeService} from '../bridge/service.js';
import {normalize,taxId,INVOICE_MIN_CONFIDENCE} from '../bridge/rules.js';
const [ingestionId,actorId]=process.argv.slice(2);
if(!ingestionId||!actorId)throw new Error('Usage: node src/scripts/retry-bridge-document.js ingestionId adminUserId');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const actor=(await pool.query('SELECT role FROM users WHERE id=$1',[actorId])).rows[0];if(actor?.role!=='admin')throw new Error('admin_required');
 const i=(await pool.query('SELECT i.*,d.tercero,d.niftercero FROM ledens.invoice_ingestions i JOIN ledens.documents d ON d.id=i.document_id WHERE i.id=$1',[ingestionId])).rows[0];
 if(!i||!['ready','archived'].includes(i.status))throw new Error('ingestion_not_ready');
 const bridge=new BridgeService(pool);
 if(Number(i.party_confidence)<INVOICE_MIN_CONFIDENCE){
  const result=await new InvoiceOcr(process.env.DI_ENDPOINT,process.env.DI_KEY).poll(i.operation_url),extracted=extractInvoice(result),e=extracted.partyEvidence;
  if(!e||e.name!==normalize(i.tercero)||e.tax_id!==taxId(i.niftercero))throw new Error('supplier_evidence_requires_review');
  await bridge.tx(async c=>{
   const changed=(await c.query('UPDATE ledens.invoice_ingestions SET party_evidence=$2 WHERE id=$1 AND party_evidence IS DISTINCT FROM $2::jsonb RETURNING id',[i.id,JSON.stringify(e)])).rows;
   if(changed.length)await bridge.event(c,i.document_id,'party_evidence_corroborated',{evidence:e,original_party_confidence:i.party_confidence},{actorId});
  });
 }
 console.log(JSON.stringify(await bridge.evaluate(i.document_id,{force:true})));
}finally{await pool.end();}
