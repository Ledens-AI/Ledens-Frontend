import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {readRevolutPdf} from '../ingestion/revolut.js';
import {IngestionService} from '../ingestion/service.js';
import {BridgeService} from '../bridge/service.js';
import {eligibleBank,cents} from '../bridge/rules.js';
const args=process.argv.slice(2),apply=args.includes('--apply'),[ingestionId,bankId,actorId,file]=args.filter(a=>a!=='--apply');
if(!file||![ingestionId,bankId,actorId].every(v=>/^[a-f0-9-]{36}$/i.test(v)))throw new Error('Usage: recover-revolut-statement.js ingestionId bankId adminId original.pdf [--apply]');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
try{
 if((await pool.query('SELECT role FROM users WHERE id=$1',[actorId])).rows[0]?.role!=='admin')throw new Error('admin_required');
 const bytes=await fs.readFile(file),hash=createHash('sha256').update(bytes).digest('hex'),parsed=await readRevolutPdf(bytes);if(!parsed?.data)throw new Error(parsed?.reason||'unsupported_statement');
 const row=(await pool.query('SELECT * FROM ledens.invoice_ingestions WHERE id=$1',[ingestionId])).rows[0];if(!row||row.content_hash!==hash)throw new Error('original_content_hash_mismatch');
 const previous=(await pool.query('SELECT * FROM ledens.bank_document_allocations WHERE document_id=$1',[row.document_id])).rows;
 if(previous.length){if(previous.length===1&&previous[0].bank_movement_id===bankId&&previous[0].state==='Confirmado'&&cents(previous[0].allocated_amount)===cents(parsed.data.total)){console.log(JSON.stringify({apply,replay:true,document_id:row.document_id,bank_movement_id:bankId,allocation_id:previous[0].id}));}else throw new Error('existing_allocation_requires_review');}
 else{
  const p=parsed.data,doc={id:row.document_id,total:p.total,tipo:p.direction,document_on:p.date,invoice_currency:p.currency,tercero:p.vendor,document_evidence:{...p,content_hash:hash},ingestion_hash:hash};
  const bridge=new BridgeService(pool),options=await bridge.candidates(pool,doc),compatible=options.rows.filter(b=>b.links===0&&eligibleBank(doc,b));
  if(options.overflow||compatible.length!==1||compatible[0].id!==bankId)throw new Error('expected_unique_bank_not_verified');
  let result=null;
  if(apply){
   const service=new IngestionService(pool,null,{archiveRoot:'datasource'});
   await service.transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(727032)');const locked=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE id=$1 FOR UPDATE',[ingestionId])).rows[0];if(locked.content_hash!==hash)throw new Error('source_changed');await service.readyStatement(c,locked,p,{actorId});});
   result=await bridge.evaluate(row.document_id,{force:true});
   const links=(await pool.query("SELECT id,bank_movement_id,allocated_amount FROM ledens.bank_document_allocations WHERE document_id=$1 AND state='Confirmado'",[row.document_id])).rows;
   if(result.status!=='matched'||links.length!==1||links[0].bank_movement_id!==bankId||cents(links[0].allocated_amount)!==cents(p.total))throw new Error('recovery_extracted_but_match_requires_review');
  }
  console.log(JSON.stringify({apply,replay:false,ingestion_id:ingestionId,document_id:row.document_id,bank_movement_id:bankId,total:p.total,date:p.date,currency:p.currency,direction:p.direction,hash_verified:true,unique_candidate:true,result}));
 }
}finally{await pool.end();}
