import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {parseNorma43} from '../src/ingestion/norma43.js';
import {CaixabankStatements,validateStatement,statementRows,movementType} from '../src/ingestion/caixabank.js';
import {createIngestionRouter} from '../src/routes/ingestion.js';
import {bankMatchRule} from '../src/bridge/rules.js';

// Synthetic Norma 43 statements (no real account or movement appears here).
const ACCOUNT={bank:'2100',branch:'0001',account:'0200000001'};
const num=(cents,width=14)=>String(cents).padStart(width,'0');
const sign=cents=>cents<0?'1':'2';
const r11=(a,from,to,opening)=>('11'+a.bank+a.branch+a.account+from+to+sign(opening)+num(Math.abs(opening))+'9783'+'EMPRESA DE PRUEBA SL'.padEnd(26)).padEnd(80);
const r22=m=>('22    '+'0001'+m.date+(m.value||m.date)+m.common+(m.own||'000')+sign(m.cents)+num(Math.abs(m.cents))+(m.document||'').padStart(10,'0')+(m.ref1?m.ref1.padEnd(12):'0'.repeat(12))+(m.ref2||'').padEnd(16)).padEnd(80);
const r23=(code,a,b='')=>('23'+code+a.padEnd(38)+b.padEnd(38)).padEnd(80);
function statement(movements,{account=ACCOUNT,from='261105',to='261108',opening=72793,currency='978',tweak}={}){
 const lines=[r11(account,from,to,opening)];
 for(const m of movements){lines.push(r22(m));(m.concepts||[]).forEach((c,i)=>lines.push(r23(String(i+1).padStart(2,'0'),c[0],c[1])));}
 const debit=movements.filter(m=>m.cents<0),credit=movements.filter(m=>m.cents>0),sum=l=>l.reduce((a,m)=>a+Math.abs(m.cents),0);
 const t={debitCount:debit.length,debit:sum(debit),creditCount:credit.length,credit:sum(credit),closing:opening+movements.reduce((a,m)=>a+m.cents,0),records:lines.length+1,...tweak};
 lines.push(('33'+account.bank+account.branch+account.account+num(t.debitCount,5)+num(t.debit)+num(t.creditCount,5)+num(t.credit)+sign(t.closing)+num(Math.abs(t.closing))+currency).padEnd(80));
 if(t.records!==null)lines.push(('88'+'9'.repeat(18)+num(t.records,6)).padEnd(80));
 if(currency!=='978')lines[0]=lines[0].slice(0,47)+currency+lines[0].slice(50);
 return Buffer.from(lines.join('\r\n')+'\r\n','latin1');
}
const fee={date:'261106',common:'17',own:'036',cents:-300,concepts:[['','PRECIO ED. EXTRACTO'],['03600024MHC','PRECIO ED. EXTRACTO']]};
const transfer={date:'261107',common:'04',own:'002',cents:-12100,ref1:'F2026118',concepts:[['TRANSF. A FAVOR DE','SUMINISTROS EJEMPLO SL'],['FACTURA F2026118','']]};
const card={date:'261107',common:'12',own:'040',cents:-1550,concepts:[['COMPRA TARJ. 1234','FERRETERIA EJEMPLO']]};

const config={site:'https://ledenses.sharepoint.com/sites/ledens.es',folder:'datasource/Caixabank/Landing',archiveFolder:'datasource/Caixabank/Archive',accounts:[]};
const file=(content,id='1',name='TT091126.205.txt')=>validateStatement({site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:id,filename:name,content_base64:content.toString('base64')},config);
let db,pool,service;
const count=async()=>Number((await db.query('SELECT count(*) n FROM ledens.bank_movements')).rows[0].n);
before(async()=>{
 db=new PGlite();
 // ledens.bank_movements as in production's catalog (test/fixtures/ledens-accounting.sql).
 await db.exec(`CREATE SCHEMA ledens;
  CREATE TABLE ledens.bank_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL,
   external_account_id text NOT NULL, name text, currency text NOT NULL, state text, provider_updated_at timestamptz);
  CREATE TABLE ledens.bank_movements (id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), source_id text PRIMARY KEY,
   completed_on date, type text, state text, description text, reference text, payer text, amount numeric NOT NULL,
   total_amount numeric NOT NULL, beneficiary_name text, bank_account_id uuid REFERENCES ledens.bank_accounts (id),
   currency text, is_internal_transfer boolean);`);
 await db.exec(await fs.readFile(new URL('../src/db/migrations/038_extractos_bancarios.sql',import.meta.url),'utf8'));
 pool={connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})};
 service=new CaixabankStatements(pool,config);
});
after(async()=>{await db?.close();});

