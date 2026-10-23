import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument } from 'pdf-lib';
import express from 'express';
import { createHash } from 'node:crypto';
import { invoiceQuarter, validateInvoice } from '../src/ingestion/validation.js';
import { extractInvoice, trustedOperation } from '../src/ingestion/ocr.js';
import { IngestionService } from '../src/ingestion/service.js';
import { createIngestionRouter } from '../src/routes/ingestion.js';

const config={site:'https://ledenses.sharepoint.com/sites/ledens.es',folder:'datasource/Landing facturas',archiveRoot:'datasource'};
let db,service,pdf64;
let starts=0;
const ocr={start:async()=>{starts++;return 'https://test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/1';},
  poll:async()=>({status:'succeeded',analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2025-09-30',confidence:0.99},InvoiceTotal:{valueCurrency:{amount:121}}}}]}})};
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA ledens; CREATE TABLE ledens.documents
    (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),registered_on date, review_state text,enlacearchivo text,
    observaciones text,document_on date,trimestre text,numerodocumento text,tercero text,niftercero text,
    base_amount numeric,vat_amount numeric,total numeric,tipo text);`);
  await db.exec(await fs.readFile(new URL('../src/db/migrations/004_invoice_ingestion.sql',import.meta.url),'utf8'));
  await db.exec('ALTER TABLE ledens.invoice_ingestions ADD COLUMN invoice_currency text,ADD COLUMN total_confidence numeric,ADD COLUMN number_confidence numeric,ADD COLUMN party_confidence numeric,ADD COLUMN tax_id_confidence numeric,ADD COLUMN direction_confidence numeric');
  const pool={connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})};
  service=new IngestionService(pool,ocr,config);
  const pdf=await PDFDocument.create();pdf.addPage();pdf64=Buffer.from(await pdf.save()).toString('base64');
});
after(async()=>{await db?.close();});
const payload=(id,extra={})=>({site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:id,filename:'invoice.pdf',content_base64:pdf64,...extra});

test('invoice quarter uses invoice date and rejects invalid dates',()=>{
  for(const [date,q] of [['2025-03-31','1T-2025'],['2025-04-01','2T-2025'],['2025-09-30','3T-2025'],['2025-10-01','4T-2025']]) assert.equal(invoiceQuarter(date),q);
  for(const date of ['2025-02-29','2025-13-01','01/10/2025',null]) assert.equal(invoiceQuarter(date),null);
});
test('untrusted folder, path traversal and mismatching signature are rejected',async()=>{
  await assert.rejects(validateInvoice(payload('1',{folder:'other'}),config),{code:'invalid_source'});
  await assert.rejects(validateInvoice(payload('1',{filename:'../a.pdf'}),config),{code:'invalid_filename_or_id'});
  await assert.rejects(validateInvoice(payload('1',{content_base64:Buffer.from('fake').toString('base64')}),config),{status:415});
  await assert.rejects(validateInvoice(payload('1',{content_base64:'%%%'}),config),{code:'invalid_base64'});
});
test('F0 long PDFs require review instead of processing a truncated document',async()=>{
  const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage();
  const file=await validateInvoice(payload('long',{content_base64:Buffer.from(await pdf.save()).toString('base64')}),config);
  assert.equal(file.reason,'f0_page_limit');
});
test('deduplicates source replay and identical bytes uploaded under a different name',async()=>{
  const first=await service.receive(await validateInvoice(payload('original'),config));
  const replay=await service.receive(await validateInvoice(payload('original'),config));
  const copy=await service.receive(await validateInvoice(payload('copy',{filename:'copy.pdf'}),config));
  assert.equal(first.duplicate,false);assert.equal(replay.replay,true);assert.equal(copy.duplicate,true);
  assert.equal(first.document_id,copy.document_id);
  assert.equal((await db.query('SELECT count(*)::int n FROM ledens.documents')).rows[0].n,1);
  const changed={...await validateInvoice(payload('original'),config),hash:'a'.repeat(64)};
  await assert.rejects(service.receive(changed),{status:409});
});
test('OCR start/poll retries do not repeat extraction and archive requires a valid destination',async()=>{
  const row=await service.receive(await validateInvoice(payload('original'),config));
  assert.equal((await service.process(row.ingestion_id)).status,'analyzing');
  const ready=await service.process(row.ingestion_id);
  assert.equal(ready.invoice_date,'2025-09-30');assert.equal(ready.destination_folder,'/Shared Documents/datasource/3T-2025');
  assert.equal((await service.process(row.ingestion_id)).status,'ready');assert.equal(starts,1);
  await assert.rejects(service.archived(row.ingestion_id,'https://evil.example/invoice.pdf'),{status:400});
  const url=config.site+'/Shared%20Documents/datasource/3T-2025/invoice.pdf';
  assert.equal((await service.archived(row.ingestion_id,url)).status,'archived');
  assert.equal((await service.archived(row.ingestion_id,url)).status,'archived');
  const doc=(await db.query('SELECT * FROM ledens.documents WHERE id=$1',[row.document_id])).rows[0];
  assert.equal(doc.trimestre,'3T-2025');assert.equal(doc.total,'121');assert.equal(doc.review_state,'pendiente_revision');
});
test('missing, impossible and low confidence dates never permit a move',()=>{
  for(const date of [undefined,{valueDate:'2025-02-30',confidence:1},{valueDate:'2025-09-30',confidence:0.89}]) {
    assert.ok(extractInvoice({analyzeResult:{documents:[{fields:{InvoiceDate:date}}]}}).reason);
  }
  assert.ok(extractInvoice({analyzeResult:{documents:[{},{}]}}).reason);
  assert.throws(()=>trustedOperation('https://evil.example/', 'https://test.cognitiveservices.azure.com'));
});
test('endpoint authenticates before body parsing and rejects invalid ids',async()=>{
  const token='a'.repeat(43);const tokenHash=createHash('sha256').update(token).digest('hex');
  const app=express();app.use('/ingest',createIngestionRouter({service,config,tokenHash}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/ingest`;
  try {
    assert.equal((await fetch(base,{method:'POST',body:'{'})).status,401);
    assert.equal((await fetch(base+'/bad/process',{method:'POST',headers:{Authorization:'Bearer '+token}})).status,400);
    const res=await fetch(base,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload('original'))});
    assert.equal(res.status,200);assert.equal((await res.json()).replay,true);
  } finally {await new Promise(r=>server.close(r));}
});
