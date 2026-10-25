import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument } from 'pdf-lib';
import express from 'express';
import { createHash } from 'node:crypto';
import { invoiceQuarter, validateInvoice } from '../src/ingestion/validation.js';
import { extractInvoice, trustedOperation, partyNameEvidence,prepareOcrInput,InvoiceOcr } from '../src/ingestion/ocr.js';
import { IngestionService } from '../src/ingestion/service.js';
import { createIngestionRouter } from '../src/routes/ingestion.js';

const config={site:'https://ledenses.sharepoint.com/sites/ledens.es',folder:'datasource/Landing facturas',archiveRoot:'datasource'};
let db,service,pdf64;
let starts=0;
const ocr={start:async()=>{starts++;return 'https://test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/1';},
  poll:async()=>({status:'succeeded',analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2025-09-30',confidence:0.99},InvoiceTotal:{valueCurrency:{amount:121,currencyCode:'EUR'},confidence:.99},VendorTaxId:{valueString:'B19753805',confidence:.99}}}]}})};
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE SCHEMA ledens; CREATE TABLE ledens.documents
    (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),registered_on date, review_state text,enlacearchivo text,
    observaciones text,document_on date,trimestre text,numerodocumento text,tercero text,niftercero text,
    base_amount numeric,vat_amount numeric,total numeric,tipo text);`);
  await db.exec(await fs.readFile(new URL('../src/db/migrations/004_invoice_ingestion.sql',import.meta.url),'utf8'));
  await db.exec('ALTER TABLE ledens.invoice_ingestions ADD COLUMN invoice_currency text,ADD COLUMN total_confidence numeric,ADD COLUMN number_confidence numeric,ADD COLUMN party_confidence numeric,ADD COLUMN tax_id_confidence numeric,ADD COLUMN direction_confidence numeric,ADD COLUMN document_evidence jsonb');
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
test('long PDFs send only page one to OCR and preserve original bytes and hash',async()=>{
  const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage();
  const file=await validateInvoice(payload('long',{content_base64:Buffer.from(await pdf.save()).toString('base64')}),config);
  assert.equal(file.reason,null);assert.equal((await PDFDocument.load(file.content)).getPageCount(),3);
  const prepared=await prepareOcrInput(file.content,file.type);assert.equal((await PDFDocument.load(prepared.content)).getPageCount(),1);assert.deepEqual(prepared.scope.pages,[1]);assert.equal(prepared.scope.original_pages,3);
  assert.equal(file.hash,createHash('sha256').update(file.content).digest('hex'));
  let sent;const reader=new InvoiceOcr('https://test.cognitiveservices.azure.com','test',async(_url,options)=>{sent=options.body;return {ok:true,headers:{get:()=> 'https://test.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/one'}};});
  await reader.start(file.content,file.type);assert.equal((await PDFDocument.load(sent)).getPageCount(),1);
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
  for(const date of [undefined,{valueDate:'2025-02-30',confidence:1},{valueDate:'2025-09-30',confidence:0.49}]) {
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

test('invoice date minimum confidence is inclusive at 50 percent',()=>{
 for(const confidence of [0.5,0.669,0.89,1])assert.equal(extractInvoice({analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-09-22',confidence}}}]}}).date,'2026-09-22');
 for(const confidence of [0.499,1.01])assert.equal(extractInvoice({analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-09-22',confidence}}}]}}).reason,'invoice_date_requires_review');
});

test('supplier corroboration uses only high-confidence words inside the vendor field and a verified vendor NIF',()=>{
 const result={analyzeResult:{documents:[{fields:{VendorName:{valueString:'OBRAMAT',confidence:.481,spans:[{offset:0,length:7}]},VendorTaxId:{valueString:'B84406289',confidence:.82},CustomerName:{valueString:'Company'}}}],pages:[{words:[{content:'OBRAMAT',confidence:.989,span:{offset:0,length:7}},{content:'OBRAMAT',confidence:.999,span:{offset:100,length:7}}]}]}};
 const e=partyNameEvidence(result,'Vendor');assert.equal(e.name_field_confidence,.481);assert.equal(e.word_confidence,.989);assert.equal(e.tax_id_confidence,.82);
 const outside=structuredClone(result);outside.analyzeResult.pages[0].words.shift();assert.equal(partyNameEvidence(outside,'Vendor'),null);
 const poor=structuredClone(result);poor.analyzeResult.documents[0].fields.VendorTaxId.confidence=.499;assert.equal(partyNameEvidence(poor,'Vendor'),null);
 const lowWord=structuredClone(result);lowWord.analyzeResult.pages[0].words[0].confidence=.499;assert.equal(partyNameEvidence(lowWord,'Vendor'),null);
 const customer=structuredClone(result);customer.analyzeResult.documents[0].fields.CustomerName.valueString='OBRAMAT';assert.equal(partyNameEvidence(customer,'Vendor'),null);
});
test('previous F0 page rejection resumes the same ingestion and records first-page scope',async()=>{
 const pdf=await PDFDocument.create();for(let i=0;i<6;i++)pdf.addPage();const original=Buffer.from(await pdf.save()),file=await validateInvoice(payload('retry-long',{content_base64:original.toString('base64')}),config);
 const first=await service.receive(file);await db.query("UPDATE ledens.invoice_ingestions SET status='review',reason='f0_page_limit',content=NULL WHERE id=$1",[first.ingestion_id]);
 const resumed=await service.receive(file);assert.equal(resumed.ingestion_id,first.ingestion_id);assert.equal(resumed.document_id,first.document_id);assert.equal(resumed.status,'received');
 assert.equal((await service.process(resumed.ingestion_id)).status,'analyzing');
 const row=(await db.query('SELECT content,content_hash,document_evidence FROM ledens.invoice_ingestions WHERE id=$1',[resumed.ingestion_id])).rows[0];
 assert.equal(row.content_hash,createHash('sha256').update(original).digest('hex'));assert.equal(row.content.length,original.length);assert.equal(row.document_evidence.original_pages,6);assert.deepEqual(row.document_evidence.pages,[1]);
 assert.equal((await service.process(resumed.ingestion_id)).status,'ready');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.invoice_sources WHERE ingestion_id=$1',[resumed.ingestion_id])).rows[0].n,1);
 const short=await PDFDocument.create();short.addPage();short.addPage();const two=Buffer.from(await short.save());assert.equal((await prepareOcrInput(two,'application/pdf')).content,two);
});
