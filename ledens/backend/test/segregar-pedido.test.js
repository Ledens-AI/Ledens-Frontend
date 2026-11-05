import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
// «Segregar» with the documents of an Obramat order: a payment of 2500 € reconciled
// with its anticipo, a devolución of 200 € paid back into the same account and a
// factura de entrega with 2300 € of products. The PDFs are read by a stand-in for
// readObramatPdf (what it returns, reduced); PGlite, synthetic rows only.
let db,pool,admin,acc,pay,anticipo,refund,decoy,material;
const asAdmin=()=>new FinanzasService(pool,admin);
const ORDER='400100',BASE={issuer_tax_id:'B84406289',buyer_tax_id:'B19753805',order_reference:ORDER,currency:'EUR',goods_gross:'0.00',goods_net:'0.00',goods_vat:'0.00',applied_gross:'0.00'};
const settle=(n,text,gross)=>[{line_number:1,description:`${text} ${n}`,product_code:'99999991',quantity:1,gross_amount:gross,evidence:{origin:'native-pdf-obramat-v1'}}];
const PDFS={
 anticipo:{...BASE,kind:'advance',document_number:'008-0010-500001',issued_on:'2026-10-01',nominal_gross:'2500.00',nominal_net:'2066.12',nominal_vat:'433.88',lines:[],settlement_lines:settle(ORDER,'PAGO ANTICIPADO DEL PEDIDO','2500.00'),fingerprint:'fp-anticipo'},
 devolucion:{...BASE,kind:'advance_refund',document_number:'008-0010-R500002',issued_on:'2026-10-05',nominal_gross:'-200.00',nominal_net:'-165.29',nominal_vat:'-34.71',lines:[],settlement_lines:settle(ORDER,'YA PAGADO DEL PEDIDO','-200.00'),fingerprint:'fp-devolucion'},
 entrega:{...BASE,kind:'delivery',document_number:'008-0010-500003',issued_on:'2026-10-09',nominal_gross:'0.00',nominal_net:'0.00',nominal_vat:'0.00',goods_gross:'2300.00',goods_net:'1900.83',goods_vat:'399.17',applied_gross:'2300.00',
  lines:[{line_number:1,description:'Azulejo',product_code:'12345678',quantity:10,gross_amount:'1500.00',net_amount:'1239.67',vat_amount:'260.33',evidence:{origin:'native-pdf-obramat-v1',line_kind:'product'}},
   {line_number:2,description:'Cemento cola',product_code:'12345679',quantity:20,gross_amount:'800.00',net_amount:'661.16',vat_amount:'138.84',evidence:{origin:'native-pdf-obramat-v1',line_kind:'product'}}],
  settlement_lines:settle(ORDER,'YA PAGADO DEL PEDIDO','-2300.00'),fingerprint:'fp-entrega'},
 otroPedido:{...BASE,kind:'delivery',order_reference:'999999',document_number:'008-0010-600001',issued_on:'2026-10-09',nominal_gross:'0.00',nominal_net:'0.00',nominal_vat:'0.00',goods_gross:'2300.00',applied_gross:'2300.00',lines:[],settlement_lines:[],fingerprint:'fp-otro'},
};
const file=name=>Buffer.from('%PDF-1.4 '+name);
const readNative=async content=>({data:PDFS[content.toString().slice(9)]});
const segregate=(names,extra={})=>asAdmin().segregateOrder({materialId:material,files:names.map(file),readNative,...extra});
const active=async d=>(await db.query("SELECT gross_amount::text gross,category FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded' ORDER BY gross_amount",[d])).rows;
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 await db.exec('ALTER TABLE ledens.bank_movements ADD COLUMN IF NOT EXISTS bank_account_id uuid');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','011_transaction_alerts.sql','012_bridge_party_amount_date.sql','013_pago_trabajadores.sql','016_cash_movements.sql','014_purchase_settlements.sql','026_materiales_provisionales.sql','029_provisional_todas_las_facturas.sql','027_transferencias_internas.sql','028_treasury_movements.sql','030_efectivo_importado.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 admin=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@sp.test','admin','Admin') RETURNING id,role")).rows[0];
 acc=crypto.randomUUID();
 const bank=async(amount,on,description,account=acc)=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state,bank_account_id)
  VALUES($1,$2,$2,$3,$4,'EUR','COMPLETED',$5) RETURNING id`,['MOV-'+description,amount,on,description,account])).rows[0].id;
 pay=await bank(-2500,'2026-10-02','ADEO OBRAMAT SPAIN pago');
 anticipo=(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero) VALUES(-2500,'Pagar','2026-10-01','008-0010-500001','OBRAMAT','B84406289') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-2500,'Confirmado','2026-10-02')",[pay,anticipo]);
 refund=await bank(200,'2026-10-07','Refund from Adeo Obramat Spain');
 // The same amount in another account, and in this account before the payment: never the devolución.
 await bank(200,'2026-10-07','Refund Obramat otra cuenta',crypto.randomUUID());
 await bank(200,'2026-09-20','Refund Obramat anterior');
 // The payment as a material: Concepto de movimientos classifies it (a provisional payment).
 const row=async id=>(await asAdmin().movements({pageSize:100})).rows.find(r=>r.id===id);
 material=(await asAdmin().classifyMovement({id:pay,clase:'materiales',version:(await row(pay)).version})).materialId;
 // The receipt already classified as «Reembolso de proveedor»: it would lower the cost twice.
 await asAdmin().classifyMovement({id:refund,clase:'reembolso_proveedor',version:(await row(refund)).version});
});
after(()=>db?.close());

test('the documents must be of the anticipo\'s order and add up to it; otherwise nothing is registered',async()=>{
 await assert.rejects(segregate(['anticipo','entrega']),{status:422,message:/2500\.00 €, y los productos de las facturas \(2300\.00 €\) más las devoluciones \(0\.00 €\) suman 2300\.00 €: falta algún documento/});
 await assert.rejects(segregate(['anticipo','devolucion']),{status:422,message:/Falta la factura con los productos/});
 await assert.rejects(segregate(['entrega','otroPedido']),{status:422,message:/pedidos distintos/});
 await assert.rejects(segregate(['entrega']),{status:422,message:/falta algún documento/});
 await assert.rejects(segregate(['anticipo','anticipo','entrega']),{status:422,message:/dos veces/});
 await assert.rejects(asAdmin().segregateOrder({materialId:material,files:[Buffer.from('no pdf')],readNative}),{status:415});
 assert.deepEqual(await active(anticipo),[]);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.purchase_documents')).rows[0].n,0);
});

test('several receipts fit the devolución: the admin picks one, nothing is registered meanwhile',async()=>{
 const twin=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state,bank_account_id)
  VALUES('MOV-twin',200,200,'2026-10-08','Obramat abono','EUR','COMPLETED',$1) RETURNING id`,[acc])).rows[0].id;
 const e=await segregate(['anticipo','devolucion','entrega']).catch(e=>e);
 assert.equal(e.status,409);assert.match(e.message,/varios cobros que pueden ser la devolución 008-0010-R500002/);
 assert.deepEqual(e.extra.devoluciones_ambiguas[0].candidatos.map(c=>c.id).sort(),[refund,twin].sort());
 assert.deepEqual(await active(anticipo),[]);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.purchase_documents')).rows[0].n,0);

});

