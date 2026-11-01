import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
import {bankFingerprint} from '../src/bridge/rules.js';
// Concepto de movimientos on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,m={},lines;
const asAdmin=()=>new FinanzasService(pool,admin);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@mv.test','admin','Admin'),('jefe@mv.test','jefe','Jefe') RETURNING id,role")).rows;
 const bank=async(amount,description,extra='')=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state${extra?',is_internal_transfer':''})
  VALUES($1,$2,$2,'2026-10-10',$3,'EUR','COMPLETED'${extra?',true':''}) RETURNING *`,['MOV-'+description,amount,description])).rows[0];
 const doc=async(total,tipo,numero)=>(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES($1,$2,'2026-10-08',$3,'Tercero '||$3) RETURNING id`,[total,tipo,numero])).rows[0].id;
 const link=(b,d,amount)=>db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,'Confirmado','2026-10-10')",[b,d,amount]);
 const line=async(d,n,gross,description)=>{const l=(await db.query('INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3) RETURNING id',[d,n,description])).rows[0].id;
  return (await db.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-08',$3,$4,'EUR') RETURNING id`,[l,d,description,gross])).rows[0].id;};
 // An Obramat-like invoice (lines unclassified) reconciled with its payment: pending.
 m.obramat=await bank(-200,'Pago Obramat');const inv=await doc(-200,'Pagar','F-OBRAMAT');await link(m.obramat.id,inv,-200);
 lines=[await line(inv,1,'120','Azulejos'),await line(inv,2,'80','Cemento cola')];
 // An imported material with its document reconciled: concluded as materiales through the Bridge.
 m.material=await bank(-50,'Pago almacén');const matDoc=await doc(-50,'Pagar','F-MAT');await link(m.material.id,matDoc,-50);
 await db.query("INSERT INTO ledens.material_expenses(total,document_id,description,occurred_on) VALUES(-50,$1,'Cemento','2026-10-08')",[matDoc]);
 // Movements with no document: a payment, a receipt and a nómina.
 m.pago=await bank(-90,'Pago sin factura');m.cobro=await bank(500,'Transferencia cliente');m.nomina=await bank(-300,'Nómina octubre');
 // A reconciled document without records cannot be concluded.
 m.bare=await bank(-40,'Pago documento vacío');await link(m.bare.id,await doc(-40,'Pagar','F-VACIA'),-40);
 await bank(-1000,'Traspaso','internal');
 m.cash=(await db.query("INSERT INTO ledens.cash_movements(kind,amount,occurred_on,concept) VALUES('pago',30,'2026-10-09','Tornillos') RETURNING *")).rows[0];
});
after(()=>db?.close());
const list=async(f={})=>asAdmin().movements({pageSize:100,...f});
const row=async(id)=>(await list()).rows.find(r=>r.id===id);
const classify=async(id,clase,reason)=>asAdmin().classifyMovement({id,clase,version:(await row(id)).version,reason});

test('every movement appears once with the class concluded from the Bridge, or pending',async()=>{
 const all=await list();
 assert.equal(all.total,7,'internal transfers are left out');
 assert.deepEqual([(await row(m.obramat.id)).clase,(await row(m.obramat.id)).origen,(await row(m.obramat.id)).documentos],['pendiente','bridge','F-OBRAMAT']);
 assert.deepEqual([(await row(m.material.id)).clase,(await row(m.material.id)).origen],['materiales','bridge']);
 for(const id of [m.pago.id,m.cobro.id,m.nomina.id,m.bare.id,m.cash.id])assert.equal((await row(id)).clase,'pendiente');
 assert.deepEqual(all.resumen,{pendiente:6,materiales:1,trabajadores:0,clientes:0,mixto:0});
 assert.equal((await list({clase:'pendiente'})).total,6);
 assert.equal((await list({q:'Obramat'})).total,1);
 await assert.rejects(list({clase:'nada'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).movements(),{status:403});
});

test('classifying a reconciled movement classifies its whole document at once, audited',async()=>{
 const res=await classify(m.obramat.id,'materiales');
 assert.deepEqual([res.via,res.changed],['registros',2]);
 assert.equal((await row(m.obramat.id)).clase,'materiales');
 const pending=(await asAdmin().listRecords({type:'material',pending:true,pageSize:100})).rows.map(r=>r.concepto).sort();
 assert.deepEqual(pending,['Azulejos','Cemento','Cemento cola']);
 const ev=(await db.query("SELECT reason FROM ledens.finance_events WHERE record_id=ANY($1::uuid[]) AND action='reclassified'",[lines])).rows;
 assert.equal(ev.length,2);
 await assert.rejects(classify(m.obramat.id,'trabajadores'),{status:400,message:/motivo/});
 await assert.rejects(classify(m.obramat.id,'materiales'),{status:409,message:/Ya está/});
 const stale=(await row(m.obramat.id)).version;
 assert.equal((await classify(m.obramat.id,'trabajadores','Era la factura del alicatador')).clase,'trabajadores');
 await assert.rejects(asAdmin().classifyMovement({id:m.obramat.id,clase:'materiales',version:stale,reason:'Otra vez'}),{status:409,message:/ha cambiado/});
});

test('a movement without documents enters through the usual flow for its class',async()=>{
 assert.equal((await classify(m.pago.id,'materiales')).via,'material');
 assert.equal((await row(m.pago.id)).clase,'materiales');
 assert.equal((await db.query('SELECT total::text FROM ledens.material_expenses WHERE bank_movement_id=$1',[m.pago.id])).rows[0].total,'-90.00');
 assert.equal((await classify(m.cobro.id,'clientes')).via,'cobro-cliente');
 assert.equal((await row(m.cobro.id)).clase,'clientes');
 assert.equal((await classify(m.nomina.id,'trabajadores')).via,'pendiente-trabajador');
 assert.equal((await row(m.nomina.id)).clase,'trabajadores');
 await assert.rejects(classify(m.nomina.id,'materiales'),{status:409,message:/Pendiente de trabajador/});
 assert.equal((await classify(m.cash.id,'materiales')).via,'efectivo');
 assert.equal((await row(m.cash.id)).clase,'materiales');
 assert.equal((await list()).resumen.pendiente,1);
});

test('direction, documents without records and roles guard the classification',async()=>{
 await assert.rejects(classify(m.bare.id,'materiales'),{status:409,message:/F-VACIA/});
 await assert.rejects(classify(m.bare.id,'clientes'),{status:409,message:/Un pago/});
 await assert.rejects(classify(m.cobro.id,'materiales'),{status:409,message:/Un cobro/});
 await assert.rejects(new FinanzasService(pool,jefe).classifyMovement({id:m.bare.id,clase:'materiales',version:(await row(m.bare.id)).version}),{status:403});
});

test('Pendiente de conciliación carries what «Asignar documento» needs for each bank movement',async()=>{
 const r=(await asAdmin().reconciliation({pageSize:100})).rows.find(x=>x.id===m.pago.id);
 const b=(await db.query('SELECT * FROM ledens.bank_movements WHERE id=$1',[m.pago.id])).rows[0];
 assert.deepEqual(r.bank,{id:b.id,description:'Pago sin factura',reference:null,total_amount:'-90',remaining:r.por_conciliar,state:'COMPLETED',currency:'EUR',bank_fingerprint:bankFingerprint(b)});
});
