import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {FinanzasService} from '../src/finanzas/service.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// Movimientos conciliados on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,pay,receipt,mat,lines;
const asAdmin=()=>new FinanzasService(pool,admin);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@cc.test','admin','Admin'),('jefe@cc.test','jefe','Jefe') RETURNING id,role")).rows;
 const bank=async(amount,description)=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,$2,$2,'2026-10-10',$3,'EUR','COMPLETED') RETURNING id`,['MOV-'+description,amount,description])).rows[0].id;
 const doc=async(total,tipo,numero)=>(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES($1,$2,'2026-10-08',$3,'Tercero '||$3) RETURNING id`,[total,tipo,numero])).rows[0].id;
 const link=(b,d,amount)=>db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,'Confirmado','2026-10-10')",[b,d,amount]);
 const line=async(d,n,gross,description)=>{const l=(await db.query('INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3) RETURNING id',[d,n,description])).rows[0].id;
  return (await db.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-08',$3,$4,'EUR') RETURNING id`,[l,d,description,gross])).rows[0].id;};
 // A paid supplier invoice with two lines, a reconciled imported material, an incoming invoice, and one not reconciled.
 pay=await doc(-200,'Pagar','F-PAGO');await link(await bank(-200,'Pago ferretería'),pay,-200);
 lines=[await line(pay,1,'120','Azulejos'),await line(pay,2,'80','Montaje')];
 const matDoc=await doc(-50,'Pagar','F-MAT');await link(await bank(-50,'Pago almacén'),matDoc,-50);
 const m=(await db.query("INSERT INTO ledens.material_expenses(total,document_id,description,occurred_on) VALUES(-50,$1,'Cemento','2026-10-08') RETURNING id",[matDoc])).rows[0].id;
 mat=(await db.query('SELECT id FROM ledens.financial_records WHERE material_id=$1',[m])).rows[0].id;
 receipt=await doc(300,'Cobrar','F-COBRO');await link(await bank(300,'Transferencia cliente'),receipt,300);
 await line(receipt,1,'300','Certificación 1');
 await line(await doc(-75,'Pagar','F-SIN-CONCILIAR'),1,'75','Sin conciliar');
});
after(()=>db?.close());
const rowOf=async(id)=>(await asAdmin().reconciled({pageSize:100})).rows.find(r=>r.record_id===id);
const version=async(id)=>(await db.query('SELECT version FROM ledens.financial_records WHERE id=$1',[id])).rows[0].version;
const change=async(id,clase,reason='Revisado con la factura')=>asAdmin().reclassify({recordId:id,clase,version:await version(id),reason});

