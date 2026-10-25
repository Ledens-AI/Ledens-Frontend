import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {parseObramatPages,readObramatPdf} from '../src/ingestion/obramat.js';
import {validateInvoice} from '../src/ingestion/validation.js';
import {IngestionService} from '../src/ingestion/service.js';
import {FinanceService} from '../src/finance/service.js';
import {FinanzasService} from '../src/finanzas/service.js';
import {BridgeService} from '../src/bridge/service.js';
import {purchaseDetails,registerPurchaseDocument} from '../src/finance/purchases.js';
import {cents} from '../src/bridge/rules.js';
let db,pool,service,finance,bridge,admin,project,delivery,refund,documents;
const config={site:'https://ledenses.sharepoint.com/sites/ledens.es',folder:'datasource/Landing facturas',archiveRoot:'datasource'};
const read=p=>fs.readFile(new URL(p,import.meta.url),'utf8');
const header=(number,page,total,refund=false)=>['FACTURA '+(refund?'RECTIFICATIVA ':'')+number,'DUPLICADO','Moneda EUR','BRICOLAJE BRICOMAN S.L.U','Numero NIF : B19753805','Fecha de '+(refund?'devolucion':'venta')+' : 22/10/2026','Pag. '+page+' / '+total,'Ticket de caja : '+(refund?'Reembolso Acuenta (302957)':'Entrega (PEDIDO NO : 302957)'),'C.I.F. B-84406289'];
const format=n=>String(n).replace('.',',');
function row(l){return [l.line_number+' '+l.description+' '+l.quantity+' '+(l.evidence.line_kind==='advance_application'||l.evidence.line_kind==='advance_refund'||l.evidence.line_kind==='advance'?'':'UNID. ')+format(l.evidence.unit_price)+' 0,00 '+format(l.evidence.unit_price)+' 21.00 '+format(l.evidence.unit_gross)+' '+format(l.gross_amount),l.product_code];}
function deliveryPages(){const goods=delivery.lines,adjustment=delivery.settlement_lines;return [[...header(delivery.document_number,1,2),...goods.slice(0,15).flatMap(row)].join('\n'),[...header(delivery.document_number,2,2),...goods.slice(15).flatMap(row),...adjustment.flatMap(row),'ANTICIPO 21.00% -633.16 -132.96 0,00','21.00 633.16 132.96 0,00'].join('\n'),'CONDICIONES GENERALES\nTexto no financiero'];}
const advancePages=()=>[[...header('008-0010-459065',1,1),'1 PAGO ANTICIPADO DEL PEDIDO 302957 1 638,48 0,00 638,48 21.00 772,56 772,56','99999991','ANTICIPO 21.00% 638.48 134.08 772,56'].join('\n'),'CONDICIONES GENERALES'];
const refundPages=()=>[[...header(refund.document_number,1,1,true),...refund.settlement_lines.flatMap(row),'ANTICIPO 21.00% -5.32 -1.12 -6,44'].join('\n'),'CONDICIONES GENERALES'];
async function pdf(pages){const p=await PDFDocument.create(),font=await p.embedFont(StandardFonts.Helvetica);for(const text of pages){const page=p.addPage([595,842]);page.drawText(text,{x:20,y:810,size:7,font,lineHeight:11});}return Buffer.from(await p.save());}
async function ingest(pages,name){const bytes=await pdf(pages),body={site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:randomUUID(),filename:name,content_base64:bytes.toString('base64')};return {body,result:await service.receive(await validateInvoice(body,config))};}
before(async()=>{
 if(process.env.PURCHASE_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.PURCHASE_TEST_DATABASE_URL});db={query:(...a)=>pool.query(...a),exec:q=>pool.query(q),close:()=>pool.end()};}
 else {const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 await db.exec(await read('./finance-fixture.sql'));await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','011_transaction_alerts.sql','012_bridge_party_amount_date.sql','013_pago_trabajadores.sql','014_purchase_settlements.sql'])await db.exec(await read('../src/db/migrations/'+name));
 delivery=JSON.parse(await read('./fixtures/obramat-order-delivery.json'));refund=JSON.parse(await read('./fixtures/obramat-order-refund.json'));
 admin=(await db.query("INSERT INTO users(email,role) VALUES('admin@purchases.test','admin') RETURNING id,email,role")).rows[0];project=(await db.query("INSERT INTO ledens.projects(name) VALUES('Obra') RETURNING id")).rows[0].id;
 service=new IngestionService(pool,null,config);finance=new FinanceService(pool);bridge=new BridgeService(pool);
});after(()=>db?.close());
test('native parser reads all 21 items, not the advance offset or conditions, with exact net and VAT',async()=>{
 const parsed=await readObramatPdf(await pdf(deliveryPages()));assert.equal(parsed.data.lines.length,21);assert.equal(parsed.data.original_pages,3);assert.equal(parsed.data.goods_gross,'766.12');assert.equal(parsed.data.nominal_gross,'0.00');
 assert.equal(parsed.data.lines.reduce((n,l)=>n+cents(l.net_amount),0n),63316n);assert.equal(parsed.data.lines.reduce((n,l)=>n+cents(l.vat_amount),0n),13296n);assert.equal(parsed.data.lines.find(l=>l.line_number===16).quantity,30);
 const missing=parseObramatPages([deliveryPages()[0]]);assert.ok(missing.reason);const wrong=parseObramatPages(deliveryPages().map(p=>p.replaceAll('B19753805','B00000000')));assert.equal(wrong.reason,'purchase_buyer_not_verified');
});
test('delivery, refund and advance arriving out of order produce exactly 21 unassigned items and no bank links',async()=>{
 const d=await ingest(deliveryPages(),'detail.pdf'),r=await ingest(refundPages(),'refund.pdf'),a=await ingest(advancePages(),'advance.pdf');documents={d:d.result.document_id,r:r.result.document_id,a:a.result.document_id,advance:a};
 assert.equal(d.result.status,'ready');assert.equal((await bridge.evaluate(documents.d,{force:true})).reason,'awaiting_advance_payment');
 const family=await purchaseDetails(pool,documents.d);assert.equal(family.family.length,3);assert.equal(family.settlements.length,2);assert.equal(family.advance_available,'0.00');assert.equal(family.refunds[0].status,'pending_bank_refund');
 const pending=await new FinanzasService(pool,admin).listRecords({pending:true,q:delivery.document_number});assert.equal(pending.total,21);assert.ok(pending.rows.every(r=>r.numerodocumento===delivery.document_number&&r.project_id===null&&r.accounting_status==='pending'));assert.equal(pending.rows.reduce((n,r)=>n+cents(r.importe),0n),76612n);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.financial_records')).rows[0].n,21);assert.equal((await db.query('SELECT count(*)::int n FROM ledens.bank_document_allocations')).rows[0].n,0);
});
test('copies marked DUPLICADO and source replays reuse the same fiscal document',async()=>{
 const copy=await ingest([...deliveryPages().slice(0,2).map(p=>p.replace('DUPLICADO','ORIGINAL')),'CONDICIONES GENERALES\nOtra copia'],'copy.pdf');assert.equal(copy.result.duplicate,true);assert.equal(copy.result.document_id,documents.d);
 const replay=await service.receive(await validateInvoice(copy.body,config));assert.equal(replay.replay,true);assert.equal((await db.query('SELECT count(*)::int n FROM ledens.documents')).rows[0].n,3);assert.equal((await db.query('SELECT count(*)::int n FROM ledens.financial_records')).rows[0].n,21);
});
test('the same Bridge covers the paid advance, the zero invoice and a real positive refund',async()=>{
 const pay=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,state,type,currency,completed_on,description) VALUES(-772.56,-772.56,'COMPLETED','CARD_PAYMENT','EUR','2026-10-23','OBRAMAT') RETURNING id")).rows[0].id;
 assert.equal((await bridge.evaluate(documents.a,{force:true})).status,'matched');assert.equal((await bridge.evaluate(documents.d,{force:true})).reason,'covered_by_advance');
 const incoming=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,state,type,currency,completed_on,description) VALUES(6.44,6.44,'COMPLETED','CARD_PAYMENT','EUR','2026-10-23','OBRAMAT') RETURNING id")).rows[0].id;
 assert.equal((await bridge.evaluate(documents.r,{force:true})).status,'matched');assert.equal((await purchaseDetails(pool,documents.d)).refunds[0].status,'matched');
 const list=await finance.list(admin,{unassigned:true});assert.ok(list.filter(r=>r.document_id===documents.d).every(r=>r.reconciled&&r.reconciliation_status==='covered_by_advance'));
 const rows=(await db.query('SELECT document_id,allocated_amount FROM ledens.bank_document_allocations')).rows;assert.equal(rows.length,2);assert.ok(!rows.some(r=>r.document_id===documents.d));assert.equal(rows.reduce((n,r)=>n+cents(r.allocated_amount),0n),-76612n);
});
test('profitability recognizes goods once and treasury inherits only the applied advance through the Bridge',async()=>{
 const rows=(await db.query('SELECT * FROM ledens.financial_records WHERE document_id=$1',[documents.d])).rows;
 for(const r of rows){let current=(await finance.bulk(admin,{request_id:randomUUID(),reason:'Imputación del producto',records:[{record_id:r.id,version:r.version,allocations:[{project_id:project,amount:r.gross_amount}]}]})).records[0];
 await finance.approve(admin,r.id,{version:current.version,category:'other_direct',status:'approved',currency:'EUR',net_amount:r.net_amount,vat_amount:r.vat_amount,nondeductible_vat:'0',withholding_amount:'0',recognized_on:'2026-10-22',reason:'Validación de prueba'});}
 const s=await finance.summary(admin,project);assert.equal(Number(s.direct_cost),633.16);assert.equal(Number(s.payments),766.12);assert.equal(Number(s.collections),0);assert.equal(Number(s.pending_payments),0);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.financial_records WHERE status='approved'")).rows[0].n,21);
});
test('a bank reversal removes inherited coverage without creating a zero-value bank allocation',async()=>{
 await db.query("UPDATE ledens.bank_movements SET state='REVERTED' WHERE amount=-772.56");await bridge.monitor(documents.d);assert.equal((await db.query('SELECT status FROM ledens.bridge_cases WHERE document_id=$1',[documents.d])).rows[0].status,'pending');assert.equal((await db.query('SELECT count(*)::int n FROM ledens.bank_document_allocations WHERE document_id=$1',[documents.d])).rows[0].n,0);
});

