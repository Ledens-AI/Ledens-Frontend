import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import express from 'express';
import { createHash } from 'node:crypto';
import { invoiceQuarter, validateInvoice } from '../src/ingestion/validation.js';
import { extractInvoice, trustedOperation, partyNameEvidence, payslipPeriodEnd, payslipNet, validSpanishTaxId, soleDateConfidence } from '../src/ingestion/ocr.js';
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
test('a payslip is dated on the last day of its periodo de liquidación, whatever date the OCR picked',()=>{
  const slip=period=>`EMPRESA\nANTIGÜEDAD\n03/08/26\nPERIODO DE LIQUIDACIÓN\nT. DÍAS\nMALAGA\n29149952067\n${period}\n30\nDEVENGOS\nLÍQUIDO A PERCIBIR\n1.332,17`;
  for(const [period,end] of [['1/31-10-2026','2026-10-31'],['01/30-09-2026','2026-09-30'],['01/10/2026 a 31/10/2026','2026-10-31'],
    ['del 1 al 28 de febrero de 2026','2026-02-28'],['MENS 01 OCT 26 a 31 OCT 2026','2026-10-31']]){
    assert.equal(payslipPeriodEnd(slip(period)),end,period);
    const r=extractInvoice({analyzeResult:{content:slip(period),documents:[{fields:{InvoiceDate:{valueDate:'2026-08-03',confidence:.44}}}]}});
    assert.equal(r.date,end,period);assert.equal(r.confidence,.9);assert.equal(r.corroborated.date,'payslip_period_end');
  }
  // Without payslip contents the label alone proves nothing; an impossible period is ignored.
  assert.equal(payslipPeriodEnd('PERIODO DE LIQUIDACIÓN 1/31-10-2026 TOTAL 100,00'),null);
  assert.equal(payslipPeriodEnd('PERIODO DE LIQUIDACIÓN 1/31-13-2026 DEVENGOS'),null);
  assert.equal(extractInvoice({analyzeResult:{content:'FACTURA 01/10/2026',documents:[{fields:{InvoiceDate:{valueDate:'2026-09-22',confidence:.9}}}]}}).date,'2026-09-22');
});
test('a payslip of ours is a cost to pay for its líquido a percibir, only when devengos minus deducciones prove it',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  // Boxes as the OCR reads them: the líquido sits among other amounts after its label.
  const slip=(net,nif='B19753805')=>`EMPRESA\nPERIODO DE LIQUIDACIÓN\n1/31-10-2026\nDEVENGOS\nRETENCIONES\nTOTALES\n1.424,77\n92,60\n`+
    `LÍQUIDO A PERCIBIR\nTRABAJADOR\n1.424,77\n0,15\n2,14\n66,96\n${net}\nNIF : ${nif}\nRECIBÍ:`;
  const doc=content=>({analyzeResult:{content,documents:[{fields:{InvoiceDate:{valueDate:'2026-08-03',confidence:.44},CustomerName:{valueString:'ANZOLA GOMEZ ANA LUISA',confidence:.31}}}]}});
  assert.equal(payslipNet(slip('1.332,17')),133217);
  const r=extractInvoice(doc(slip('1.332,17')));
  assert.deepEqual([r.date,r.total,r.direction,r.currency,r.vendor],['2026-10-31',-1332.17,'Pagar','EUR','ANZOLA GOMEZ ANA LUISA']);
  assert.equal(archiveIssue({document_on:r.date,total:r.total,tipo:r.direction,invoice_currency:r.currency,date_confidence:r.confidence,total_confidence:r.totalConfidence,direction_confidence:r.directionConfidence}),null);
  // No amount that is devengos − deducciones, or not our payslip: no total, so it stays in review.
  assert.equal(payslipNet(slip('1.300,00')),null);
  for(const content of [slip('1.300,00'),slip('1.332,17','B12345674')])assert.notEqual(extractInvoice(doc(content)).direction,'Pagar');
});

