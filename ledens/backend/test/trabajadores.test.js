import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {WorkersService} from '../src/finanzas/workers.js';
import {FinanzasService} from '../src/finanzas/service.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// Trabajadores on PGlite: the shared finance fixture plus the production columns
// of ledens.employees. Synthetic rows only.
let db,pool,admin,jefe,client,oficial,peon,legacy;
const as=(u)=>new WorkersService(pool,u);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text; ALTER TABLE audit_log ADD COLUMN target_label text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`ALTER TABLE ledens.employees ADD COLUMN source_id text UNIQUE,ADD COLUMN raw_id uuid UNIQUE,ADD COLUMN empleadoid text,ADD COLUMN daily_pay numeric,
  ADD COLUMN tipo text,ADD COLUMN horasjornada numeric,ADD COLUMN user_id uuid REFERENCES users(id),ADD CHECK ((source_id IS NULL)=(raw_id IS NULL))`);
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@tr.test','admin','Admin Test'),('jefe@tr.test','jefe','Jefe Test') RETURNING id,role,name")).rows;
 client={id:jefe.id,role:'client'};
 [oficial,peon]=(await db.query("INSERT INTO ledens.positions(name,activo) VALUES('Oficial 1ª',true),('Peón',true) RETURNING id")).rows.map(r=>r.id);
 legacy=(await db.query("INSERT INTO ledens.employees(name,empleadoid,primary_position_id,activo,daily_pay,source_id,raw_id) VALUES('Importado Uno','EMP-001',$1,true,95,'legacy-e1',gen_random_uuid()) RETURNING id",[oficial])).rows[0].id;
});
after(()=>db?.close());

test('an admin registers a worker with the real fields; the change is audited',async()=>{
 const w=await as(admin).create({name:'Trabajador Nuevo',code:' EMP-010 ',positionId:peon,tipo:'Fijo',dailyPay:'85,50',hours:'8'});
 assert.equal(w.name,'Trabajador Nuevo');assert.equal(w.code,'EMP-010');assert.equal(w.puesto,'Peón');assert.equal(w.tipo,'Fijo');
 assert.equal(Number(w.daily_pay),85.5);assert.equal(Number(w.hours),8);assert.equal(w.activo,true);assert.equal(w.importado,false);assert.equal(w.pagos,0);
 const a=(await db.query("SELECT actor_label,detail FROM audit_log WHERE action='Trabajador dado de alta' ORDER BY id DESC LIMIT 1")).rows[0];
 assert.equal(a.actor_label,'Admin Test');assert.equal(a.detail,'Trabajador Nuevo · Peón (EMP-010)');
});

test('validation: name required, unique code (any case), sane pay and hours, real position',async()=>{
 await assert.rejects(as(admin).create({name:' '}),{status:400,message:/nombre/});
 await assert.rejects(as(admin).create({name:'X',code:'emp-001'}),{status:409,message:/Importado Uno/});
 await assert.rejects(as(admin).create({name:'X',dailyPay:'-10'}),{status:400,message:/Pago diario/});
 await assert.rejects(as(admin).create({name:'X',dailyPay:'10.123'}),{status:400});
 await assert.rejects(as(admin).create({name:'X',hours:'25'}),{status:400,message:/Horas/});
 await assert.rejects(as(admin).create({name:'X',positionId:'00000000-0000-0000-0000-000000000000'}),{status:400,message:/Puesto/});
});

test('editing checks the version and audits only real changes (85.5 equals 85.50)',async()=>{
 const w=(await as(admin).list({q:'EMP-010'})).rows[0];
 const same=await as(admin).update(w.id,{...form(w),dailyPay:'85.50',version:w.version});assert.equal(same.changed,false);
 const u=await as(admin).update(w.id,{...form(w),positionId:oficial,dailyPay:'95',version:w.version});
 assert.equal(u.changed,true);assert.equal(u.puesto,'Oficial 1ª');assert.equal(Number(u.daily_pay),95);
 const a=(await db.query("SELECT detail FROM audit_log WHERE action='Trabajador editado' ORDER BY id DESC LIMIT 1")).rows[0].detail;
 assert.equal(a,'Puesto: Peón → Oficial 1ª · Pago diario: 85.50 → 95');
 await assert.rejects(as(admin).update(w.id,{...form(w),name:'Pisado',version:w.version}),{status:409});
 await assert.rejects(as(admin).update(u.id,{...form(u),code:'EMP-001',version:u.version}),{status:409});
});