test('anticipo − devolución = entrega: the material becomes the products, the devolución is reconciled with its receipt',async()=>{
 // The admin picks the receipt (the other one, MOV-twin, stays as it was).
 const res=await segregate(['devolucion','entrega','anticipo'],{refundMovements:{'008-0010-R500002':refund}});
 assert.equal(res.segregado,true);assert.equal(res.pedido,ORDER);assert.equal(res.lineas,2);
 assert.deepEqual(res.devoluciones.map(d=>[d.documento,d.importe,d.movimiento?.id]),[['008-0010-R500002','200.00',refund]]);
 // The products are the anticipo's concepts (materials); the devolución line counts for nothing.
 assert.deepEqual(await active(anticipo),[{gross:'800.00',category:'materials'},{gross:'1500.00',category:'materials'}]);
 const lines=(await db.query('SELECT l.description,l.gross_amount::text gross,r.status FROM ledens.invoice_lines l JOIN ledens.financial_records r ON r.invoice_line_id=l.id WHERE l.document_id=$1 ORDER BY l.line_number',[anticipo])).rows;
 assert.deepEqual(lines.map(l=>[l.description,l.gross,l.status]),[['Azulejo','1500.00','pending'],['Cemento cola','800.00','pending'],['Devolución del anticipo · 008-0010-R500002','200.00','excluded']]);
 const m=(await db.query('SELECT status,source_valid FROM ledens.financial_records WHERE material_id=$1',[material])).rows[0];
 assert.deepEqual([m.status,m.source_valid],['excluded',false]);
 // The devolución is its own document (014), reconciled with the receipt of the same account.
 const r=(await db.query("SELECT d.id,d.total::text total,d.tipo,p.kind FROM ledens.documents d JOIN ledens.purchase_documents p ON p.document_id=d.id WHERE d.numerodocumento='008-0010-R500002'")).rows[0];
 assert.deepEqual([r.total,r.tipo,r.kind],['200.00','Cobrar','advance_refund']);
 const a=(await db.query("SELECT bank_movement_id,allocated_amount::text amount,state FROM ledens.bank_document_allocations WHERE document_id=$1",[r.id])).rows;
 assert.deepEqual(a,[{bank_movement_id:refund,amount:'200.00',state:'Confirmado'}]);
 // Its «Reembolso de proveedor» no longer lowers the cost: the devolución already does.
 assert.deepEqual((await db.query("SELECT count(*)::int n FROM ledens.financial_records WHERE bank_movement_id=$1 AND source_valid AND status<>'excluded'",[refund])).rows[0].n,0);
 const q=(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===refund);
 assert.equal(q.clase,'materiales');
 const pending=(await asAdmin().reconciliation({view:'movimientos',pageSize:100})).rows.map(x=>x.id);
 assert.ok(!pending.includes(refund),'the receipt leaves Pendiente de conciliación');
 // Bank −2500 + 200 = cost 2300.
 const cost=(await db.query("SELECT sum(gross_amount)::text s FROM ledens.financial_records WHERE source_valid AND status<>'excluded' AND (document_id=$1 OR bank_movement_id=ANY($2::uuid[]))",[anticipo,[pay,refund]])).rows[0].s;
 assert.equal(cost,'2300.00');
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.bank_document_allocations a JOIN ledens.bank_movements b ON b.id=a.bank_movement_id WHERE b.source_id='MOV-twin'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.bridge_events WHERE action IN ('order_segregated','order_refund_linked')")).rows[0].n,2);
 await assert.rejects(segregate(['devolucion','entrega','anticipo']),{status:409,message:/ya no cuenta/});
});

