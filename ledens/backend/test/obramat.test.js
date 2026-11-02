import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
// «Regla Obramat» and supplier refunds whose credit note has concepts, in
// Concepto de movimientos, on PGlite with synthetic rows only.
let db,pool,admin,m={};
const asAdmin=()=>new FinanzasService(pool,admin);
const system=()=>new FinanzasService(pool,{role:'admin',id:null});
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','011_transaction_alerts.sql','012_bridge_party_amount_date.sql','013_pago_trabajadores.sql','016_cash_movements.sql','014_purchase_settlements.sql','026_materiales_provisionales.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 admin=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@ob.test','admin','Admin') RETURNING id,role")).rows[0];
 const bank=async(amount,description)=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,$2,$2,'2026-10-22',$3,'EUR','COMPLETED') RETURNING id`,['MOV-'+description,amount,description])).rows[0].id;
 const doc=async(total,tipo,numero,tercero,nif=null)=>(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero) VALUES($1,$2,'2026-10-20',$3,$4,$5) RETURNING id`,[total,tipo,numero,tercero,nif])).rows[0].id;
 const link=(b,d,amount)=>db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,'Confirmado','2026-10-22')",[b,d,amount]);
 const line=async(d,n,gross,description,category='unclassified')=>{const l=(await db.query('INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3) RETURNING id',[d,n,description])).rows[0].id;
  return (await db.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency,category) VALUES($1,$2,'2026-10-20',$3,$4,'EUR',$5) RETURNING id`,[l,d,description,gross,category])).rows[0].id;};
 // Obramat purchase with its invoice lines (OCR): a payment.
 m.compra=await bank(-50,'ADEO OBRAMAT SPAIN compra');m.compraDoc=await doc(-50,'Pagar','008-0010-100','OBRAMAT');await link(m.compra,m.compraDoc,-50);
 m.compraLines=[await line(m.compraDoc,1,'30','Azulejo'),await line(m.compraDoc,2,'20','Cemento cola')];
 // Obramat refund with its credit note (a rectificativa read by OCR: Cobrar, concepts unclassified).
 m.refund=await bank(10,'Refund from Adeo Obramat Spain');m.note=await doc(10,'Cobrar','008-0010-R279622','OBRAMAT','B-84406289');await link(m.refund,m.note,10);
 m.noteLine=await line(m.note,1,'10','Devolución tornillos');
 // Obramat advance (native, 014): no records of its own, its cost comes with the delivery.
 m.anticipo=await bank(-100,'Pago tarjeta tienda 302957');m.anticipoDoc=await doc(-100,'Pagar','008-0010-459065','OBRAMAT');await link(m.anticipo,m.anticipoDoc,-100);
 await db.query("INSERT INTO ledens.purchase_documents(document_id,kind,issuer_tax_id,buyer_tax_id,document_number,order_reference,currency,issued_on,nominal_gross,goods_gross,goods_net,goods_vat,applied_gross,fingerprint,evidence) VALUES($1,'advance','B84406289','B19753805','008-0010-459065','302957','EUR','2026-10-20',100,0,0,0,0,'fp-anticipo','{}')",[m.anticipoDoc]);
 // Obramat payment without any document yet.
 m.suelto=await bank(-25,'BRICOMAN pago');
 // Another supplier's refund whose credit note has concepts, and one already classified.
 m.otro=await bank(15,'Devolución Leroy');m.otroDoc=await doc(15,'Cobrar','LM-ABONO','Leroy Merlin');await link(m.otro,m.otroDoc,15);await line(m.otroDoc,1,'15','Abono');
 m.cliente=await bank(200,'Transferencia');m.clienteDoc=await doc(200,'Cobrar','F-CLI','Cliente');await link(m.cliente,m.clienteDoc,200);await line(m.clienteDoc,1,'200','Certificación','revenue');
 m.descuadre=await bank(30,'Devolución descuadrada');m.descuadreDoc=await doc(30,'Cobrar','AB-30','Proveedor');await link(m.descuadre,m.descuadreDoc,30);await line(m.descuadreDoc,1,'25','Abono parcial');
});
after(()=>db?.close());
const rows=async()=>(await asAdmin().movements({pageSize:100})).rows;
const row=async(id)=>(await rows()).find(r=>r.id===id);
const classify=async(id,clase,reason)=>asAdmin().classifyMovement({id,clase,version:(await row(id)).version,reason});

test('Obramat movements are flagged; a native advance is materials as is, never recorded again',async()=>{
 for(const id of [m.compra,m.refund,m.anticipo,m.suelto])assert.equal((await row(id)).obramat,true);
 assert.equal((await row(m.otro)).obramat,false);
 assert.deepEqual([(await row(m.anticipo)).clase,(await row(m.anticipo)).origen],['materiales','compra_obramat']);
 await assert.rejects(classify(m.anticipo,'materiales'),{status:409,message:/compra de Obramat con anticipo/});
 await assert.rejects(classify(m.compra,'trabajadores'),{status:409,message:/Obramat siempre son pagos de materiales/});
 await assert.rejects(classify(m.refund,'clientes'),{status:409,message:/Obramat siempre son pagos de materiales/});
});

test('a refund whose credit note has concepts is registered once, from the movement, and the credit note concepts are excluded',async()=>{
 await assert.rejects(classify(m.cliente,'reembolso_proveedor'),{status:409,message:/ya clasificados/});
 await assert.rejects(classify(m.descuadre,'reembolso_proveedor'),{status:409,message:/suman 25\.00 € y el cobro 30\.00 €/});
 const res=await classify(m.otro,'reembolso_proveedor');
 assert.equal(res.via,'material');
 assert.deepEqual([(await row(m.otro)).clase,(await row(m.otro)).origen],['reembolso_proveedor','registro']);
 const live=(await db.query("SELECT gross_amount::text g,material_id IS NOT NULL mat FROM ledens.financial_records WHERE (document_id=$1 OR bank_movement_id=$2) AND source_valid AND status<>'excluded'",[m.otroDoc,m.otro])).rows;
 assert.deepEqual(live,[{g:'-15.00',mat:true}],'only the refund counts, lowering the cost');
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.finance_events e JOIN ledens.financial_records r ON r.id=e.record_id WHERE r.document_id=$1 AND e.action='refund_replaced'",[m.otroDoc])).rows[0].n,1);
});

test('«Regla Obramat» classifies every pending, reconciled Obramat movement as materials, as the system',async()=>{
 const before=(await rows()).filter(r=>r.obramat&&r.clase==='pendiente').map(r=>r.id).sort();
 assert.deepEqual(before,[m.compra,m.refund,m.suelto].sort());
 const res=await system().applyObramatRule();
 assert.deepEqual([res.evaluados,res.clasificados,res.errores],[2,2,0]);
 // Without a reconciled document it waits: it could still turn out to be a native advance.
 assert.equal((await row(m.suelto)).clase,'pendiente');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.material_expenses WHERE bank_movement_id=$1',[m.suelto])).rows[0].n,0);
 await classify(m.suelto,'materiales');
 assert.equal((await row(m.compra)).clase,'materiales');
 assert.deepEqual((await db.query('SELECT category FROM ledens.financial_records WHERE id=ANY($1::uuid[])',[m.compraLines])).rows.map(r=>r.category),['materials','materials']);
 assert.deepEqual([(await row(m.refund)).clase,(await row(m.suelto)).clase,(await row(m.suelto)).origen],['reembolso_proveedor','materiales','provisional']);
 assert.equal((await db.query('SELECT status FROM ledens.financial_records WHERE id=$1',[m.noteLine])).rows[0].status,'excluded');
 assert.equal((await db.query("SELECT r.gross_amount::text g FROM ledens.material_expenses x JOIN ledens.financial_records r ON r.material_id=x.id WHERE x.bank_movement_id=$1",[m.refund])).rows[0].g,'-10.00');
 const ev=(await db.query("SELECT actor_id,reason FROM ledens.finance_events WHERE record_id=$1 AND action='reclassified'",[m.compraLines[0]])).rows[0];
 assert.deepEqual([ev.actor_id,/Regla Obramat/.test(ev.reason)],[null,true]);
 assert.deepEqual([(await system().applyObramatRule()).evaluados],[0],'nothing left: running it again changes nothing');
 assert.equal((await asAdmin().movementsPending()).pendientes,(await rows()).filter(r=>r.clase==='pendiente').length);
});
