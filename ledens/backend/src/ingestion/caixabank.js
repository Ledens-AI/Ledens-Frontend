// CaixaBank account statements (Norma 43 .txt) dropped in SharePoint
// «datasource/Caixabank/Landing». Each movement becomes a row of
// ledens.bank_movements — the table the Revolut sync fills — so the Bridge,
// «Pendiente de conciliación» and every finance screen treat it like any other
// bank movement. See ledens/backend/CAIXABANK-STATEMENTS.md.
import {createHash} from 'node:crypto';
import {IngestError} from './validation.js';
import {parseNorma43,Norma43Error} from './norma43.js';

const CAIXABANK='2100';
const MAX_BYTES=1024*1024;
const sha=s=>createHash('sha256').update(s).digest('hex');
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();

export function statementSettings(env=process.env){
 return {site:env.INGEST_SITE_URL,folder:env.CAIXABANK_FOLDER||'datasource/Caixabank/Landing',
  archiveFolder:env.CAIXABANK_ARCHIVE_FOLDER||'datasource/Caixabank/Archive',
  // Optional allow-list (IBAN or CCC, comma separated): a statement of any other account is refused.
  accounts:(env.CAIXABANK_ACCOUNTS||'').split(',').map(s=>s.replace(/\s/g,'').toUpperCase()).filter(Boolean)};
}
export function validateStatement(body,config){
 if(!body||body.site_url!==config.site||body.library!=='Shared Documents'||!same(body.folder,config.folder))throw new IngestError(400,'invalid_source');
 for(const key of ['item_id','filename','content_base64'])if(typeof body[key]!=='string'||!body[key])throw new IngestError(400,'invalid_payload');
 if(body.item_id.length>1024||body.filename.length>255||/[\\/\x00-\x1f]/.test(body.filename))throw new IngestError(400,'invalid_filename_or_id');
 if(!/\.txt$/i.test(body.filename))throw new IngestError(415,'supported_format_txt');
 if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content_base64))throw new IngestError(400,'invalid_base64');
 const content=Buffer.from(body.content_base64,'base64');
 if(!content.length||content.length>MAX_BYTES)throw new IngestError(413,'statement_too_large');
 return {itemId:body.item_id,filename:body.filename,content,hash:sha(content),sourceKey:`${config.site}|Shared Documents|${body.item_id}`};
}

// Norma 43 «concepto común» → the type vocabulary of the Revolut sync, which the
// Bridge reads (it only links documents automatically to TRANSFER, CARD_PAYMENT,
// CHARGE and incoming TOPUP). Anything without a clear equivalent keeps its own
// name: visible and assignable by hand, never matched automatically.
const TYPES={'01':'CHEQUE','02':'DEPOSIT','03':'DIRECT_DEBIT','04':'TRANSFER','05':'LOAN','06':'BILL_REMITTANCE','07':'SUBSCRIPTION',
 '08':'DIVIDEND','09':'SECURITIES','10':'FUEL_CHEQUE','11':'ATM','13':'FOREIGN','14':'RETURN','15':'PAYROLL','16':'TAX','98':'CANCELLATION','99':'OTHER'};
export function movementType(common,negative){
 if(common==='12')return negative?'CARD_PAYMENT':'CARD_REFUND';
 if(common==='17')return negative?'CHARGE':'INTEREST';
 return TYPES[common]||'OTHER';
}
const allowed=(account,list)=>!list.length||list.some(entry=>{
 const ccc=entry.replace(/^[A-Z]{2}\d{2}/,'');
 return /^\d{20}$/.test(ccc)&&ccc.slice(0,8)===account.bank+account.branch&&ccc.slice(10)===account.account;
});

