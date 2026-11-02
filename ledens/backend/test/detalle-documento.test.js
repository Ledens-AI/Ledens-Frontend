import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
// A payment reconciled with an invoice without concepts: Concepto de movimientos
// classifies it as a provisional material, and «Segregar conceptos» in Materiales
// pendiente de asignación reports the missing concepts and takes the attached
// detail of the products (read by a stand-in OCR). Synthetic rows only.
let db,pool,admin,jefe,mov,doc,material;
const asAdmin=()=>new FinanzasService(pool,admin);
const PDF=Buffer.from('%PDF-1.4 detalle');
const field=(amount)=>({valueCurrency:{amount,currencyCode:'EUR'},confidence:0.95});
// What Document Intelligence (prebuilt-invoice) returns, reduced to what the line extraction reads.
const reading=(amounts,total)=>({status:'succeeded',analyzeResult:{content:'',documents:[{fields:{InvoiceTotal:field(total),
 Items:{valueArray:amounts.map((a,i)=>({valueObject:{Description:{valueString:'Producto '+(i+1)},Amount:field(a)}}))}}}]}});
const reader=(result,{calls=[]}={})=>({calls,async start(content,type){calls.push(type);return 'op';},async poll(){return result;}});
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql','026_materiales_provisionales.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@dd.test','admin','Admin'),('jefe@dd.test','jefe','Jefe') RETURNING id,role")).rows;
 mov=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-detalle',-40,-40,'2026-10-10','Pago ferretería','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 doc=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES(-40,'Pagar','2026-10-08','008-0010-471790','Ferretería') RETURNING id`)).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-40,'Confirmado','2026-10-10')",[mov,doc]);
});
after(()=>db?.close());
const row=async()=>(await asAdmin().movements({pageSize:100})).rows.find(r=>r.id===mov);
const pending=async()=>(await asAdmin().listRecords({type:'material',pending:true,pageSize:100})).rows;
const attach=(result,extra={})=>asAdmin().attachDocumentDetail({id:mov,documentId:doc,content:PDF,ocr:reader(result),pollMs:1,...extra});
const records=async()=>(await db.query("SELECT gross_amount::text gross,category FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded' ORDER BY gross_amount",[doc])).rows;

test('Concepto de movimientos classifies it as Pago de materiales: a provisional material, no error about the concepts',async()=>{
 const r=await row();
 assert.equal(r.clase,'pendiente');
 const res=await asAdmin().classifyMovement({id:mov,clase:'materiales',version:r.version});
 assert.equal(res.via,'material');material=res.materialId;
 assert.deepEqual([(await row()).clase,(await row()).origen],['materiales','provisional']);
 const p=(await pending()).find(x=>x.id===material);
 assert.equal(p.provisional,true);
 assert.equal((await pending()).filter(x=>x.provisional).length,1,'only the provisional payment can be segregated');
});

test('a payment reconciled with several documents without concepts still asks to review their ingestion',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-dos',-80,-80,'2026-10-11','Pago dos facturas','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 for(const n of ['F-A','F-B']){const d=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-40,'Pagar','2026-10-08',$1) RETURNING id`,[n])).rows[0].id;
  await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-40,'Confirmado','2026-10-11')",[b,d]);}
 const r=(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b);
 await assert.rejects(asAdmin().classifyMovement({id:b,clase:'materiales',version:r.version}),{status:409,message:/F-A no tiene conceptos registrados; revisa su ingesta/});
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.provisional_material_payments WHERE bank_movement_id=$1',[b])).rows[0].n,0);
});

test('«Segregar conceptos» reports the invoice without concepts, with what the dialog needs',async()=>{
 await assert.rejects(asAdmin().segregateMaterial(material),e=>e.status===409&&/008-0010-471790 no tiene conceptos registrados/.test(e.message)&&
  e.extra.movimiento_id===mov&&e.extra.sin_conceptos[0].id===doc&&e.extra.sin_conceptos[0].total==='-40');
 await assert.rejects(new FinanzasService(pool,jefe).segregateMaterial(material),{status:403});
});

test('a detail that does not add up to the document stores nothing',async()=>{
 await assert.rejects(attach(reading([10,20],30)),{status:422,message:/suman 30\.00 € .* 40\.00 €/});
 assert.deepEqual(await records(),[]);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.invoice_lines WHERE document_id=$1',[doc])).rows[0].n,0);
 await assert.rejects(attach({status:'succeeded',analyzeResult:{documents:[{fields:{}}]}}),{status:422,message:/No se han encontrado productos/});
 await assert.rejects(attach({status:'failed'}),{status:422});
 await assert.rejects(attach({status:'running'},{timeoutMs:0}),{status:504});
});

test('format, size, role, link and reader are checked before reading',async()=>{
 await assert.rejects(attach(reading([40],40),{content:Buffer.from('hola')}),{status:415});
 await assert.rejects(attach(reading([40],40),{content:Buffer.alloc(4*1024*1024+1,0x25)}),{status:413});
 await assert.rejects(attach(reading([40],40),{ocr:null}),{status:503});
 await assert.rejects(new FinanzasService(pool,jefe).attachDocumentDetail({id:mov,documentId:doc,content:PDF,ocr:reader(reading([40],40))}),{status:403});
 const other=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-40,'Pagar','2026-10-08','OTRA') RETURNING id`)).rows[0].id;
 await assert.rejects(asAdmin().attachDocumentDetail({id:mov,documentId:other,content:PDF,ocr:reader(reading([40],40))}),{status:404,message:/no está conciliado/});
});

test('a detail that adds up becomes the invoice concepts and replaces the provisional payment, audited',async()=>{
 const calls=[];
 const res=await asAdmin().attachDocumentDetail({id:mov,documentId:doc,content:PDF,ocr:reader(reading([25,15],40),{calls})});
 assert.deepEqual(calls,['application/pdf']);
 assert.deepEqual([res.lineas,res.segregado],[2,true]);
 assert.deepEqual(await records(),[{gross:'15.00',category:'materials'},{gross:'25.00',category:'materials'}],'the lines inherit Pago de materiales');
 assert.equal((await db.query("SELECT status FROM ledens.financial_records WHERE material_id=$1",[material])).rows[0].status,'excluded');
 const left=await pending();
 assert.ok(!left.some(x=>x.id===material),'the provisional payment leaves the list');
 assert.deepEqual(left.filter(x=>x.document_id===doc).map(x=>x.concepto).sort(),['Producto 1','Producto 2']);
 assert.deepEqual([(await row()).clase,(await row()).origen],['materiales','bridge']);
 const ev=(await db.query("SELECT actor_id,detail FROM ledens.bridge_events WHERE document_id=$1 AND action='detail_attached'",[doc])).rows;
 assert.equal(ev.length,1);assert.equal(ev[0].actor_id,admin.id);assert.equal(ev[0].detail.lineas,2);assert.match(ev[0].detail.attachment_sha256,/^[0-9a-f]{64}$/);
 await assert.rejects(attach(reading([40],40)),{status:409,message:/ya tiene conceptos/});
 await assert.rejects(asAdmin().segregateMaterial(material),{status:409,message:/No es un pago de materiales provisional/});
});
