import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import express from 'express';
import { createHash } from 'node:crypto';
import { invoiceQuarter, validateInvoice } from '../src/ingestion/validation.js';
import { extractInvoice, trustedOperation, partyNameEvidence } from '../src/ingestion/ocr.js';
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
// Pages of different widths (301, 302, …) tell which pages reached the OCR.
// texts[i] is written on page i+1 (empty: no text layer, like a scan).
const pagesPdf=async(n,texts=[])=>{const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let i=1;i<=n;i++){const p=pdf.addPage([300+i,400]);if(texts[i-1])p.drawText(texts[i-1],{x:20,y:200,size:10,font});}return Buffer.from(await pdf.save());};
const widths=async(bytes)=>(await PDFDocument.load(bytes)).getPages().map(p=>p.getWidth());
test('a PDF over two pages sends pages 1 and 2 to the OCR when no total is found on page 3; the original and its hash stay whole',async()=>{
  const original=await pagesPdf(6);
  const file=await validateInvoice(payload('long',{content_base64:original.toString('base64')}),config);
  assert.equal(file.reason,null);assert.equal(file.pageCount,6);
  assert.deepEqual(await widths(file.ocrContent),[301,302]);
  assert.ok(file.content.equals(original));assert.equal(file.hash,createHash('sha256').update(original).digest('hex'));
  const two=await validateInvoice(payload('two',{content_base64:(await pagesPdf(2)).toString('base64')}),config);
  assert.equal(two.ocrContent,null,'up to two pages the whole file goes to the OCR');assert.equal(two.reason,null);
  // The OCR receives exactly that first page; the stored hash is the original's.
  const sent=[];const svc=new IngestionService({connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},{...ocr,start:async(content)=>{sent.push(content);return ocr.start();}},config);
  const row=await svc.receive(file);assert.equal(row.status,'received');
  assert.equal((await svc.process(row.ingestion_id)).status,'analyzing');
  assert.deepEqual(await widths(sent[0]),[301,302]);
  assert.equal((await db.query('SELECT content_hash FROM ledens.invoice_ingestions WHERE id=$1',[row.ingestion_id])).rows[0].content_hash,file.hash);
});
test('a PDF held as f0_page_limit is analysed when it arrives again, also re-uploaded under another name',async()=>{
  const sent=[];const svc=new IngestionService({connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},{...ocr,start:async(content)=>{sent.push(content);return ocr.start();}},config);
  for(const [n,again] of [[7,payload('orange')],[8,payload('orange-2',{filename:'Orange copia.pdf'})]]){
    const content_base64=(await pagesPdf(n)).toString('base64'),first={...payload(again.item_id==='orange'?'orange':'orange-1',{content_base64})};
    const valid=await validateInvoice(first,config);
    // As before this change: held for review, nothing stored for the OCR.
    const held=await svc.receive({...valid,reason:'f0_page_limit',ocrContent:null});
    assert.deepEqual([held.status,held.reason],['review','f0_page_limit']);
    const back=await svc.receive(await validateInvoice({...again,content_base64},config));
    assert.deepEqual([back.status,back.reason,back.duplicate],['received',null,false],'the Logic App only processes non-duplicates');
    assert.equal((await svc.process(back.ingestion_id)).status,'analyzing');
    assert.deepEqual(await widths(sent.at(-1)),[301,302]);
  }
});
test('a supplier invoice without our tax id is to pay when the seller has a valid other tax id; ambiguous cases stay in review',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  const inv=(fields)=>({analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-10-20',confidence:.99},InvoiceId:{valueString:'FT-1',confidence:.95},
    InvoiceTotal:{valueCurrency:{amount:15.25,currencyCode:'EUR'},confidence:.98},SubTotal:{valueCurrency:{amount:12.6}},TotalTax:{valueCurrency:{amount:2.65}},...fields}}]}});
  const issue=(x)=>archiveIssue({document_on:x.date,total:x.total,tipo:x.direction,invoice_currency:x.currency,date_confidence:x.confidence,total_confidence:x.totalConfidence,direction_confidence:x.directionConfidence});
  const telecom=extractInvoice(inv({VendorTaxId:{valueString:'ES A82009812',confidence:.95},VendorName:{valueString:'Operador Telecom SA',confidence:.9}}));
  assert.deepEqual([telecom.direction,telecom.total,telecom.subtotal,telecom.directionConfidence,telecom.taxId],['Pagar',-15.25,-12.6,.95,'ES A82009812']);
  assert.equal(issue(telecom),null,'accepted and processed');
  // The seller's tax id is what makes it a supplier invoice: without it, or with a doubtful one, review.
  assert.equal(issue(extractInvoice(inv({VendorName:{valueString:'Sin NIF',confidence:.9}}))),'invoice_direction_requires_review');
  assert.equal(issue(extractInvoice(inv({VendorTaxId:{valueString:'A82009812',confidence:.3}}))),'invoice_fields_require_review');
  assert.equal(extractInvoice(inv({VendorTaxId:{valueString:'123',confidence:.95}})).direction,null,'not a tax id');
  // Existing rules are unchanged.
  assert.equal(extractInvoice(inv({VendorTaxId:{valueString:'B19753805',confidence:.95}})).direction,'Cobrar');
  assert.equal(extractInvoice(inv({VendorTaxId:{valueString:'A82009812',confidence:.95},CustomerTaxId:{valueString:'B19753805',confidence:.9}})).directionConfidence,.9);
  assert.equal(extractInvoice(inv({VendorTaxId:{valueString:'B19753805',confidence:.95},CustomerTaxId:{valueString:'B19753805',confidence:.9}})).direction,null,'ours on both sides');
});
test('a supplier invoice held on direction is analysed again when it arrives again, unless it already has bank links',async()=>{
  const sent=[];const svc=new IngestionService({connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},{...ocr,start:async(content)=>{sent.push(content);return ocr.start();}},config);
  const hold=async(id)=>{const pdf=await PDFDocument.create();pdf.addPage([300+sent.length+id.length,100]);const content_base64=Buffer.from(await pdf.save()).toString('base64');
    const row=await svc.receive(await validateInvoice(payload(id,{content_base64}),config));
    await db.query("UPDATE ledens.invoice_ingestions SET status='review',reason='invoice_direction_requires_review',content=NULL WHERE id=$1",[row.ingestion_id]);
    return {row,content_base64};};
  const a=await hold('dir-a');
  const back=await svc.receive(await validateInvoice(payload('dir-a-again',{content_base64:a.content_base64,filename:'otra.pdf'}),config));
  assert.deepEqual([back.status,back.reason,back.duplicate],['received',null,false]);
  assert.equal((await svc.process(back.ingestion_id)).status,'analyzing');
  // Already linked to a bank movement: not reopened.
  const b=await hold('dir-b');
  await db.exec('CREATE TABLE IF NOT EXISTS ledens.bank_document_allocations(document_id uuid)');
  await db.query('INSERT INTO ledens.bank_document_allocations(document_id) VALUES($1)',[b.row.document_id]);
  const again=await svc.receive(await validateInvoice(payload('dir-b-again',{content_base64:b.content_base64,filename:'otra-b.pdf'}),config));
  assert.deepEqual([again.status,again.reason,again.duplicate],['review','invoice_direction_requires_review',true]);
});
test('the total is looked for in the first three pages: page 3 replaces page 2 only when the total is there',async()=>{
  const sent=async(texts,n=6)=>{const file=await validateInvoice(payload('t'+Math.random(),{content_base64:(await pagesPdf(n,texts)).toString('base64')}),config);return [file.ocrPageNumbers,await widths(file.ocrContent)];};
  assert.deepEqual(await sent(['Factura FA-1 Fecha 01/10/2026','Detalle de consumos','Total factura 15,25 €']),[[1,3],[301,303]]);
  assert.deepEqual(await sent(['Factura FA-2','Importe total 99,00 EUR','Total factura 99,00 €']),[[1,2],[301,302]],'the first total wins');
  assert.deepEqual(await sent(['Factura FA-3 TOTAL: 15,25 €','Detalle','Total a pagar 15,25']),[[1,2],[301,302]],'total on page 1 keeps 1 and 2');
  assert.deepEqual(await sent(['Factura FA-4','Subtotal 10,00','Detalle de llamadas']),[[1,2],[301,302]],'a subtotal is not the total');
  assert.deepEqual(await sent(['Factura FA-5','Detalle','Total factura 3,00 €'],3),[[1,3],[301,303]],'also with exactly three pages');
});
test('a tax id printed with its label («ES NIF B…», «IE VAT IE…») is still recognised: an Anthropic-style invoice is to pay',async()=>{
  const {taxId}=await import('../src/bridge/rules.js');
  for(const [raw,id] of [['ES NIF B19753805','B19753805'],['NIF: B19753805','B19753805'],['N.I.F. B-19753805','B19753805'],['CIF B19753805','B19753805'],
    ['IE VAT IE4276970QH','IE4276970QH'],['VAT No. GB123456789','GB123456789'],['NIE X1234567L','X1234567L'],['ESB19753805','B19753805'],['B19753805','B19753805'],['A82009812','A82009812']])
    assert.equal(taxId(raw),id,raw);
  const inv=(fields)=>({analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-10-19',confidence:.99},InvoiceId:{valueString:'9BF0758D-9436361',confidence:.95},
    InvoiceTotal:{valueCurrency:{amount:18,currencyCode:'EUR'},confidence:.98},SubTotal:{valueCurrency:{amount:18}},...fields}}]}});
  // Our NIF as the buyer, with its label, is enough even when the seller's id is not read.
  const buyer=extractInvoice(inv({CustomerTaxId:{valueString:'ES NIF B19753805',confidence:.93},VendorName:{valueString:'Anthropic Ireland, Limited',confidence:.9}}));
  assert.deepEqual([buyer.direction,buyer.total,buyer.directionConfidence],['Pagar',-18,.93]);
  const seller=extractInvoice(inv({VendorTaxId:{valueString:'IE VAT IE4276970QH',confidence:.9}}));
  assert.equal(seller.direction,'Pagar');
  assert.equal(extractInvoice(inv({VendorTaxId:{valueString:'ES NIF B19753805',confidence:.9}})).direction,'Cobrar','our labelled id as seller');
});