// Any other supplier: its documents are read by the invoice OCR (a stand-in returning
// what prebuilt-invoice returns, reduced). An anticipo of 1000 €, an invoice of 850 €
// with its products and a credit note of 150 € paid back into the same account.
const field=(amount)=>({valueCurrency:{amount,currencyCode:'EUR'},confidence:0.95});
const invoice=({id,total,items,tax='B12345674',date='2026-10-15'})=>({status:'succeeded',analyzeResult:{content:'',documents:[{fields:{
 InvoiceDate:{valueDate:date,confidence:0.99},InvoiceTotal:field(total),InvoiceId:{valueString:id,confidence:0.95},
 VendorName:{valueString:'Cocinas Sur SL',confidence:0.95},VendorTaxId:{valueString:tax,confidence:0.95},CustomerTaxId:{valueString:'B19753805',confidence:0.95},
 Items:{valueArray:items.map((a,i)=>({valueObject:{Description:{valueString:'Mueble '+(i+1)},Amount:field(a)}}))}}}]}});
const OCR={factura:invoice({id:'CS-F-7',total:850,items:[500,350]}),abono:invoice({id:'CS-A-2',total:-150,items:[-150]}),
 descuadre:invoice({id:'CS-F-8',total:850,items:[500,300]}),otro:invoice({id:'OT-1',total:850,items:[850],tax:'B87654321'})};
