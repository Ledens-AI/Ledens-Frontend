import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {readObramatPdf} from '../ingestion/obramat.js';
import {IngestionService} from '../ingestion/service.js';
const args=process.argv.slice(2),apply=args.includes('--apply'),files=args.filter(a=>a!=='--apply'),actorId=files.shift();
if(!actorId||!files.length)throw new Error('Usage: node src/scripts/backfill-purchase-documents.js adminUserId [--apply] original1.pdf original2.pdf ...');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const actor=(await pool.query('SELECT role FROM users WHERE id=$1',[actorId])).rows[0];if(actor?.role!=='admin')throw new Error('admin_required');
 const service=new IngestionService(pool,null,{archiveRoot:process.env.INGEST_ARCHIVE_ROOT||'datasource'});
 for(const file of files){
  const bytes=await fs.readFile(file),parsed=await readObramatPdf(bytes,{businessTaxId:process.env.BRIDGE_BUSINESS_TAX_ID||'B19753805'});if(!parsed?.data)throw new Error(parsed?.reason||'unsupported_purchase_document');
  const p=parsed.data,hash=createHash('sha256').update(bytes).digest('hex');
  const sources=(await pool.query("SELECT i.* FROM ledens.invoice_ingestions i JOIN ledens.documents d ON d.id=i.document_id WHERE i.content_hash=$1 OR (d.numerodocumento=$2 AND regexp_replace(coalesce(d.niftercero,''),'[^A-Za-z0-9]','','g')=$3)",[hash,p.document_number,p.issuer_tax_id])).rows;
  if(sources.length!==1)throw new Error('existing_ingestion_not_unique_upload_original_to_Landing_first');
  if(apply)await service.transaction(c=>service.readyNative(c,sources[0],p,{actorId}));
  console.log(JSON.stringify({apply,document_id:sources[0].document_id,number:p.document_number,kind:p.kind,items:p.lines.length,nominal:p.nominal_gross,goods:p.goods_gross}));
 }
}finally{await pool.end();}