test('capacity, immutable sources and authorization protect the document links',async()=>{
 const r=(await db.query('SELECT * FROM ledens.purchase_settlements WHERE related_document_id=$1',[documents.d])).rows[0];
 await assert.rejects(pool.query('UPDATE ledens.purchase_settlements SET gross_amount=900 WHERE id=$1',[r.id]),{code:'23514'});
 await assert.rejects(pool.query('UPDATE ledens.purchase_documents SET goods_gross=800 WHERE document_id=$1',[documents.d]),{code:'23514'});
 const client={id:randomUUID(),role:'client'};await assert.rejects(finance.purchase(client,documents.d),{status:403});
 const j=(await db.query("INSERT INTO users(email,role) VALUES('jefe@purchase.test','jefe') RETURNING id,role")).rows[0];await db.query('INSERT INTO ledens.finance_project_permissions(user_id,project_id,can_write) VALUES($1,$2,true)',[j.id,project]);
 await assert.rejects(finance.purchase(j,documents.d),{status:403});assert.equal((await finance.purchase(admin,documents.d)).family.length,3);
});
test('changed fiscal identity is rejected and a forged native payload cannot bypass PDF validation',async()=>{
 const altered=deliveryPages().map(p=>p.replaceAll('23,72','24,72'));const input={site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:randomUUID(),filename:'invalid.pdf',content_base64:(await pdf(altered)).toString('base64'),nativePurchase:delivery};
 const validated=await validateInvoice(input,config);assert.equal(validated.nativePurchase,null);assert.ok(validated.reason);
 const foreign=deliveryPages().map(p=>p.replaceAll('Moneda EUR','Moneda USD'));assert.equal(parseObramatPages(foreign).reason,'purchase_currency_not_verified');
});
test('an already assigned advance is retained for review rather than silently replaced',async()=>{
 const pages=advancePages().map(p=>p.replaceAll('302957','999001').replaceAll('459065','459067'));const p=parseObramatPages(pages).data;
 const d=(await db.query("INSERT INTO ledens.documents(total,tipo) VALUES(-772.56,'Pagar') RETURNING id")).rows[0].id;
 const l=(await db.query("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,10000,'Anticipo') RETURNING id",[d])).rows[0].id;
 const f=(await db.query("INSERT INTO ledens.financial_records(invoice_line_id,document_id,gross_amount) VALUES($1,$2,772.56) RETURNING *",[l,d])).rows[0];
 await finance.bulk(admin,{request_id:randomUUID(),reason:'Asignación existente',records:[{record_id:f.id,version:f.version,allocations:[{project_id:project,amount:'772.56'}]}]});
 await assert.rejects(finance.transaction(c=>registerPurchaseDocument(c,d,p,{actorId:admin.id})),/purchase_assigned_source_requires_review/);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.project_financial_allocations WHERE record_id=$1',[f.id])).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM ledens.purchase_documents WHERE document_id=$1',[d])).rows[0].n,0);
});
test('PostgreSQL concurrent applications cannot exceed the advance',{skip:!process.env.PURCHASE_TEST_DATABASE_URL},async()=>{
 const ids=[];for(let n=0;n<3;n++)ids.push((await db.query('INSERT INTO ledens.documents DEFAULT VALUES RETURNING id')).rows[0].id);
 for(let n=0;n<3;n++)await db.query("INSERT INTO ledens.purchase_documents(document_id,kind,issuer_tax_id,buyer_tax_id,document_number,order_reference,currency,issued_on,nominal_gross,goods_gross,goods_net,goods_vat,applied_gross,fingerprint,evidence) VALUES($1,$2,'B84406289','B19753805',$3,'RACE','EUR','2026-10-22',$4,$5,$5,0,$5,$3,'{}')",[ids[n],n===0?'advance':'delivery','RACE-'+n,n===0?100:0,n===0?0:80]);
 const results=await Promise.allSettled([1,2].map(n=>finance.transaction(c=>c.query("INSERT INTO ledens.purchase_settlements(advance_document_id,related_document_id,kind,gross_amount) VALUES($1,$2,'application',80)",[ids[0],ids[n]]))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(Number((await db.query('SELECT sum(gross_amount) amount FROM ledens.purchase_settlements WHERE advance_document_id=$1',[ids[0]])).rows[0].amount),80);
});

test('a valid re-upload recovers a legacy F0 review without another document or source',async()=>{
 const pages=deliveryPages().map(p=>p.replaceAll('302957','999003').replaceAll('459619','459622')),bytes=await pdf(pages),body={site_url:config.site,library:'Shared Documents',folder:config.folder,item_id:randomUUID(),filename:'old-three-pages.pdf',content_base64:bytes.toString('base64')};
 const file=await validateInvoice(body,config),old=await service.receive({...file,nativePurchase:null,reason:'f0_page_limit'});assert.equal(old.status,'review');
 const fixed=await service.receive(file);assert.equal(fixed.document_id,old.document_id);assert.equal(fixed.status,'ready');assert.equal(fixed.replay,true);assert.equal((await db.query('SELECT count(*)::int n FROM ledens.financial_records WHERE document_id=$1',[fixed.document_id])).rows[0].n,21);
});
test('a different item under the same fiscal identity is a conflict, not another cost',async()=>{
 const pages=deliveryPages().map(p=>p.replaceAll('IMPRIMACIÓN DE ADHERENCIA PUENTE DE UNIÓ','OTRO PRODUCTO VALIDADO'));
 await assert.rejects(ingest(pages,'changed-copy.pdf'),{status:409,code:'purchase_identity_conflict'});
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.purchase_documents WHERE document_number=$1',[delivery.document_number])).rows[0].n,1);
});