const ocr={async start(content){return content.toString().slice(9);},async poll(name){return OCR[name];}};
test('another supplier: the invoice OCR reads the documents, and the anticipo is split the same way',async()=>{
 const pay2=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state,bank_account_id)
  VALUES('MOV-cocinas',-1000,-1000,'2026-10-10','Cocinas Sur anticipo','EUR','COMPLETED',$1) RETURNING id`,[acc])).rows[0].id;
 const a2=(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero) VALUES(-1000,'Pagar','2026-10-09','CS-ANT-1','Cocinas Sur','B-12345674') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-1000,'Confirmado','2026-10-10')",[pay2,a2]);
 const q2=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state,bank_account_id)
  VALUES('MOV-cocinas-abono',150,150,'2026-10-20','Transferencia Cocinas Sur','EUR','COMPLETED',$1) RETURNING id`,[acc])).rows[0].id;
 const mov=(await asAdmin().movements({pageSize:100})).rows.find(r=>r.id===pay2);
 const m2=(await asAdmin().classifyMovement({id:pay2,clase:'materiales',version:mov.version})).materialId;
 const run=(names)=>asAdmin().segregateOrder({materialId:m2,files:names.map(file),readNative,ocr,pollMs:1});
 await assert.rejects(run(['factura','otro']),{status:422,message:/otro proveedor/});
 await assert.rejects(run(['descuadre','abono']),{status:422,message:/CS-F-8.*no se han podido leer los importes de cada producto/});
 await assert.rejects(run(['abono']),{status:422,message:/Falta la factura con los productos/});
 await assert.rejects(asAdmin().segregateOrder({materialId:m2,files:[file('factura')],readNative}),{status:503});
 assert.deepEqual(await active(a2),[]);
 const res=await run(['abono','factura']);
 assert.equal(res.pedido,null);assert.equal(res.lineas,2);
 assert.deepEqual(res.devoluciones.map(d=>[d.documento,d.importe,d.movimiento?.id]),[['CS-A-2','150.00',q2]]);
 assert.deepEqual(await active(a2),[{gross:'350.00',category:'materials'},{gross:'500.00',category:'materials'}]);
 const r=(await db.query("SELECT d.id,d.total::text total,d.tipo,d.tercero FROM ledens.documents d WHERE d.numerodocumento='CS-A-2'")).rows[0];
 assert.deepEqual([r.total,r.tipo,r.tercero],['150.00','Cobrar','Cocinas Sur']);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.bank_document_allocations WHERE document_id=$1 AND bank_movement_id=$2 AND state='Confirmado'",[r.id,q2])).rows[0].n,1);
 // The receipt is materials (the devolución of an anticipo), not pending, and cannot be reclassified.
 const q=(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===q2);
 assert.deepEqual([q.clase,q.origen],['materiales','devolucion_anticipo']);
 assert.ok(!(await asAdmin().reconciliation({view:'movimientos',pageSize:100})).rows.some(x=>x.id===q2));
 const cost=(await db.query("SELECT sum(gross_amount)::text s FROM ledens.financial_records WHERE source_valid AND status<>'excluded' AND (document_id=$1 OR bank_movement_id=ANY($2::uuid[]))",[a2,[pay2,q2]])).rows[0].s;
 assert.equal(cost,'850.00');
});

