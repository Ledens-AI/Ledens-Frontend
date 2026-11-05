import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql','026_materiales_provisionales.sql','029_provisional_todas_las_facturas.sql','027_transferencias_internas.sql','028_treasury_movements.sql','030_efectivo_importado.sql'])
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

test('a payment reconciled with several documents without concepts is classified; the obra waits for every invoice, and the provisional is replaced only then (029)',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const b=(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-dos',-80,-80,'2026-10-11','Pago dos facturas','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const docs={};
 for(const n of ['F-A','F-B']){docs[n]=(await q(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-40,'Pagar','2026-10-08',$1) RETURNING id`,[n])).rows[0].id;
  await q("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-40,'Confirmado','2026-10-11')",[b,docs[n]]);}
 const r=(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b);
 const {materialId,recordId}=await asAdmin().classifyMovement({id:b,clase:'materiales',version:r.version});
 // The missing concepts are reported when it is assigned to an obra.
 const obra=(await q("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Dos','P-DOS') RETURNING id")).rows[0].id;
 const rec=(await asAdmin().listRecords({type:'material',pending:true,q:'Pago dos facturas'})).rows[0];
 await assert.rejects(asAdmin().assign({type:'material',id:materialId,projectId:obra,version:rec.version,requestId:crypto.randomUUID()}),{status:409,message:/F-A no tiene conceptos registrados.*antes de asignarlo a una obra/});
 const addLine=async(d,gross)=>{const l=(await q("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,1,'Material') RETURNING id",[d])).rows[0].id;
  await q(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-08','Material',$3,'EUR')`,[l,d,gross]);};
 await addLine(docs['F-A'],40);
 assert.equal((await q('SELECT status FROM ledens.financial_records WHERE id=$1',[recordId])).rows[0].status,'pending','one invoice is not enough: the 80 € stay represented');
 await addLine(docs['F-B'],40);
 assert.equal((await q('SELECT status FROM ledens.financial_records WHERE id=$1',[recordId])).rows[0].status,'excluded','both invoices: replaced');
 assert.deepEqual((await q("SELECT category FROM ledens.financial_records WHERE document_id=ANY($1::uuid[]) AND source_valid AND status<>'excluded'",[Object.values(docs)])).rows.map(x=>x.category),['materials','materials']);
});

test('a refund reconciled with a credit note without concepts can still be a supplier refund',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-abono',12,12,'2026-10-12','Devolución ferretería','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const d=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(12,'Cobrar','2026-10-12','008-0010-R281273') RETURNING id`)).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,12,'Confirmado','2026-10-12')",[b,d]);
 const find=async()=>(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b);
 const res=await asAdmin().classifyMovement({id:b,clase:'reembolso_proveedor',version:(await find()).version});
 assert.deepEqual([res.via,res.provisional],['material',false]);
 assert.deepEqual([(await find()).clase,(await find()).origen],['reembolso_proveedor','registro']);
 assert.equal((await db.query('SELECT r.gross_amount::text g FROM ledens.material_expenses m JOIN ledens.financial_records r ON r.material_id=m.id WHERE m.bank_movement_id=$1',[b])).rows[0].g,'-12.00');
});

test('a receipt reconciled with a document without concepts can be a client receipt: no error, and it is no longer pending',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state,payer)
  VALUES('MOV-cliente',455.90,455.90,'2026-09-30','Dinero añadido por DAL MOROS','EUR','COMPLETED','DAL MOROS ESPAÑA SL.') RETURNING id`)).rows[0].id;
 const d=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES(455.90,'Cobrar','2026-09-30','3T2026-292','DAL MOROS ESPAÑA SL.') RETURNING id`)).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,455.90,'Confirmado','2026-09-30')",[b,d]);
 const find=async()=>(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b);
 assert.equal((await find()).clase,'pendiente');
 const res=await asAdmin().classifyMovement({id:b,clase:'clientes',version:(await find()).version});
 assert.equal(res.via,'cobro-cliente');
 assert.equal((await find()).clase,'clientes');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.customer_payments WHERE bank_movement_id=$1',[b])).rows[0].n,1);
 // Two documents, only one with concepts: classified by the concepts it has, never pending;
 // the missing ones are reported when its record is assigned to an obra.
 const b2=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-mixto',20,20,'2026-09-30','Cobro dos facturas','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 for(const [n,lines] of [['F-CON',1],['F-SIN',0]]){
  const d2=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(10,'Cobrar','2026-09-30',$1) RETURNING id`,[n])).rows[0].id;
  await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,10,'Confirmado','2026-09-30')",[b2,d2]);
  if(lines){const l=(await db.query("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,1,'Certificación') RETURNING id",[d2])).rows[0].id;
   await db.query("INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-09-30','Certificación',10,'EUR')",[l,d2]);}
 }
 const r2=(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b2);
 assert.equal(r2.clase,'pendiente','its only concept is still unclassified');
 assert.equal((await asAdmin().classifyMovement({id:b2,clase:'clientes',version:r2.version})).via,'registros');
 assert.equal((await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b2).clase,'clientes','classified: F-SIN without concepts does not leave it pending');
 const con=(await asAdmin().listRecords({type:'cliente',pageSize:100})).rows.find(x=>x.numerodocumento==='F-CON');
 const obra=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Mixta','P-MIX') RETURNING id")).rows[0].id;
 await assert.rejects(asAdmin().assign({type:con.type,id:con.id,projectId:obra,version:con.version,requestId:crypto.randomUUID()}),{status:409,message:/F-SIN no tiene conceptos registrados/});
});

