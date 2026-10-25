import pg from 'pg';
import {InvoiceOcr} from '../ingestion/ocr.js';
import {recoverMunicipalAssessment} from '../ingestion/municipal-recovery.js';
const [ingestionId,actorId,flag]=process.argv.slice(2);
if(!ingestionId||!actorId||!['--preview','--apply'].includes(flag))throw new Error('Usage: node src/scripts/recover-municipal.js ingestionId adminUserId --preview|--apply');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const ingestion=(await pool.query('SELECT operation_url FROM ledens.invoice_ingestions WHERE id=$1',[ingestionId])).rows[0];if(!ingestion)throw new Error('not_found');
 const result=await new InvoiceOcr(process.env.DI_ENDPOINT,process.env.DI_KEY).poll(ingestion.operation_url);
 if(result.status!=='succeeded')throw new Error('ocr_result_unavailable');
 const recovery=await recoverMunicipalAssessment(pool,{ingestionId,actorId,result,apply:flag==='--apply'});
 console.log(JSON.stringify(recovery));
}finally{await pool.end();}