// A «Documento pendiente de desglose» (a document read without lines) can be segregated
// too: with its detail (one file) or with the documents of its anticipo (several). Its
// lines replace it and inherit its class and obra.
test('a Documento pendiente de desglose is segregated into the lines of what is attached, keeping its class and obra',async()=>{
 const obra=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Sobre','P-SOBRE') RETURNING id")).rows[0].id;
 const envelope=async(numero,total)=>{
  const d=(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero) VALUES($1,'Pagar','2026-10-19',$2,'Cocinas Sur','B12345674') RETURNING id",[-total,numero])).rows[0].id;
  const l=(await db.query("INSERT INTO ledens.invoice_lines(document_id,line_number,description,evidence) VALUES($1,10000,'Documento pendiente de desglose','{\"kind\":\"document_review_envelope\"}') RETURNING id",[d])).rows[0].id;
  const r=(await db.query("INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency,category) VALUES($1,$2,'2026-10-19','Documento pendiente de desglose',$3,'EUR','materials') RETURNING id",[l,d,total])).rows[0].id;
  await db.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES($1,$2,$3)',[r,obra,total]);
  return {d,l,r};
 };
 const lines=async d=>(await db.query(`SELECT r.gross_amount::text gross,r.category,(SELECT project_id FROM ledens.project_financial_allocations a WHERE a.record_id=r.id) obra
  FROM ledens.financial_records r WHERE r.document_id=$1 AND r.source_valid AND r.status<>'excluded' ORDER BY r.gross_amount`,[d])).rows;
 OCR.detalle=invoice({id:'ENV-1',total:120,items:[70,50]});
 const e1=await envelope('ENV-1',120);
 const row=(await asAdmin().listRecords({q:'ENV-1',pageSize:100})).rows.find(r=>r.id===e1.l);
 assert.equal(row?.segregable,true,'the envelope offers «Segregar»');
 const res=await asAdmin().attachDocumentDetail({id:null,documentId:e1.d,content:file('detalle'),ocr,readNative,pollMs:1});
 assert.deepEqual([res.lineas,res.segregado],[2,true]);
 assert.deepEqual(await lines(e1.d),[{gross:'50.00',category:'materials',obra},{gross:'70.00',category:'materials',obra}]);
 assert.equal((await db.query('SELECT status FROM ledens.financial_records WHERE id=$1',[e1.r])).rows[0].status,'excluded');
 // An anticipo read without lines, not reconciled with any payment: the devolución waits for the Bridge.
 OCR.factura2=invoice({id:'CS-F-9',total:250,items:[150,100]});OCR.abono2=invoice({id:'CS-A-9',total:-50,items:[-50]});
 const e2=await envelope('CS-ANT-9',300);
 const order=await asAdmin().segregateOrder({documentId:e2.d,files:[file('factura2'),file('abono2')],readNative,ocr,pollMs:1});
 assert.deepEqual(order.devoluciones.map(d=>[d.documento,d.importe,d.movimiento]),[['CS-A-9','50.00',null]]);
 assert.deepEqual(await lines(e2.d),[{gross:'100.00',category:'materials',obra},{gross:'150.00',category:'materials',obra}]);
 // A validated envelope needs its validation removed first.
 const e3=await envelope('ENV-3',120);await db.query("UPDATE ledens.financial_records SET status='approved',net_amount=99.17,vat_amount=20.83,nondeductible_vat=0,withholding_amount=0,recognized_on='2026-10-19' WHERE id=$1",[e3.r]);
 OCR.detalle3=invoice({id:'ENV-3',total:120,items:[70,50]});
 await assert.rejects(asAdmin().attachDocumentDetail({id:null,documentId:e3.d,content:file('detalle3'),ocr,readNative,pollMs:1}),{status:409,message:/validado/});
});

// A plain Obramat sale (no order) whose OCR reading could not add up its lines: its own
// text gives them (readObramatSalePdf, a stand-in here), for one file and for several.
test('a plain Obramat sale is segregated from its PDF text, without the OCR',async()=>{
 const d=(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero) VALUES(-60.50,'Pagar','2026-10-05','008-0010-900001','OBRAMAT','B84406289') RETURNING id")).rows[0].id;
 const l=(await db.query("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,10000,'Documento pendiente de desglose') RETURNING id",[d])).rows[0].id;
 await db.query("INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency,category) VALUES($1,$2,'2026-10-05','Documento pendiente de desglose',60.50,'EUR','materials')",[l,d]);
 const sale={kind:'sale',issuer_tax_id:'B84406289',document_number:'008-0010-900001',issued_on:'2026-10-05',gross:'60.50',
  lines:[{line_number:1,description:'SACO PRUEBA',product_code:'12345678',quantity:10,gross_amount:'10.00',net_amount:'8.26',vat_amount:'1.74',evidence:{origin:'native-pdf-obramat-sale-v1'}},
   {line_number:2,description:'TABLERO PRUEBA',product_code:'12345679',quantity:2,gross_amount:'50.50',net_amount:'41.74',vat_amount:'8.76',evidence:{origin:'native-pdf-obramat-sale-v1'}}]};
 const readSale=async()=>({data:sale});
 // No OCR configured: the sale does not need it.
 const res=await asAdmin().attachDocumentDetail({id:null,documentId:d,content:file('venta'),readNative,readSale});
 assert.equal(res.lineas,2);
 assert.deepEqual(await active(d),[{gross:'10.00',category:'materials'},{gross:'50.50',category:'materials'}]);
 assert.equal((await db.query("SELECT detail->>'source' s FROM ledens.bridge_events WHERE document_id=$1 AND action='detail_attached'",[d])).rows[0].s,'native-pdf-obramat-sale-v1');
});