test('lists every record behind a reconciled movement with its class, direction and movement; nothing unreconciled',async()=>{
 const all=(await asAdmin().reconciled({pageSize:100})).rows;
 assert.deepEqual(all.map(r=>r.concepto).sort(),['Azulejos','Cemento','Certificación 1','Montaje']);
 const az=await rowOf(lines[0]);
 assert.deepEqual([az.clase,az.sentido,az.numerodocumento,az.movimiento,az.fecha_movimiento],['sin_clasificar','pago','F-PAGO','Pago ferretería','2026-10-10']);
 assert.deepEqual([(await rowOf(mat)).clase,(await rowOf(mat)).type],['materiales','material']);
 const cobro=all.find(r=>r.concepto==='Certificación 1');assert.equal(cobro.sentido,'cobro');
 assert.equal((await asAdmin().reconciled({clase:'materiales'})).total,1);
 assert.equal((await asAdmin().reconciled({q:'ferretería'})).total,2);
 await assert.rejects(asAdmin().reconciled({clase:'nada'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).reconciled(),{status:403});
});

test('an invoice line is reclassified, moves tab, and the change is audited with its reason',async()=>{
 const res=await change(lines[0],'trabajadores','Es mano de obra del alicatado');
 assert.deepEqual([res.category,res.clase],['labor','trabajadores']);
 assert.equal((await rowOf(lines[0])).clase,'trabajadores');
 const tab=async(type)=>(await asAdmin().listRecords({type,pageSize:100})).rows.map(r=>r.record_id);
 assert.ok((await tab('trabajador')).includes(lines[0]));assert.ok(!(await tab('material')).includes(lines[0]));
 await change(lines[1],'materiales');
 assert.ok((await tab('material')).includes(lines[1]));
 const ev=(await db.query("SELECT reason,before_value->>'category' b,after_value->>'category' a,actor_id FROM ledens.finance_events WHERE record_id=$1 AND action='reclassified'",[lines[0]])).rows;
 assert.deepEqual(ev,[{reason:'Es mano de obra del alicatado',b:'unclassified',a:'labor',actor_id:admin.id}]);
});

test('the direction and the version guard the change',async()=>{
 await assert.rejects(change(lines[1],'clientes'),{status:409,message:/Un pago/});
 const cobro=(await asAdmin().reconciled({q:'Certificación'})).rows[0].record_id;
 await assert.rejects(change(cobro,'materiales'),{status:409,message:/Un cobro/});
 assert.equal((await change(cobro,'clientes')).category,'revenue');
 await assert.rejects(change(lines[1],'materiales'),{status:409,message:/Ya está/});
 await assert.rejects(asAdmin().reclassify({recordId:lines[1],clase:'trabajadores',version:(await version(lines[1]))-1,reason:'Motivo largo'}),{status:409,message:/ha cambiado/});
 await assert.rejects(change(lines[1],'trabajadores','no'),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).reclassify({recordId:lines[1],clase:'trabajadores',version:await version(lines[1]),reason:'Motivo largo'}),{status:403});
});

test('an imported material reclassified as labor leaves Materiales and can be approved as labor',async()=>{
 await change(mat,'trabajadores');
 const tab=async(type)=>(await asAdmin().listRecords({type,pageSize:100})).rows.map(r=>r.record_id);
 assert.ok(!(await tab('material')).includes(mat));assert.ok((await tab('trabajador')).includes(mat));
 assert.equal((await db.query('SELECT total::text FROM ledens.material_expenses m JOIN ledens.financial_records r ON r.material_id=m.id WHERE r.id=$1',[mat])).rows[0].total,'-50','the imported row is untouched');
 const fin=asAdmin().finance,approve=async(category)=>fin.approve(admin,mat,{version:await version(mat),category,status:'approved',currency:'EUR',net_amount:'50',vat_amount:'0',nondeductible_vat:'0',withholding_amount:'0',recognized_on:'2026-10-08',reason:'Validado tras revisar'});
 await assert.rejects(approve('subcontract'),{message:'source_category_mismatch'});
 assert.equal((await approve('labor')).category,'labor');
});

test('HTTP: the change needs an admin and the allowed origin',async()=>{
 const app=express();app.use(express.json());
 app.use('/api/finanzas',createFinanzasRouter({service:asAdmin(),origin:'https://ledens.test',authenticate:(req,_res,next)=>{req.user=req.get('x-role')==='client'?{id:jefe.id,role:'client'}:{...admin};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/finanzas/conciliados`;
 try{
  const list=await (await fetch(base+'?clase=trabajadores')).json();assert.ok(list.rows.length>=2);
  const put=async(headers)=>fetch(`${base}/${lines[1]}/clasificacion`,{method:'PUT',headers:{'content-type':'application/json',origin:'https://ledens.test',...headers},body:JSON.stringify({clase:'trabajadores',version:await version(lines[1]),reason:'Cambio por HTTP'})});
  assert.equal((await put({origin:'https://evil.test'})).status,403);
  assert.equal((await put({'x-role':'client'})).status,403);
  const ok=await put({});assert.equal(ok.status,200);assert.equal((await ok.json()).category,'labor');
 }finally{server.close();}
});
