import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import pg from 'pg';
import {readRevolutPdf} from '../src/ingestion/revolut.js';
import {validateInvoice} from '../src/ingestion/validation.js';
import {IngestionService} from '../src/ingestion/service.js';
import {BridgeService} from '../src/bridge/service.js';
import {archiveIssue} from '../src/ingestion/completeness.js';
let db,pool,service,bytes;
const config={site:'https://example.test',folder:'datasource/Landing facturas',archiveRoot:'datasource'};
async function pdf({incoming=false,status='Completed',amount='35.00',currency='EUR',extra=false}={}){const p=await PDFDocument.create(),page=p.addPage([600,800]),font=await p.embedFont(StandardFonts.Helvetica);const draw=(s,x,y)=>page.drawText(s,{x,y,size:10,font});draw('Transaction statement',35,750);draw('Revolut Bank UAB',35,730);draw('Currency '+currency,350,700);draw('IBAN',35,680);draw('DE89370400440532013000',100,680);draw('Transaction of 21 Oct 2026',35,600);draw('Description',35,570);draw('Status',300,570);draw('Money out',410,570);draw('Money in',510,570);draw('Revolut Business Fee',35,540);draw(status,300,540);draw('€'+amount,incoming?515:415,540);if(extra){draw('Another row',35,520);draw('Completed',300,520);draw('€1.00',415,520);}return Buffer.from(await p.save());}
const body=(bytes,id)=>({site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:id,filename:'statement.pdf',content_base64:bytes.toString('base64')});
before(async()=>{
 if(process.env.STATEMENT_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.STATEMENT_TEST_DATABASE_URL});db={query:(...a)=>pool.query(...a),exec:q=>pool.query(q),close:()=>pool.end()};}else{const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','012_bridge_party_amount_date.sql','018_document_evidence.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 service=new IngestionService(pool,null,config);bytes=await pdf();
});after(()=>db?.close());
test('native reader uses Money out / Money in coordinates and rejects incomplete, foreign or multiple transactions',async()=>{
 assert.equal((await readRevolutPdf(bytes)).data.total,'-35.00');assert.equal((await readRevolutPdf(await pdf({incoming:true}))).data.total,'35.00');
 for(const options of [{status:'Pending'},{currency:'USD'},{extra:true},{amount:'0.00'}])assert.ok((await readRevolutPdf(await pdf(options))).reason);
 const forged=await validateInvoice({...body(await pdf({extra:true}),'forged'),nativeStatement:{total:'-35.00'}},config);assert.equal(forged.nativeStatement,null);assert.ok(forged.reason);
});
test('recover the existing archived incomplete document and reconcile exactly once with its existing CHARGE',async()=>{
 const d=(await db.query("INSERT INTO ledens.documents(tercero,document_on) VALUES('Revolut Business','2026-10-21') RETURNING id")).rows[0].id;
 const i=(await db.query("INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status) VALUES($1,$2,'statement.pdf','application/pdf','archived') RETURNING *",[d,createHash('sha256').update(bytes).digest('hex')])).rows[0];
 const b=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,state,type,currency,completed_on,description) VALUES(-35,-35,'COMPLETED','CHARGE','EUR','2026-10-21','Company Pro plan fee') RETURNING id")).rows[0].id;
 const parsed=await readRevolutPdf(bytes);await service.transaction(c=>service.readyStatement(c,i,parsed.data));
 const bridge=new BridgeService(pool);assert.equal((await bridge.evaluate(d,{force:true})).status,'matched');
 const replay=await service.receive(await validateInvoice(body(bytes,'copy'),config));assert.equal(replay.document_id,d);assert.equal(replay.duplicate,true);assert.equal(replay.status,'archived');
 assert.equal((await bridge.evaluate(d,{force:true})).status,'matched');
 const links=(await db.query('SELECT * FROM ledens.bank_document_allocations WHERE document_id=$1',[d])).rows;assert.equal(links.length,1);assert.equal(links[0].bank_movement_id,b);assert.equal(Number(links[0].allocated_amount),-35);
 const records=(await db.query('SELECT * FROM ledens.financial_records WHERE document_id=$1 AND source_valid',[d])).rows;assert.equal(records.length,1);assert.equal(records[0].net_amount,null);assert.equal(records[0].vat_amount,null);assert.equal(records[0].status,'pending');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.documents')).rows[0].n,1);
});
test('OCR with a date but no amount/currency/direction stays in review and cannot be archived',async()=>{
 const p=await PDFDocument.create();p.addPage();const generic=Buffer.from(await p.save());
 const ocr={start:async()=> 'https://example.test/result',poll:async()=>({status:'succeeded',analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-10-21',confidence:.9}}}]}})};
 const svc=new IngestionService(pool,ocr,config),received=await svc.receive(await validateInvoice(body(generic,randomUUID()),config));
 await svc.process(received.ingestion_id);const result=await svc.process(received.ingestion_id);assert.equal(result.status,'review');assert.equal(result.reason,'invoice_total_requires_review');
 await assert.rejects(svc.archived(result.ingestion_id,config.site+'/Shared Documents/datasource/4T-2026/statement.pdf'),{status:409});
 await db.query("UPDATE ledens.invoice_ingestions SET status='ready',destination_folder='/Shared Documents/datasource/4T-2026' WHERE id=$1",[received.ingestion_id]);
 await assert.rejects(svc.archived(result.ingestion_id,config.site+'/Shared Documents/datasource/4T-2026/statement.pdf'),{status:409,code:'incomplete_document_cannot_archive'});
 const replay=await svc.receive(await validateInvoice(body(generic,randomUUID()),config));assert.equal(replay.document_id,received.document_id);assert.equal(replay.status,'review');
 assert.equal((await svc.process(received.ingestion_id)).status,'review');
});
test('archive requires each essential field and confidence, independently of reconciliation status',()=>{
 const d={document_on:'2026-10-21',total:'-35.00',tipo:'Pagar',invoice_currency:'EUR',date_confidence:.9,total_confidence:.9,direction_confidence:.9};assert.equal(archiveIssue(d),null);
 for(const bad of [{total:null},{invoice_currency:null},{tipo:null},{tipo:'Cobrar'},{document_on:null},{total_confidence:0},{direction_confidence:0}])assert.ok(archiveIssue({...d,...bad}));
});