test('a supplier credit note (negative total, we are the buyer) is money back: Cobrar, positive',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  const doc=(amount,customer='B19753805')=>({analyzeResult:{content:'FACTURA RECTIFICATIVA',documents:[{fields:{InvoiceDate:{valueDate:'2026-10-28',confidence:.66},
    VendorName:{valueString:'OBRAMAT',confidence:.65},VendorTaxId:{valueString:'B-84406289',confidence:.55},CustomerTaxId:{valueString:customer,confidence:.81},
    InvoiceTotal:{valueCurrency:{amount,currencyCode:'EUR'},confidence:.66}}}]}});
  const r=extractInvoice(doc(-10));
  assert.deepEqual([r.direction,r.total,r.vendor,r.taxId,r.directionConfidence],['Cobrar',10,'OBRAMAT','B-84406289',.81]);
  assert.equal(archiveIssue({document_on:r.date,total:r.total,tipo:r.direction,invoice_currency:r.currency,date_confidence:r.confidence,total_confidence:r.totalConfidence,direction_confidence:r.directionConfidence}),null);
  // An ordinary purchase is unchanged.
  assert.deepEqual([extractInvoice(doc(10)).direction,extractInvoice(doc(10)).total],['Pagar',-10]);
});

test('a ticket with no customer is a purchase from the one valid Spanish tax id the OCR read in its text',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  assert.deepEqual(['44582380P','B19753805','B84406289','X1234567L'].map(validSpanishTaxId),[true,true,true,true]);
  assert.deepEqual(['44582380Q','B19753806','A280695'].map(validSpanishTaxId),[false,false,false]);
  const ticket=(content,fields={})=>{const at=content.indexOf('Nif: ')+5;return {analyzeResult:{content,documents:[{fields:{InvoiceDate:{valueDate:'2026-10-27',confidence:.97},
    VendorName:{valueString:'ELECTROPINTURAS SEDEÑO',confidence:.81},InvoiceTotal:{valueCurrency:{amount:9.5,currencyCode:'EUR'},confidence:.58},...fields}}],
    pages:[{words:[{content:content.slice(at,at+9),confidence:.957,span:{offset:at,length:9}}]}]}};};
  const r=extractInvoice(ticket('ELECTROPINTURAS SEDEÑO\nNºTicket: A280695\nTotal Ticket 9,50\nNif: 44582380P'));
  assert.deepEqual([r.direction,r.total,r.taxId,r.directionConfidence],['Pagar',-9.5,'44582380P',.957]);
  assert.equal(archiveIssue({document_on:r.date,total:r.total,tipo:r.direction,invoice_currency:r.currency,date_confidence:r.confidence,total_confidence:r.totalConfidence,direction_confidence:r.directionConfidence}),null);
  // A wrong control letter, our own id, two ids, or a customer on the document: no direction.
  for(const t of [ticket('Nif: 44582380Q'),ticket('Nif: 44582380P\nCIF B19753805'),ticket('Nif: 44582380P\nNIF: B84406289'),
    ticket('Nif: 44582380P',{CustomerName:{valueString:'Otro',confidence:.9}})])assert.equal(extractInvoice(t).direction,null);
});

test('a photo with no tax id fields is ours to pay when the OCR text prints our tax id after «RECEPTOR»',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  const photo=(content,conf=.95)=>{const at=content.indexOf('B19753805');return {analyzeResult:{content,documents:[{fields:{InvoiceDate:{valueDate:'2026-10-20',confidence:.94},
    VendorName:{valueString:'MARKOIL, S.A.U.',confidence:.93},CustomerName:{valueString:'SOCIEDAD INVERSORA NAVARRO-ROBINSON, S.',confidence:.89},
    InvoiceTotal:{valueCurrency:{amount:72.27,currencyCode:'EUR'},confidence:.93}}}],
    pages:[{words:at<0?[]:[{content:'B19753805',confidence:conf,span:{offset:at,length:9}}]}]}};};
  const r=extractInvoice(photo('EMISOR\nMARKOIL, S.A.U.\nA79209854\nRECEPTOR\nSOCIEDAD INVERSORA NAVARRO-ROBINSON, S.\nMALAGA\nB19753805\nTOTAL FACTURA: 72.27'));
  assert.deepEqual([r.direction,r.total,r.taxId,r.directionConfidence,r.corroborated.direction],['Pagar',-72.27,'A79209854',.95,'customer_label_in_ocr_text']);
  assert.equal(archiveIssue({document_on:r.date,total:r.total,tipo:r.direction,invoice_currency:r.currency,date_confidence:r.confidence,total_confidence:r.totalConfidence,direction_confidence:r.directionConfidence}),null);
  // Our tax id as the issuer, before any buyer label: not a purchase. A poorly read id keeps it in review.
  assert.equal(extractInvoice(photo('EMISOR\nB19753805\nRECEPTOR\nOTRA S.L.\nA79209854')).direction,null);
  assert.ok(extractInvoice(photo('RECEPTOR\nB19753805\nA79209854',.4)).directionConfidence<.5);
});