test('reads a statement: signed amounts, dates, concepts and balances',()=>{
 const p=parseNorma43(statement([fee,{date:'261107',common:'02',cents:50000,concepts:[['INGRESO CLIENTE','']]}]));
 assert.equal(p.accounts.length,1);
 const a=p.accounts[0];
 assert.deepEqual([a.bank,a.branch,a.account,a.from,a.to,a.currency,a.opening,a.closing,a.holder],
  ['2100','0001','0200000001','2026-11-05','2026-11-08','EUR','727.93','1224.93','EMPRESA DE PRUEBA SL']);
 assert.deepEqual(a.movements.map(m=>[m.operationDate,m.valueDate,m.amount,m.common,m.own,m.description]),
  [['2026-11-06','2026-11-06','-3.00','17','036','PRECIO ED. EXTRACTO 03600024MHC'],['2026-11-07','2026-11-07','500.00','02','000','INGRESO CLIENTE']]);
 assert.equal(a.movements[0].document,null);
 // Lines without the trailing blanks, LF only, and a second account in the same file.
 const other={...ACCOUNT,account:'0200000002'};
 const two=Buffer.concat([statement([fee],{tweak:{records:null}}),statement([card],{account:other,tweak:{records:9}})]);
 const trimmed=Buffer.from(two.toString('latin1').split('\r\n').map(l=>l.trimEnd()).join('\n'),'latin1');
 assert.deepEqual(parseNorma43(trimmed).accounts.map(x=>[x.account,x.movements.length]),[['0200000001',1],['0200000002',1]]);
});
test('a statement that does not add up is refused whole',()=>{
 const bad=(content,code)=>assert.throws(()=>parseNorma43(content),{code:'norma43_'+code});
 bad(statement([fee],{tweak:{records:null}}),'missing_end');
 bad(statement([fee],{tweak:{records:9}}),'record_count');
 bad(statement([fee],{tweak:{debit:301}}),'totals');
 bad(statement([fee],{tweak:{debitCount:2}}),'totals');
 bad(statement([fee],{tweak:{closing:72494}}),'balance');
 bad(statement([fee],{currency:'840'}),'currency');
 bad(statement([{...fee,date:'261332'}]),'date');
 bad(Buffer.from('x'.repeat(81)),'line_format');
 bad(Buffer.from('factura.pdf no es un extracto'),'record_outside_account');
 bad(Buffer.alloc(0),'empty');
 // A movement record cut short loses its trailer: nothing is taken from it.
 const cut=statement([fee,transfer]).toString('latin1').split('\r\n');
 bad(Buffer.from(cut.slice(0,4).join('\r\n'),'latin1'),'missing_end');
});
test('concept codes map to the types the Bridge reads',()=>{
 assert.deepEqual([movementType('04',true),movementType('12',true),movementType('12',false),movementType('17',true),movementType('17',false),movementType('03',true),movementType('55',true)],
  ['TRANSFER','CARD_PAYMENT','CARD_REFUND','CHARGE','INTEREST','DIRECT_DEBIT','OTHER']);
});
test('movements join ledens.bank_movements once, across replays and overlapping statements',async()=>{
 const first=await service.receive(file(statement([fee,transfer])));
 assert.deepEqual([first.status,first.replay,first.movements,first.inserted,first.duplicates,first.archive_folder],['processed',false,2,2,0,'datasource/Caixabank/Archive']);
 const rows=(await db.query('SELECT * FROM ledens.bank_movements ORDER BY completed_on')).rows;
 assert.deepEqual(rows.map(r=>[r.completed_on.toISOString().slice(0,10),r.type,r.state,Number(r.amount),Number(r.total_amount),r.currency,r.is_internal_transfer,r.bank_account_id]),
  [['2026-11-06','CHARGE','COMPLETED',-3,-3,'EUR',false,null],['2026-11-07','TRANSFER','COMPLETED',-121,-121,'EUR',false,null]]);
 assert.match(rows[0].source_id,/^caixabank-[a-f0-9]{32}$/);
 assert.equal(rows[1].description,'TRANSF. A FAVOR DE SUMINISTROS EJEMPLO SL FACTURA F2026118');
 assert.equal(rows[1].reference,'F2026118');
 // The Bridge takes it like a Revolut transfer: same amount, near date.
 assert.equal(bankMatchRule({total:'-121.00',tipo:'Pagar',document_on:'2026-11-05',numerodocumento:'F2026118',tercero:'Suministros Ejemplo SL'},
  {...rows[1],amount:'-121.00',total_amount:'-121.00'}),'amount_near_date');
 // Same bytes again (flow retry, or the same file dropped twice): nothing new.
 const replay=await service.receive(file(statement([fee,transfer]),'2','copia.txt'));
 assert.deepEqual([replay.replay,replay.inserted,replay.duplicates,replay.file_id],[true,0,2,first.file_id]);
 assert.equal(await count(),2);
 // A later statement that overlaps the first one only adds what is new; two
 // identical card payments on one day are two movements.
 const later=await service.receive(file(statement([fee,transfer,card,card],{to:'261110'}),'3'));
 assert.deepEqual([later.replay,later.movements,later.inserted,later.duplicates],[false,4,2,2]);
 assert.equal(await count(),4);
 const again=await service.receive(file(statement([transfer,card,card,{...card,date:'261109'}],{from:'261107',to:'261111',opening:72493}),'4'));
 assert.deepEqual([again.inserted,again.duplicates],[1,3]);
 const detail=(await db.query(`SELECT s.account,s.value_date::text,s.concept_common,s.concept_own,f.filename FROM ledens.bank_statement_movements s
   JOIN ledens.bank_statement_files f ON f.id=s.file_id JOIN ledens.bank_movements b ON b.id=s.bank_movement_id WHERE b.type='CHARGE'`)).rows;
 assert.deepEqual(detail,[{account:'210000010200000001',value_date:'2026-11-06',concept_common:'17',concept_own:'036',filename:'TT091126.205.txt'}]);
 assert.equal(Number((await db.query('SELECT count(*) n FROM ledens.bank_statement_files')).rows[0].n),3);
});
test('other banks, other accounts and broken files add nothing',async()=>{
 const n=await count();
 await assert.rejects(service.receive(file(statement([card],{account:{...ACCOUNT,bank:'0049'}}),'9')),{status:422,code:'statement_not_caixabank'});
 await assert.rejects(service.receive(file(statement([card],{tweak:{closing:1}}),'9')),{status:422,code:'norma43_balance'});
 const guarded=new CaixabankStatements(pool,{...config,accounts:['ES1221000001990200000001']});
 await assert.rejects(guarded.receive(file(statement([card],{account:{...ACCOUNT,account:'0200000009'}}),'9')),{code:'statement_unknown_account'});
 assert.equal(await count(),n);
 const ok=await guarded.receive(file(statement([{...card,date:'261108'}]),'10'));
 assert.equal(ok.inserted,1);
});
test('request checks: folder, file name, size and encoding',()=>{
 const body=extra=>({site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:'1',filename:'a.txt',content_base64:statement([fee]).toString('base64'),...extra});
 assert.equal(validateStatement(body({folder:'datasource/caixabank/landing'}),config).filename,'a.txt');
 for(const [extra,expected] of [[{folder:'datasource/Landing facturas'},{code:'invalid_source'}],[{site_url:'https://evil.example'},{code:'invalid_source'}],
  [{filename:'../a.txt'},{code:'invalid_filename_or_id'}],[{filename:'a.pdf'},{status:415}],[{content_base64:'%%%'},{code:'invalid_base64'}],
  [{content_base64:Buffer.alloc(1024*1024+1,0x20).toString('base64')},{status:413}],[{item_id:''},{code:'invalid_payload'}]])
  assert.throws(()=>validateStatement(body(extra),config),expected);
});
test('endpoint: bearer token, verdict for the flow, and the file stays in Landing on 422',async()=>{
 const token='t'.repeat(43),tokenHash=createHash('sha256').update(token).digest('hex');
 const app=express();app.use('/ingesta',createIngestionRouter({tokenHash,statements:service,statementConfig:config}));
 const server=app.listen(0);
 try{
  const url=`http://127.0.0.1:${server.address().port}/ingesta/extractos/caixabank`;
  const post=(content,auth=token)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},
   body:JSON.stringify({site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:'20',filename:'TT101126.001.txt',content_base64:content.toString('base64')})});
  assert.equal((await post(statement([fee]),'x'.repeat(43))).status,401);
  const before=await count();
  const ok=await post(statement([{...fee,date:'261110'}],{from:'261110',to:'261110'}));
  assert.equal(ok.status,200);
  const verdict=await ok.json();
  assert.deepEqual([verdict.status,verdict.inserted,verdict.period_from,verdict.period_to],['processed',1,'2026-11-10','2026-11-10']);
  const invalid=await post(statement([fee],{tweak:{credit:5}}));
  assert.equal(invalid.status,422);
  assert.deepEqual(await invalid.json(),{error:'norma43_totals'});
  assert.equal(await count(),before+1);
 }finally{server.close();}
});
test('source ids are stable for the same movement and differ for a repeated one',()=>{
 const ids=c=>statementRows(parseNorma43(c)).map(r=>r.source_id);
 const a=ids(statement([fee,card,card])),b=ids(statement([card,card,transfer],{from:'261107',opening:72493}));
 assert.equal(new Set(a).size,3);
 assert.deepEqual(a.slice(1),b.slice(0,2));
});
