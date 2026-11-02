import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
import {bankFingerprint} from '../src/bridge/rules.js';
// Conceptos de facturas as whole invoices, Materiales pendiente de asignación and
// the Bridge data of Pendiente de conciliación, on PGlite with synthetic rows only.
let db,pool,admin,jefe,pay,receipt,lines,loose;
const asAdmin=()=>new FinanzasService(pool,admin);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@fa.test','admin','Admin'),('jefe@fa.test','jefe','Jefe') RETURNING id,role")).rows;
 const doc=async(total,tipo,numero)=>(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES($1,$2,'2026-10-08',$3,'Tercero '||$3) RETURNING id`,[total,tipo,numero])).rows[0].id;
 const line=async(d,n,gross,description)=>{const l=(await db.query('INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3) RETURNING id',[d,n,description])).rows[0].id;
  return (await db.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-08',$3,$4,'EUR') RETURNING id`,[l,d,description,gross])).rows[0].id;};
 pay=await doc(-200,'Pagar','F-PAGO');lines=[await line(pay,1,'120','Azulejos'),await line(pay,2,'80','Montaje')];
 receipt=await doc(300,'Cobrar','F-COBRO');await line(receipt,1,'300','Certificación 1');
 // An imported material is not an invoice concept: it never appears as an invoice to classify.
 const matDoc=await doc(-50,'Pagar','F-MAT');
 await db.query("INSERT INTO ledens.material_expenses(total,document_id,description,occurred_on) VALUES(-50,$1,'Cemento','2026-10-08')",[matDoc]);
 loose=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-1',-90,-90,'2026-10-10','Pago sin factura','EUR','COMPLETED') RETURNING *`)).rows[0];
});
after(()=>db?.close());
const invoice=async(numero)=>(await asAdmin().invoices({pageSize:100})).rows.find(r=>r.numerodocumento===numero);
const classify=async(numero,clase,reason)=>{const r=await invoice(numero);return asAdmin().classifyInvoice({documentId:r.id,clase,version:r.version,reason});};
const materialPending=async()=>(await asAdmin().listRecords({type:'material',pending:true,pageSize:100})).rows.map(r=>r.concepto).sort();

test('lists whole invoices of invoice concepts, one row each, with their lines and class',async()=>{
 const all=(await asAdmin().invoices({pageSize:100})).rows;
 assert.deepEqual(all.map(r=>r.numerodocumento).sort(),['F-COBRO','F-PAGO']);
 const p=await invoice('F-PAGO');
 assert.deepEqual([p.lineas,p.clase,p.sentido,p.conceptos],[2,'sin_clasificar','pago','Azulejos · Montaje']);
 assert.equal((await asAdmin().invoices({clase:'sin_clasificar'})).total,2);
 assert.equal((await asAdmin().invoices({q:'Montaje'})).total,1);
 await assert.rejects(asAdmin().invoices({clase:'nada'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).invoices(),{status:403});
});

test('classifying the invoice changes every line, audited, and only materials wait in Materiales pendiente de asignación',async()=>{
 assert.deepEqual(await materialPending(),['Cemento']);
 const res=await classify('F-PAGO','materiales');
 assert.deepEqual([res.changed,res.lineas,res.category],[2,2,'materials']);
 assert.equal((await invoice('F-PAGO')).clase,'materiales');
 assert.deepEqual(await materialPending(),['Azulejos','Cemento','Montaje']);
 assert.equal((await asAdmin().pendingSummary()).materiales.pendientes,3);
 const ev=(await db.query("SELECT reason FROM ledens.finance_events WHERE record_id=ANY($1::uuid[]) AND action='reclassified'",[lines])).rows;
 assert.deepEqual(ev.map(e=>e.reason),['Clasificación de la factura completa','Clasificación de la factura completa']);
 // A receipt classified as clientes is not a material.
 await classify('F-COBRO','clientes');
 assert.deepEqual(await materialPending(),['Azulejos','Cemento','Montaje']);
});

test('the direction, the version and a reason for a change guard the classification',async()=>{
 await assert.rejects(classify('F-PAGO','clientes'),{status:409,message:/pago/});
 await assert.rejects(classify('F-COBRO','materiales'),{status:409,message:/cobro/});
 await assert.rejects(classify('F-PAGO','materiales'),{status:409,message:/ya está/});
 await assert.rejects(classify('F-PAGO','trabajadores'),{status:400,message:/motivo/});
 const stale=await invoice('F-PAGO');
 assert.equal((await classify('F-PAGO','trabajadores','Es mano de obra')).category,'labor');
 await assert.rejects(asAdmin().classifyInvoice({documentId:stale.id,clase:'materiales',version:stale.version,reason:'Otra vez material'}),{status:409,message:/ha cambiado/});
 assert.deepEqual(await materialPending(),['Cemento']);
 await assert.rejects(new FinanzasService(pool,jefe).classifyInvoice({documentId:stale.id,clase:'materiales',version:stale.version}),{status:403});
});

test('a receipt can be a supplier refund: a material that lowers costs, never on a payment',async()=>{
 const d=(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES(45,'Cobrar','2026-10-09','F-ABONO','Proveedor') RETURNING id`)).rows[0].id;
 const l=(await db.query("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,1,'Abono azulejos') RETURNING id",[d])).rows[0].id;
 await db.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-09','Abono azulejos',45,'EUR')`,[l,d]);
 await assert.rejects(classify('F-PAGO','reembolso_proveedor','No es un cobro'),{status:409,message:/reembolso/});
 const res=await classify('F-ABONO','reembolso_proveedor');
 assert.deepEqual([res.category,res.clase],['materials','reembolso_proveedor']);
 const row=await invoice('F-ABONO');
 assert.equal(row.clase,'reembolso_proveedor');
 assert.equal((await asAdmin().invoices({clase:'reembolso_proveedor'})).total,1);
 assert.ok((await materialPending()).includes('Abono azulejos'));
 assert.equal((await classify('F-ABONO','clientes','Era un cobro de cliente')).category,'revenue');
});

test('Pendiente de conciliación carries what «Asignar documento» needs for each bank movement',async()=>{
 const row=(await asAdmin().reconciliation({pageSize:100})).rows.find(r=>r.id===loose.id);
 assert.deepEqual(row.bank,{id:loose.id,description:'Pago sin factura',reference:null,total_amount:'-90',remaining:row.por_conciliar,state:'COMPLETED',currency:'EUR',bank_fingerprint:bankFingerprint(loose)});
 assert.equal(Number(row.bank.remaining),-90);
});