test('baja keeps the worker and its payments, hides it from new payments, and can be undone',async()=>{
 let w=(await as(admin).list({q:'EMP-010'})).rows[0];
 await db.query("INSERT INTO ledens.worker_payments(amount,occurred_on,employee_id,empleado) VALUES(-60,'2026-09-01',$1,$2)",[w.id,w.name]);
 w=await as(admin).setActive(w.id,{activo:false,version:w.version,reason:'Fin de contrato'});
 assert.equal(w.activo,false);assert.equal(w.pagos,1,'payments stay with the worker');
 assert.ok(!(await as(admin).list()).rows.some(r=>r.id===w.id),'default list shows active workers');
 assert.ok((await as(admin).list({estado:'bajas'})).rows.some(r=>r.id===w.id));
 assert.ok(!(await new FinanzasService(pool,admin).employees()).some(e=>e.id===w.id),'not offered in Pendiente de trabajador');
 assert.match((await db.query("SELECT detail FROM audit_log WHERE action='Trabajador dado de baja' ORDER BY id DESC LIMIT 1")).rows[0].detail,/Fin de contrato/);
 await assert.rejects(as(admin).setActive(w.id,{activo:true,version:'old'}),{status:409});
 w=await as(admin).setActive(w.id,{activo:true,version:w.version});assert.equal(w.activo,true);
 assert.ok((await new FinanzasService(pool,admin).employees()).some(e=>e.id===w.id));
});

test('imported workers are flagged and editable without touching their provenance',async()=>{
 const w=(await as(admin).list({q:'EMP-001'})).rows[0];assert.equal(w.importado,true);
 await as(admin).update(legacy,{...form(w),tipo:'Autónomo',version:w.version});
 assert.deepEqual((await db.query('SELECT source_id,tipo FROM ledens.employees WHERE id=$1',[legacy])).rows[0],{source_id:'legacy-e1',tipo:'Autónomo'});
});

test('jefes see workers without pay and cannot change them; clients see nothing',async()=>{
 const l=await as(jefe).list({estado:'todos'});
 assert.ok(l.rows.length>=2);assert.ok(l.rows.every(r=>r.daily_pay===null),'pay hidden');assert.equal(l.canEdit,false);
 const w=l.rows[0];
 await assert.rejects(as(jefe).create({name:'X'}),{status:403});
 await assert.rejects(as(jefe).update(w.id,{...form(w),version:w.version}),{status:403});
 await assert.rejects(as(jefe).setActive(w.id,{activo:false,version:w.version}),{status:403});
 await assert.rejects(as(client).list(),{status:403});
 assert.ok((await as(admin).list({estado:'todos'})).rows.some(r=>r.daily_pay!==null),'admins do get pay');
});

test('filters by text, status and position; options list active positions',async()=>{
 assert.ok((await as(admin).list({q:'importado',estado:'todos'})).rows.every(r=>/Importado/.test(r.name)));
 assert.ok((await as(admin).list({puesto:oficial,estado:'todos'})).rows.every(r=>r.puesto==='Oficial 1ª'));
 await assert.rejects(as(admin).list({estado:'x'}),{status:400});
 assert.deepEqual((await as(admin).options()).positions.map(p=>p.name),['Oficial 1ª','Peón']);
});

test('HTTP: writes need the allowed origin and an admin',async()=>{
 const app=express();app.use(express.json());
 app.use('/api/finanzas',createFinanzasRouter({service:{},workers:as(admin),origin:'https://ledens.test',authenticate:(req,_res,next)=>{req.user=req.get('x-role')==='client'?client:admin;next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/finanzas/gestion-trabajadores`;
 try{
  const post=(headers)=>fetch(base,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({name:'Desde HTTP',code:'HTTP-W1'})});
  assert.equal((await post({origin:'https://evil.test'})).status,403);
  assert.equal((await post({origin:'https://ledens.test','x-role':'client'})).status,403);
  const ok=await post({origin:'https://ledens.test'});assert.equal(ok.status,201);const {worker}=await ok.json();
  const off=await fetch(`${base}/${worker.id}/estado`,{method:'PUT',headers:{'content-type':'application/json',origin:'https://ledens.test'},body:JSON.stringify({activo:false,version:worker.version})});
  assert.equal(off.status,200);assert.equal((await off.json()).worker.activo,false);
 }finally{server.close();}
});

test('a worker reloads by id, with the pay hidden from jefes',async()=>{
 const w=await as(admin).create({name:'Recarga Trabajador',code:'RW-1',dailyPay:'70'});
 await as(admin).update(w.id,{...form(w),code:'RW-2',version:w.version});
 assert.equal((await as(admin).one(w.id)).code,'RW-2');assert.equal(Number((await as(admin).one(w.id)).daily_pay),70);
 assert.equal((await as(jefe).one(w.id)).daily_pay,null);
 await assert.rejects(as(client).one(w.id),{status:403});
});

function form(w){return {code:w.code,name:w.name,positionId:w.position_id,tipo:w.tipo,dailyPay:w.daily_pay,hours:w.hours};}