// The statement carries no transaction id, so the identity of a movement is its
// own content plus its position among identical ones (two equal card payments on
// one day are two movements). The same movement in a later, overlapping
// statement therefore gets the same source_id and is not inserted twice.
export function statementRows(parsed){
 const rows=[];
 for(const a of parsed.accounts){
  const seen=new Map(),number=a.bank+a.branch+a.account;
  for(const m of a.movements){
   const key=JSON.stringify([number,m.operationDate,m.valueDate,m.common,m.own,m.amount,m.document,m.reference1,m.reference2,m.description]);
   const nth=(seen.get(key)||0)+1;seen.set(key,nth);
   rows.push({source_id:'caixabank-'+sha(key+'#'+nth).slice(0,32),account:number,completed_on:m.operationDate,value_date:m.valueDate,
    type:movementType(m.common,m.amount.startsWith('-')),amount:m.amount,
    description:(m.description||'Movimiento CaixaBank').slice(0,500),
    reference:[m.document,m.reference1,m.reference2].filter(Boolean).join(' ')||null,
    concept_common:m.common,concept_own:m.own,office:m.office||null,line:m.line});
  }
 }
 return rows;
}

export class CaixabankStatements{
 constructor(pool,config){this.pool=pool;this.config=config;}
 async receive(file){
  let parsed;
  try{parsed=parseNorma43(file.content);}
  catch(e){if(e instanceof Norma43Error)throw new IngestError(422,e.code);throw e;}
  for(const a of parsed.accounts){
   if(a.bank!==CAIXABANK)throw new IngestError(422,'statement_not_caixabank');
   if(!allowed(a,this.config.accounts||[]))throw new IngestError(422,'statement_unknown_account');
  }
  const rows=statementRows(parsed);
  const from=parsed.accounts.map(a=>a.from).sort()[0],to=parsed.accounts.map(a=>a.to).sort().at(-1);
  const answer=(f,replay)=>({status:'processed',replay,file_id:f.id,movements:f.movements,inserted:replay?0:f.inserted,
   duplicates:replay?f.movements:f.duplicates,period_from:f.period_from,period_to:f.period_to,archive_folder:this.config.archiveFolder});
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN');
   // One statement at a time: overlapping files must see each other's rows.
   await c.query("SELECT pg_advisory_xact_lock(hashtext('ledens.caixabank_statements'))");
   const known=(await c.query(`SELECT id,movements,inserted,duplicates,period_from::text,period_to::text
     FROM ledens.bank_statement_files WHERE content_sha256=$1`,[file.hash])).rows[0];
   if(known){await c.query('COMMIT');return answer(known,true);}
   const f=(await c.query(`INSERT INTO ledens.bank_statement_files(bank,content_sha256,source_key,filename,period_from,period_to,movements)
     VALUES('caixabank',$1,$2,$3,$4,$5,$6) RETURNING id,movements,period_from::text,period_to::text`,
     [file.hash,file.sourceKey,file.filename,from,to,rows.length])).rows[0];
   let inserted=0;
   for(const r of rows){
    const m=(await c.query(`INSERT INTO ledens.bank_movements(source_id,completed_on,type,state,description,reference,amount,total_amount,currency,is_internal_transfer)
      VALUES($1,$2,$3,'COMPLETED',$4,$5,$6::numeric,$6::numeric,'EUR',false) ON CONFLICT(source_id) DO NOTHING RETURNING id`,
      [r.source_id,r.completed_on,r.type,r.description,r.reference,r.amount])).rows[0];
    if(!m)continue;
    inserted++;
    await c.query(`INSERT INTO ledens.bank_statement_movements(bank_movement_id,file_id,account,value_date,concept_common,concept_own,office,line)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[m.id,f.id,r.account,r.value_date,r.concept_common,r.concept_own,r.office,r.line]);
   }
   f.inserted=inserted;f.duplicates=rows.length-inserted;
   await c.query('UPDATE ledens.bank_statement_files SET inserted=$2,duplicates=$3 WHERE id=$1',[f.id,f.inserted,f.duplicates]);
   await c.query('COMMIT');
   return answer(f,false);
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  finally{c.release();}
 }
}