test('a payment reconciled with a document without concepts can go to Pendiente de trabajador: no error, no longer pending',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,beneficiary_name,currency,state)
  VALUES('MOV-celestino',-190,-190,'2026-09-10','A Celestino Gomez Rodriguez','Celestino Gomez Rodriguez','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const d=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-190,'Pagar','2026-09-10','258/2026') RETURNING id`)).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-190,'Confirmado','2026-09-10')",[b,d]);
 const find=async()=>(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b);
 const res=await asAdmin().classifyMovement({id:b,clase:'trabajadores',version:(await find()).version});
 assert.equal(res.via,'pendiente-trabajador');
 assert.deepEqual([(await find()).clase,(await find()).origen],['trabajadores','bridge']);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[b])).rows[0].n,1);
});

test('a payment with records of its own is classified by them, whatever its reconciled document without concepts lacks',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,beneficiary_name,currency,state)
  VALUES('MOV-zorrilla',-587.50,-587.50,'2026-09-05','A MARIANO IGNACIO ZORRILLA ORTIZ','MARIANO IGNACIO ZORRILLA ORTIZ','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 // Imported as a worker payment of that movement; its invoice reached the Bridge without concepts.
 await db.query("INSERT INTO ledens.worker_payments(bank_movement_id,occurred_on,empleado,amount) VALUES($1,'2026-09-05','Mariano Zorrilla',587.50)",[b]);
 const d=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-587.50,'Pagar','2026-09-05','3T2026-222') RETURNING id`)).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-587.50,'Confirmado','2026-09-05')",[b,d]);
 const find=async()=>(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b);
 assert.equal((await find()).clase,'trabajadores','not pending: its own record classifies it');
 await assert.rejects(asAdmin().classifyMovement({id:b,clase:'trabajadores',version:(await find()).version,reason:'Mariano Zorrilla'}),{status:409,message:/Ya está clasificado así/});
 const res=await asAdmin().classifyMovement({id:b,clase:'materiales',version:(await find()).version,reason:'Era material'});
 assert.deepEqual([res.via,res.changed],['registros',1]);
 assert.equal((await find()).clase,'materiales');
});

test('«Segregar conceptos» reports the invoice without concepts, with what the dialog needs',async()=>{
 await assert.rejects(asAdmin().segregateMaterial(material),e=>e.status===409&&/008-0010-471790 no tiene conceptos registrados/.test(e.message)&&
  e.extra.movimiento_id===mov&&e.extra.sin_conceptos[0].id===doc&&e.extra.sin_conceptos[0].total==='-40');
 await assert.rejects(new FinanzasService(pool,jefe).segregateMaterial(material),{status:403});
});

test('«Segregar» works on any material: an error without document or with an anticipo, its invoice lines otherwise',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const material=async(total,bank,desc)=>{const m=(await q('INSERT INTO ledens.material_expenses(bank_movement_id,und,description,quantity,unit_price,total,occurred_on) VALUES($1,$5,$2,1,$3,$3,$4) RETURNING id',[bank,desc,total,'2026-11-03','ud'])).rows[0].id;
  return m;};
 const movement=async(src,total)=>(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state) VALUES($1,$2,$2,'2026-11-03','OBRAMAT','EUR','COMPLETED') RETURNING id`,[src,total])).rows[0].id;
 const reconcile=async(b,n,total)=>{const d=(await q(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES($1,'Pagar','2026-11-03',$2) RETURNING id`,[total,n])).rows[0].id;
  await q("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,'Confirmado','2026-11-03')",[b,d,total]);return d;};
 // Without a movement or a reconciled invoice: no document yet.
 const suelto=await material(-20.98,null,'OBRAMAT');
 assert.equal((await pending()).find(x=>x.id===suelto).segregable,true);
 await assert.rejects(asAdmin().segregateMaterial(suelto),{status:409,message:/aún no tiene documento asignado/});
 const sinFactura=await material(-30,await movement('MOV-sin-factura',-30),'OBRAMAT');
 await assert.rejects(asAdmin().segregateMaterial(sinFactura),{status:409,message:/aún no tiene documento asignado: concilia su movimiento/});
 // An anticipo: its document has no concepts.
 const bAnt=await movement('MOV-anticipo',-50);await reconcile(bAnt,'ANT-1',-50);
 await assert.rejects(asAdmin().segregateMaterial(await material(-50,bAnt,'Anticipo OBRAMAT')),{status:409,message:/ANT-1 no tiene conceptos registrados \(es un anticipo/});
 // An invoice with its lines: the material is replaced by them, which inherit its class.
 const b=await movement('MOV-lineas',-20.98),d=await reconcile(b,'FAC-OBRA',-20.98);
 for(const [i,g] of [[1,12.5],[2,8.48]]){const l=(await q("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,'Producto') RETURNING id",[d,i])).rows[0].id;
  await q("INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-11-03','Producto',$3,'EUR')",[l,d,g]);}
 const m=await material(-20.98,b,'OBRAMAT');
 assert.deepEqual(await asAdmin().segregateMaterial(m),{material_id:m,segregado:true,documentos:['FAC-OBRA']});
 assert.equal((await q('SELECT status FROM ledens.financial_records WHERE material_id=$1',[m])).rows[0].status,'excluded');
 assert.deepEqual((await q("SELECT category FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded'",[d])).rows.map(x=>x.category),['materials','materials']);
 await assert.rejects(asAdmin().segregateMaterial(m),{status:409,message:/ya no cuenta/});
 // A material that is not the whole payment is not segregated automatically.
 const b2=await movement('MOV-parcial',-40),d2=await reconcile(b2,'FAC-PARCIAL',-40);
 const l2=(await q("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,1,'Producto') RETURNING id",[d2])).rows[0].id;
 await q("INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-11-03','Producto',40,'EUR')",[l2,d2]);
 await assert.rejects(asAdmin().segregateMaterial(await material(-10,b2,'Parte')),{status:409,message:/no coincide con el del movimiento/});
});

test('a detail that does not add up to the document stores nothing',async()=>{
 await assert.rejects(attach(reading([10,20],30)),{status:422,message:/suman 30\.00 € .* 40\.00 €/});
 assert.deepEqual(await records(),[]);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.invoice_lines WHERE document_id=$1',[doc])).rows[0].n,0);
 await assert.rejects(attach({status:'succeeded',analyzeResult:{documents:[{fields:{}}]}}),{status:422,message:/No se han encontrado productos/});
 await assert.rejects(attach({status:'failed'}),{status:422});
 await assert.rejects(attach({status:'running'},{timeoutMs:0}),{status:504});
});

test('a rate-limited reader (429 of the free tier) is retried, not fatal; quota or key errors say so',async()=>{
 const err=(status,extra={})=>Object.assign(new Error('ocr_request_failed'),{status,transient:status===429||status>=500,...extra});
 let polls=0;
 const flaky={async start(){return 'op';},async poll(){if(polls++<2)throw err(429,{retryAfter:0});return reading([10,20],30);}};
 await assert.rejects(attach(null,{ocr:flaky}),{status:422,message:/suman 30\.00/},'got past the 429s and read the document');
 assert.equal(polls,3);
 const limited={async start(){throw err(429,{retryAfter:0});},async poll(){}};
 await assert.rejects(attach(null,{ocr:limited,timeoutMs:20}),{status:429,message:/límite de uso/});
 const quota={async start(){throw err(403);},async poll(){}};
 await assert.rejects(attach(null,{ocr:quota}),{status:503,message:/cuota/});
 assert.deepEqual(await records(),[]);
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
 await assert.rejects(asAdmin().segregateMaterial(material),{status:409,message:/ya no cuenta/});
});

test('an Obramat factura de entrega is read from its PDF: its products, without the «YA PAGADO» line, segregate the anticipo payment',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const b=(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-obramat',-60,-60,'2026-10-31','OBRAMAT','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const d=(await q(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES(-60,'Pagar','2026-10-20','008-0010-000001','OBRAMAT') RETURNING id`)).rows[0].id;
 await q("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-60,'Confirmado','2026-10-31')",[b,d]);
 const m=(await asAdmin().classifyMovement({id:b,clase:'materiales',version:(await asAdmin().movements({pageSize:100})).rows.find(x=>x.id===b).version})).materialId;
 // What readObramatPdf returns for a delivery: the goods, and the settlement line apart.
 const line=(n,desc,gross,net)=>({line_number:n,description:desc,product_code:'1000000'+n,quantity:1,gross_amount:gross,net_amount:net,vat_amount:(Number(gross)-Number(net)).toFixed(2),evidence:{origin:'native-pdf-obramat-v1'}});
 const delivery={kind:'delivery',document_number:'008-0010-000002',order_reference:'303468',lines:[line(1,'Puerta',  '36.30','30.00'),line(2,'Tirador','23.70','19.59')],
  settlement_lines:[{line_number:3,description:'YA PAGADO DEL PEDIDO 303468',gross_amount:'-60.00'}]};
 const attachNative=data=>asAdmin().attachDocumentDetail({id:b,documentId:d,content:PDF,ocr:null,readNative:async()=>({data})});
 await assert.rejects(attachNative({...delivery,kind:'advance'}),{status:422,message:/es el anticipo del pedido 303468.*factura de entrega/});
 const res=await attachNative(delivery);
 assert.deepEqual([res.lineas,res.segregado],[2,true]);
 assert.deepEqual((await q("SELECT gross_amount::text g,category FROM ledens.financial_records WHERE document_id=$1 AND source_valid AND status<>'excluded' ORDER BY gross_amount",[d])).rows,
  [{g:'23.70',category:'materials'},{g:'36.30',category:'materials'}]);
 assert.equal((await q('SELECT status FROM ledens.financial_records WHERE material_id=$1',[m])).rows[0].status,'excluded');
 const ev=(await q("SELECT detail FROM ledens.bridge_events WHERE document_id=$1 AND action='detail_attached'",[d])).rows[0].detail;
 assert.deepEqual([ev.source,ev.delivery_document,ev.order_reference],['native-pdf-obramat-v1','008-0010-000002','303468']);
});
