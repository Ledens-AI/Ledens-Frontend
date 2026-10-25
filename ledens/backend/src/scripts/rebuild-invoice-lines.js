import pg from 'pg';
import {InvoiceOcr} from '../ingestion/ocr.js';
import {extractLines,storeInvoiceLines} from '../finance/ingestion.js';
import {FinanceService} from '../finance/service.js';
const [ingestionId,actorId]=process.argv.slice(2);
if(!ingestionId||!actorId)throw new Error('Usage: node src/scripts/rebuild-invoice-lines.js ingestionId adminUserId');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const actor=(await pool.query('SELECT role FROM users WHERE id=$1',[actorId])).rows[0];if(actor?.role!=='admin')throw new Error('admin_required');
 const i=(await pool.query('SELECT i.*,d.tipo FROM ledens.invoice_ingestions i JOIN ledens.documents d ON d.id=i.document_id WHERE i.id=$1',[ingestionId])).rows[0];if(!i||!['ready','archived'].includes(i.status))throw new Error('ingestion_not_ready');
 const result=await new InvoiceOcr(process.env.DI_ENDPOINT,process.env.DI_KEY).poll(i.operation_url);if(result.status!=='succeeded')throw new Error('ocr_result_not_ready');
 const lines=extractLines(result);
 const summary=await new FinanceService(pool).transaction(c=>storeInvoiceLines(c,i.document_id,lines,{currency:i.invoice_currency,direction:i.tipo,actorId,reason:'Desglose por partidas solicitado por el usuario; totales verificados con el original, sin duplicar documento ni Bridge'}));
 console.log(JSON.stringify({document_id:i.document_id,...summary,items:lines.map(l=>({line:l.line_number,description:l.description,gross:l.gross_amount}))}));
}finally{await pool.end();}
