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
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql','026_materiales_provisionales.sql','029_provisional_todas_las_facturas.sql','027_transferencias_internas.sql','028_treasury_movements.sql','030_efectivo_importado.sql'])
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
const movOf=async(doc)=>(await asAdmin().reconciled({pageSize:100})).rows.find(r=>r.documentos===doc);
const version=async(id)=>(await db.query('SELECT version FROM ledens.financial_records WHERE id=$1',[id])).rows[0].version;
const change=async(id,clase,reason='Revisado con la factura')=>asAdmin().reclassify({recordId:id,clase,version:await version(id),reason});

test('one row per reconciled movement with its documents and class, never split into concepts; nothing unreconciled',async()=>{
 const {rows,total,resumen}=await asAdmin().reconciled({pageSize:100});
 assert.equal(total,3);
 assert.deepEqual(rows.map(r=>r.documentos).sort(),['F-COBRO','F-MAT','F-PAGO']);
 const pago=await movOf('F-PAGO');
 assert.deepEqual([pago.concepto,pago.fecha,pago.importe,pago.sentido,pago.registros,pago.origin],['Pago ferretería','2026-10-10','-200','pago',2,'bank_movements']);
 assert.equal((await movOf('F-MAT')).clase,'materiales');
 assert.equal((await movOf('F-COBRO')).sentido,'cobro');
 assert.equal((await asAdmin().reconciled({clase:'materiales'})).total,1);
 assert.equal((await asAdmin().reconciled({q:'ferretería'})).total,1);
 await assert.rejects(asAdmin().reconciled({clase:'nada'}),{status:400});
 await assert.rejects(asAdmin().reconciled({proyecto:'nada'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).reconciled(),{status:403});
 // None is assigned to a project yet: every one is flagged.
 assert.deepEqual(rows.map(r=>r.proyecto_estado),['sin_proyecto','sin_proyecto','sin_proyecto']);
 assert.deepEqual(resumen,{movimientos:3,sin_proyecto:3});
});

test('every reconciled movement has to be assigned to a project: partial and full assignment',async()=>{
 const p=(await db.query("INSERT INTO ledens.projects(project_id,name) VALUES('P2026-001','Reforma Centro') RETURNING id")).rows[0].id;
 const alloc=(record,amount)=>db.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES($1,$2,$3)',[record,p,amount]);
 await alloc(lines[0],120);
 const parcial=await movOf('F-PAGO');
 assert.deepEqual([parcial.proyecto_estado,parcial.sin_proyecto,parcial.proyectos],['parcial',1,['P2026-001 · Reforma Centro']]);
 await alloc(lines[1],80);
 const asignado=await movOf('F-PAGO');
 assert.deepEqual([asignado.proyecto_estado,asignado.sin_proyecto],['asignado',0]);
 const {resumen}=await asAdmin().reconciled();assert.deepEqual(resumen,{movimientos:3,sin_proyecto:2});
 assert.deepEqual((await asAdmin().reconciled({proyecto:'asignado'})).rows.map(r=>r.documentos),['F-PAGO']);
 assert.equal((await asAdmin().reconciled({proyecto:'sin_proyecto'})).total,2);
 assert.equal((await asAdmin().reconciled({q:'Reforma Centro'})).total,1);
 await db.query('DELETE FROM ledens.project_financial_allocations WHERE project_id=$1',[p]);
});

test('an invoice line is reclassified, moves tab, and the change is audited with its reason',async()=>{
 const res=await change(lines[0],'trabajadores','Es mano de obra del alicatado');
 assert.deepEqual([res.category,res.clase],['labor','trabajadores']);
 // The movement keeps one row: with a concept still unclassified it stays pending.
 assert.equal((await movOf('F-PAGO')).clase,'pendiente');
 const tab=async(type)=>(await asAdmin().listRecords({type,pageSize:100})).rows.map(r=>r.record_id);
 assert.ok((await tab('trabajador')).includes(lines[0]));assert.ok(!(await tab('material')).includes(lines[0]));
 await change(lines[1],'materiales');
 assert.ok((await tab('material')).includes(lines[1]));
 assert.equal((await movOf('F-PAGO')).clase,'mixto');
 const ev=(await db.query("SELECT reason,before_value->>'category' b,after_value->>'category' a,actor_id FROM ledens.finance_events WHERE record_id=$1 AND action='reclassified'",[lines[0]])).rows;
 assert.deepEqual(ev,[{reason:'Es mano de obra del alicatado',b:'unclassified',a:'labor',actor_id:admin.id}]);
});

test('the direction and the version guard the change',async()=>{
 await assert.rejects(change(lines[1],'clientes'),{status:409,message:/Un pago/});
 const cobro=(await db.query("SELECT id FROM ledens.financial_records WHERE description='Certificación 1'")).rows[0].id;
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
  const list=await (await fetch(base+'?proyecto=sin_proyecto')).json();assert.ok(list.rows.length>=1);
  const put=async(headers)=>fetch(`${base}/${lines[1]}/clasificacion`,{method:'PUT',headers:{'content-type':'application/json',origin:'https://ledens.test',...headers},body:JSON.stringify({clase:'trabajadores',version:await version(lines[1]),reason:'Cambio por HTTP'})});
  assert.equal((await put({origin:'https://evil.test'})).status,403);
  assert.equal((await put({'x-role':'client'})).status,403);
  const ok=await put({});assert.equal(ok.status,200);assert.equal((await ok.json()).category,'labor');
 }finally{server.close();}
});
