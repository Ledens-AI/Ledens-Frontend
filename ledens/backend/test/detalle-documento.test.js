import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
// «Adjuntar detalle» in Concepto de movimientos on PGlite: a reconciled document
// without concepts gets them from the OCR of an attached file. Synthetic rows only.
let db,pool,admin,jefe,mov,doc;
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
const attach=(result,extra={})=>asAdmin().attachDocumentDetail({id:mov,documentId:doc,content:PDF,ocr:reader(result),pollMs:1,...extra});
const records=async()=>(await db.query("SELECT gross_amount::text gross FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded' ORDER BY gross_amount",[doc])).rows.map(r=>r.gross);

test('the movement lists the reconciled document without concepts and classifying it says so',async()=>{
 const r=await row();
 assert.deepEqual(r.sin_conceptos,[{id:doc,numerodocumento:'008-0010-471790',total:'-40'}]);
 await assert.rejects(asAdmin().classifyMovement({id:mov,clase:'materiales',version:r.version}),
  e=>e.status===409&&/adjunta el documento con el detalle/.test(e.message)&&e.extra.sin_conceptos[0].id===doc);
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

test('a detail that adds up becomes the document concepts, audited, and the movement can be classified as materiales',async()=>{
 const calls=[];
 const res=await asAdmin().attachDocumentDetail({id:mov,documentId:doc,content:PDF,ocr:reader(reading([25,15],40),{calls})});
 assert.deepEqual(calls,['application/pdf']);
 assert.equal(res.lineas,2);
 assert.deepEqual(res.movimiento.sin_conceptos,[]);
 assert.equal(res.movimiento.registros,2);
 assert.deepEqual(await records(),['15.00','25.00']);
 const ev=(await db.query("SELECT actor_id,detail FROM ledens.bridge_events WHERE document_id=$1 AND action='detail_attached'",[doc])).rows;
 assert.equal(ev.length,1);assert.equal(ev[0].actor_id,admin.id);assert.equal(ev[0].detail.lineas,2);assert.match(ev[0].detail.attachment_sha256,/^[0-9a-f]{64}$/);
 const done=await asAdmin().classifyMovement({id:mov,clase:'materiales',version:res.movimiento.version});
 assert.deepEqual([done.via,done.changed],['registros',2]);
 await assert.rejects(attach(reading([40],40)),{status:409,message:/ya tiene conceptos/});
});
