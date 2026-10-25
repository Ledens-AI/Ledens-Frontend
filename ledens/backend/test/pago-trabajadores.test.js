import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {FinanzasService,splitWorkerPayment} from '../src/finanzas/service.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// Pago a trabajadores on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,p1,p2,oficial,ayudante,emp1,emp2;
const asAdmin=()=>new FinanzasService(pool,admin),asJefe=()=>new FinanzasService(pool,jefe);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@pt.test','admin','Admin'),('jefe@pt.test','jefe','Jefe') RETURNING id,role")).rows;
 [p1,p2]=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Marbella','OBRA-001'),('Velez','OBRA-002') RETURNING id")).rows.map(x=>x.id);
 [oficial,ayudante]=(await db.query("INSERT INTO ledens.positions(name) VALUES('Oficial 1ª'),('Peón') RETURNING id")).rows.map(x=>x.id);
 [emp1,emp2]=(await db.query('INSERT INTO ledens.employees(name,primary_position_id,activo) VALUES($1,$2,true),($3,$4,true) RETURNING id',['Trabajador Uno',oficial,'Trabajador Dos',ayudante])).rows.map(x=>x.id);
});
after(()=>db?.close());
const movement=async(amount,extra={})=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,beneficiary_name,currency,state)
 VALUES($1,$2,$2,$3,'Transferencia nómina','Trabajador Uno','EUR','COMPLETED') RETURNING id`,[extra.source||'MOV-'+Math.random().toString(36).slice(2,8),amount,extra.date||'2026-09-15'])).rows[0].id;
const inInbox=async(id)=>(await asAdmin().reconciliation({view:'movimientos',pageSize:100})).rows.some(r=>r.id===id);

test('amounts above 450 € become Oficial lines of 100 €, the rest Ayudante lines of 60 €, remainder last',()=>{
 const euros=x=>({role:x.role,lines:x.lines.map(c=>Number(c)/100)});
 assert.deepEqual(euros(splitWorkerPayment(110000n)),{role:'oficial',lines:Array(11).fill(100)});
 assert.deepEqual(euros(splitWorkerPayment(36000n)),{role:'ayudante',lines:Array(6).fill(60)});
 assert.deepEqual(euros(splitWorkerPayment(115000n)),{role:'oficial',lines:[...Array(11).fill(100),50]});
 assert.deepEqual(euros(splitWorkerPayment(37000n)),{role:'ayudante',lines:[...Array(6).fill(60),10]});
 assert.deepEqual(euros(splitWorkerPayment(45000n)),{role:'ayudante',lines:[...Array(7).fill(60),30]},'exactly 450 € is Ayudante');
 assert.deepEqual(euros(splitWorkerPayment(45001n)),{role:'oficial',lines:[100,100,100,100,50.01]});
 assert.deepEqual(euros(splitWorkerPayment(4000n)),{role:'ayudante',lines:[40]});
 assert.throws(()=>splitWorkerPayment(2000100n),{status:409});
});

test('classifying a payment moves it from Pendiente de conciliación to Pendiente de trabajador',async()=>{
 const m=await movement('-1100.00',{source:'3T2026-901'});
 assert.equal(await inInbox(m),true);
 await assert.rejects(asJefe().classifyWorkerPayments({movementIds:[m]}),{status:403});
 const res=await asAdmin().classifyWorkerPayments({movementIds:[m]});
 assert.deepEqual([res.ok,res.failed,res.results[0].role,res.results[0].lines],[1,0,'oficial',11]);
 assert.equal(await inInbox(m),false,'it leaves the reconciliation inbox');
 const q=await asAdmin().workerQueue();
 const b=q.rows.find(r=>r.bank_movement_id===m);
 assert.equal(b.lines.length,11);assert.ok(b.lines.every(l=>Number(l.amount)===100&&l.role==='oficial'));
 assert.equal(b.source_id,'3T2026-901');assert.equal(String(b.total_amount),'1100.00');
 const again=await asAdmin().classifyWorkerPayments({movementIds:[m]});
 assert.match(again.results[0].error,/Ya está/);
});

test('only outgoing euro movements without another use can be classified, and each one alone',async()=>{
 const incoming=await movement('500.00'),ok=await movement('-360.00');
 const res=await asAdmin().classifyWorkerPayments({movementIds:[incoming,ok]});
 assert.deepEqual(res.results.map(r=>r.ok),[false,true]);assert.match(res.results[0].error,/pagos salientes/);
 assert.equal(res.results[1].role,'ayudante');assert.equal(res.results[1].lines,6);
 assert.equal(await inInbox(incoming),true,'the refused one stays in the inbox');
});

test('saving lines creates worker payments with the movement date, worker and project; the rest stay pending',async()=>{
 const m=await movement('-360.00',{date:'2026-08-20',source:'3T2026-902'});
 await asAdmin().classifyWorkerPayments({movementIds:[m]});
 let b=(await asAdmin().workerQueue()).rows.find(r=>r.bank_movement_id===m);
 const [l1,l2]=b.lines;
 const res=await asAdmin().saveWorkerSplits({items:[{splitId:l1.id,employeeId:emp2,projectId:p1},{splitId:l2.id,employeeId:emp2,projectId:p2}]});
 assert.equal(res.ok,2);
 const w=(await db.query("SELECT amount::text,occurred_on::text,employee_id,empleado,project_id FROM ledens.worker_payments WHERE bank_movement_id=$1 ORDER BY project_id",[m])).rows;
 assert.equal(w.length,2);
 assert.ok(w.every(x=>x.amount==='-60.00'&&x.occurred_on==='2026-08-20'&&x.employee_id===emp2&&x.empleado==='Trabajador Dos'),'legacy sign: a cost is negative in worker_payments');
 assert.deepEqual(w.map(x=>x.project_id).sort(),[p1,p2].sort(),'single full allocations project into the legacy project_id');
 b=(await asAdmin().workerQueue()).rows.find(r=>r.bank_movement_id===m);
 assert.equal(b.lines.length,4);assert.equal(b.saved,2);
 // Pagos a trabajadores shows them with the role column and the worker as counterparty.
 const list=await asAdmin().listRecords({type:'trabajador',project:p1});
 const row=list.rows.find(r=>r.bank_movement_id===m);
 assert.equal(row.rol,'Ayudante');assert.equal(row.tercero,'Trabajador Dos');assert.equal(Number(row.importe),60);assert.equal(row.project_id,p1);
 assert.equal(row.fecha instanceof Date?row.fecha.toISOString().slice(0,10):String(row.fecha).slice(0,10),'2026-08-20');
 // Saving the same line twice never creates a second payment.
 const twice=await asAdmin().saveWorkerSplits({items:[{splitId:l1.id,employeeId:emp1,projectId:p2}]});
 assert.equal(twice.ok,0);assert.match(twice.results[0].error,/ya está guardado/);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.worker_payments WHERE bank_movement_id=$1',[m])).rows[0].n,2);
});

test('the legacy role comes from the employee position when the payment was not segregated here',async()=>{
 const id=(await db.query("INSERT INTO ledens.worker_payments(amount,occurred_on,employee_id,empleado) VALUES(-800,'2026-07-01',$1,'Trabajador Uno') RETURNING id",[emp1])).rows[0].id;
 const r=(await asAdmin().listRecords({type:'trabajador'})).rows.find(x=>x.id===id);
 assert.equal(r.rol,'Oficial 1ª');
});

test('jefes need the global queue grant to see the lines and write permission on the project to save them',async()=>{
 await assert.rejects(asJefe().workerQueue(),{status:403});
 const m=await movement('-120.00');await asAdmin().classifyWorkerPayments({movementIds:[m]});
 await db.query('INSERT INTO ledens.finance_project_permissions(user_id,project_id,can_write,can_review_unassigned) VALUES($1,NULL,true,true),($1,$2,true,false)',[jefe.id,p1]);
 const b=(await asJefe().workerQueue()).rows.find(r=>r.bank_movement_id===m);
 const [a1,a2]=b.lines;
 const res=await asJefe().saveWorkerSplits({items:[{splitId:a1.id,employeeId:emp2,projectId:p1},{splitId:a2.id,employeeId:emp2,projectId:p2}]});
 assert.deepEqual(res.results.map(r=>r.ok),[true,false],'no write grant on Velez');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.worker_payments WHERE bank_movement_id=$1',[m])).rows[0].n,1,'the refused line left nothing behind');
});

test('a movement can go back to reconciliation only while none of its lines is saved',async()=>{
 const m=await movement('-180.00');const {results:[r]}=await asAdmin().classifyWorkerPayments({movementIds:[m]});
 assert.equal(await inInbox(m),false);
 assert.deepEqual(await asAdmin().returnWorkerBatch({batchId:r.batchId}),{returned:true});
 assert.equal(await inInbox(m),true);
 const m2=await movement('-120.00');const {results:[r2]}=await asAdmin().classifyWorkerPayments({movementIds:[m2]});
 const line=(await asAdmin().workerQueue()).rows.find(x=>x.bank_movement_id===m2).lines[0];
 await asAdmin().saveWorkerSplits({items:[{splitId:line.id,employeeId:emp1,projectId:p1}]});
 await assert.rejects(asAdmin().returnWorkerBatch({batchId:r2.batchId}),{status:409});
});

test('HTTP: clients are refused and writes need the allowed origin',async()=>{
// The router builds its service from getPool() unless one is given; give it the admin one.
 const app2=express();app2.use(express.json());
 app2.use('/api/finanzas',createFinanzasRouter({service:asAdmin(),origin:'https://ledens.test',authenticate:(req,_res,next)=>{req.user=req.get('x-role')==='client'?{id:jefe.id,role:'client'}:{...admin};next();}}));
 const server=app2.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/finanzas`;
 try{
  const m=await movement('-60.00');
  const post=(headers)=>fetch(base+'/conciliacion/pago-trabajadores',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({movementIds:[m]})});
  assert.equal((await post({'x-role':'client',origin:'https://ledens.test'})).status,403);
  assert.equal((await post({origin:'https://evil.test'})).status,403);
  const ok=await post({origin:'https://ledens.test'});assert.equal(ok.status,200);assert.equal((await ok.json()).ok,1);
  const emps=await (await fetch(base+'/trabajadores')).json();assert.ok(emps.employees.some(e=>e.name==='Trabajador Uno'&&e.position==='Oficial 1ª'));
 }finally{server.close();}
});