test('a low-confidence OCR date is confirmed when it is the only full date printed, by the words that read it',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  const ticket=(content,date='2026-11-03')=>{const m=/\d{2}-\d{2}-\d{4}/.exec(content);return {analyzeResult:{content,documents:[{fields:{InvoiceDate:{valueDate:date,confidence:.439},
    VendorName:{valueString:'EESSA ES. TORREMOLINOS',confidence:.93},VendorTaxId:{valueString:'CIF:A80393812',confidence:.93},
    CustomerTaxId:{valueString:'B19753805',confidence:.64},InvoiceTotal:{valueCurrency:{amount:80,currencyCode:'EUR'},confidence:.82}}}],
    pages:[{words:m?[{content:m[0],confidence:.994,span:{offset:m.index,length:10}}]:[]}]}};};
  const r=extractInvoice(ticket('FACTURA : 0010554444\nTOTAL € 80.00\nCliente:\nNIF B19753805\n03-11-2026 06:38:25 2815 NATI'));
  assert.deepEqual([r.date,r.confidence,r.total,r.direction,r.corroborated.date],['2026-11-03',.994,-80,'Pagar','sole_date_in_ocr_text']);
  assert.equal(archiveIssue({document_on:r.date,total:r.total,tipo:r.direction,invoice_currency:r.currency,date_confidence:r.confidence,total_confidence:r.totalConfidence,direction_confidence:r.directionConfidence}),null);
  // Another date printed, or the OCR picked a date that is not the printed one: still in review.
  assert.equal(extractInvoice(ticket('03-11-2026 06:38\nVencimiento 03/12/2026')).reason,'invoice_date_requires_review');
  assert.equal(extractInvoice(ticket('03-11-2026 06:38','2026-11-30')).reason,'invoice_date_requires_review');
  assert.equal(soleDateConfidence(ticket('03-11-2026 y 2026-11-03'),'2026-11-03'),.994,'the same date in two formats is one date');
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
test('a store ticket with only a header on page 1 and «Total TTI» on page 3 sends pages 2 and 3',async()=>{
  const sent=async(texts,n=4)=>{const file=await validateInvoice(payload('k'+Math.random(),{content_base64:(await pagesPdf(n,texts)).toString('base64')}),config);return [file.ocrPageNumbers,await widths(file.ocrContent)];};
  const header='FACTURA 008-0010-453160 DUPLICADO BRICOLAJE BRICOMAN',items='Malaga, a 19 Octubre 2026 Numero NIF B19753805 Fecha de venta 19/10/2026 1 SACO RAFIA 25KG 25 UNID 0,17 2 PTA 4C BORMUJOS 80x60 1 UNID 21,49';
  assert.deepEqual(await sent([header,items,'Tasa IVA Total. SI Total IVA Total TTI (EUR) 403,45']),[[2,3],[302,303]]);
  assert.deepEqual(await sent([[header,...Array(12).fill('Linea de detalle del documento')].join('\n'),items,'Total TTI (EUR) 403,45']),[[1,3],[301,303]],'a full first page stays');
  assert.deepEqual(await sent([header,items,'Total IVA 70,02']),[[1,2],[301,302]],'«Total IVA» alone is not the invoice total');
});
test('an invoice held for date, total or low-confidence fields is read again on resend; other reasons and linked documents are not',async()=>{
  const sent=[];const svc=new IngestionService({connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},{...ocr,start:async(content)=>{sent.push(content);return ocr.start();}},config);
  const resend=async(reason,id)=>{const pdf=await PDFDocument.create();pdf.addPage([500+id.length,100]);const content_base64=Buffer.from(await pdf.save()).toString('base64');
    const row=await svc.receive(await validateInvoice(payload(id,{content_base64}),config));
    await db.query("UPDATE ledens.invoice_ingestions SET status='review',reason=$2,content=NULL WHERE id=$1",[row.ingestion_id,reason]);
    return svc.receive(await validateInvoice(payload(id+'-again',{content_base64,filename:id+'.pdf'}),config));};
  for(const reason of ['invoice_date_requires_review','invoice_total_requires_review','invoice_fields_require_review','invoice_currency_requires_review']){
    const back=await resend(reason,'r-'+reason);assert.deepEqual([back.status,back.duplicate],['received',false],reason);
  }
  const other=await resend('ocr_rejected_document','r-other-reason');
  assert.deepEqual([other.status,other.reason],['review','ocr_rejected_document'],'not an OCR field reason');
});
test('totals printed in the PDF text: one repeated amount, or the sum of base and VAT; «Total IVA» or two different totals are not',async()=>{
  const {textTotals}=await import('../src/ingestion/ocr.js');
  assert.deepEqual(textTotals('Total TTI (EUR)  21.00   333.43   70.02   403,45'),[40345],'OBRAMAT store ticket: 21.00 is the VAT rate');
  assert.deepEqual(textTotals('Total a pagar (€)   15,25  Gestiona tu línea:  1471'),[1525],'Orange');
  assert.deepEqual(textTotals('Total   €18.00  Amount due   €18.00'),[1800],'Anthropic');
  assert.deepEqual(textTotals('Total factura 1.234,56 €'),[123456]);
  assert.deepEqual(textTotals('Subtotal 10,00 Total IVA 2,10'),[]);
  assert.deepEqual(textTotals('Total factura 10,00 € … Total a pagar 12,00 €').sort(),[1000,1200],'two different totals are both returned (ambiguous)');
});
test('the PDF text confirms a low-confidence OCR total and direction, or supplies a missing total; it never decides alone',async()=>{
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  const issue=(x)=>archiveIssue({document_on:x.date,total:x.total,tipo:x.direction,invoice_currency:x.currency,date_confidence:x.confidence,total_confidence:x.totalConfidence,direction_confidence:x.directionConfidence});
  const inv=(fields)=>({analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-10-05',confidence:.945},InvoiceId:{valueString:'A1',confidence:.9},...fields}}]}});
  // Orange: total .462 and direction .369 → review without text, ready with it.
  const orange=inv({InvoiceTotal:{valueCurrency:{amount:15.25,currencyCode:'EUR'},confidence:.462},CustomerTaxId:{valueString:'B19753805',confidence:.369}});
  const orangeText='Titular: SOCIEDAD INVERSORA NAVARRO-ROBINSON CIF: B19753805 Este mes tu factura es de 15,25 € Total a pagar (€) 15,25 CIF A-82009812';
  assert.equal(issue(extractInvoice(orange)),'invoice_fields_require_review');
  const o=extractInvoice(orange,{pdfText:orangeText});
  assert.deepEqual([o.direction,o.total,o.totalConfidence,o.directionConfidence,o.corroborated],['Pagar',-15.25,.9,.9,{total:'ocr_total_in_text',direction:'CustomerTaxId'}]);
  assert.equal(issue(o),null);
  // OBRAMAT store ticket: no OCR total; the text gives 403,45 = 333.43 + 70.02.
  const obramat=inv({CustomerTaxId:{valueString:'B19753805',confidence:.8},VendorTaxId:{valueString:'B-84406289',confidence:.7}});
  const ticketText='FACTURA 008-0010-453160 Numero NIF : B19753805 Total TTI (EUR)  21.00   333.43   70.02   403,45 C.I.F. B-84406289';
  assert.equal(issue(extractInvoice(obramat)),'invoice_total_requires_review');
  const t=extractInvoice(obramat,{pdfText:ticketText});
  assert.deepEqual([t.total,t.currency,t.totalConfidence,t.directionConfidence,t.corroborated],[-403.45,'EUR',.9,.8,{total:'text_total'}]);
  assert.equal(issue(t),null);
  // The text never overrides or invents.
  assert.equal(extractInvoice(orange,{pdfText:'Total a pagar (€) 99,00 CIF: B19753805'}).totalConfidence,.462,'a different total does not confirm');
  assert.equal(extractInvoice(obramat,{pdfText:'Total factura 10,00 € Total a pagar 12,00 € B19753805'}).total,null,'two different totals: none');
  assert.equal(extractInvoice(orange,{pdfText:'Total a pagar (€) 15,25'}).directionConfidence,.369,'our NIF not printed: direction not confirmed');
  assert.equal(extractInvoice(inv({InvoiceTotal:{valueCurrency:{amount:15.25,currencyCode:'EUR'},confidence:.9}}),{pdfText:orangeText}).direction,null,'no tax id read: no direction from the text');
});
test('process reads the text layer of the PDF sent to the OCR and archives an Orange-like invoice',async()=>{
  const fields={InvoiceDate:{valueDate:'2026-10-05',confidence:.945},InvoiceId:{valueString:'A10020920606-1026',confidence:.9},
    InvoiceTotal:{valueCurrency:{amount:15.25,currencyCode:'EUR'},confidence:.462},CustomerTaxId:{valueString:'B19753805',confidence:.369}};
  const svc=new IngestionService({connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},{...ocr,poll:async()=>({status:'succeeded',analyzeResult:{documents:[{fields}]}})},config);
  const pdf=await pagesPdf(1,['CIF: B19753805 Total a pagar (EUR) 15,25 Orange Espagne CIF A-82009812']);
  const row=await svc.receive(await validateInvoice(payload('orange-text',{content_base64:pdf.toString('base64'),filename:'orange.pdf'}),config));
  await svc.process(row.ingestion_id);
  const done=await svc.process(row.ingestion_id);
  assert.deepEqual([done.status,done.reason??null],['ready',null]);
  const i=(await db.query('SELECT total_confidence::float t,direction_confidence::float d FROM ledens.invoice_ingestions WHERE id=$1',[row.ingestion_id])).rows[0];
  assert.deepEqual(i,{t:.9,d:.9});
});
test('when the OCR places no tax id, our NIF after a buyer label in the PDF text makes it a supplier invoice to pay',async()=>{
  const {buyerFromText}=await import('../src/ingestion/ocr.js');
  const {archiveIssue}=await import('../src/ingestion/completeness.js');
  const own='B19753805';
  const septic='12345678Z 1 / 1 Autónomo Ejemplo 12345678 Z C/ Ficticia 1 CLIENTE SOCIEDAD INVERSORA NAVARRO ROBINSON S . L . B 19753805 AVENIDA DE LA PALOMA FACTURA Nº F-0001 Total 338,80 €';
  assert.deepEqual(buyerFromText(septic,own),{supplierTaxId:'12345678Z'});
  assert.deepEqual(buyerFromText('Bill to: Ledens B-19753805 · Seller A82009812 · Bank B12345674',own),{supplierTaxId:null},'two other ids: buyer still, supplier unknown');
  assert.equal(buyerFromText('SOCIEDAD INVERSORA NAVARRO ROBINSON B19753805 Calle X · Cliente: Pepe Pérez 12345678Z',own),null,'our own issued invoice: our id comes before the label');
  assert.equal(buyerFromText('CLIENTE Ledens B19753805',own),null,'no other tax id: no supplier');
  assert.equal(buyerFromText('CLIENTE Pepe Pérez 12345678Z '+'x '.repeat(200)+'B19753805',own),null,'too far from the label');
  // Extraction: the OCR read no tax id at all.
  const inv={analyzeResult:{documents:[{fields:{InvoiceDate:{valueDate:'2026-10-09',confidence:.965},InvoiceId:{valueString:'F-0001',confidence:.9},
    InvoiceTotal:{valueCurrency:{amount:338.8,currencyCode:'EUR'},confidence:.948},SubTotal:{valueCurrency:{amount:280}},TotalTax:{valueCurrency:{amount:58.8}}}}]}};
  assert.equal(extractInvoice(inv).direction,null,'without text: still in review');
  const x=extractInvoice(inv,{pdfText:septic});
  assert.deepEqual([x.direction,x.total,x.directionConfidence,x.taxId,x.corroborated?.direction],['Pagar',-338.8,.9,'12345678Z','customer_label_in_text']);
  assert.equal(archiveIssue({document_on:x.date,total:x.total,tipo:x.direction,invoice_currency:x.currency,date_confidence:x.confidence,total_confidence:x.totalConfidence,direction_confidence:x.directionConfidence}),null);
  // A direction the OCR did set is never overridden by the label rule.
  const issued={analyzeResult:{documents:[{fields:{...inv.analyzeResult.documents[0].fields,VendorTaxId:{valueString:'B19753805',confidence:.9}}}]}};
  assert.equal(extractInvoice(issued,{pdfText:septic}).direction,'Cobrar');
});
