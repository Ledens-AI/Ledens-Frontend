import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {FinanzasService} from '../src/finanzas/service.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// Pagos y cobros en efectivo on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,p1,emp;
const asAdmin=()=>new FinanzasService(pool,admin),asJefe=()=>new FinanzasService(pool,jefe);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@ef.test','admin','Admin'),('jefe@ef.test','jefe','Jefe') RETURNING id,role")).rows;
 p1=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Marbella','OBRA-001') RETURNING id")).rows[0].id;
 const pos=(await db.query("INSERT INTO ledens.positions(name) VALUES('Peón') RETURNING id")).rows[0].id;
 emp=(await db.query("INSERT INTO ledens.employees(name,primary_position_id,activo) VALUES('Trabajador Uno',$1,true) RETURNING id",[pos])).rows[0].id;
});
after(()=>db?.close());
const cash=(kind,amount,extra={})=>asAdmin().createCash({kind,amount,date:'2026-10-01',concept:extra.concept||'Efectivo de prueba',counterparty:extra.counterparty});
const inbox=async()=>(await asAdmin().reconciliation({view:'movimientos',pageSize:100})).rows;
const approve=(fin,r,category,net)=>fin.approve(admin,r.id,{version:r.version,category,status:'approved',currency:'EUR',net_amount:net,vat_amount:'0',nondeductible_vat:'0',withholding_amount:'0',recognized_on:'2026-10-01',reason:'Efectivo revisado'});

test('a cash entry is validated, appears in Pendiente de conciliación signed like a bank movement, and only admins create it',async()=>{
 await assert.rejects(cash('regalo','10'),{status:400});
 await assert.rejects(cash('pago','-5'),{status:400});
 await assert.rejects(cash('pago','10.001'),{status:400});
 await assert.rejects(asAdmin().createCash({kind:'pago',amount:'10',date:'2026-13-45',concept:'x'}),{status:400});
 await assert.rejects(asAdmin().createCash({kind:'pago',amount:'10',date:'2026-10-01',concept:'  '}),{status:400});
 await assert.rejects(asJefe().createCash({kind:'pago',amount:'10',date:'2026-10-01',concept:'x'}),{status:403});
 const k=await cash('pago','35.50',{concept:'Tornillería ferretería',counterparty:'Ferretería Sol'});
 const row=(await inbox()).find(r=>r.id===k.id);
 assert.equal(row.type,'efectivo');assert.equal(Number(row.importe),-35.5);assert.deepEqual(row.motivos,['efectivo']);
 assert.equal(row.tercero,'Ferretería Sol');assert.equal(row.referencia,'Efectivo');
 assert.ok((await asAdmin().reconciliation({view:'movimientos',reason:'efectivo'})).rows.every(r=>r.type==='efectivo'));
});

test('a cash payment becomes a material expense on the project, counts once approved and as a payment in cash flow',async()=>{
 const k=await cash('pago','121.00',{concept:'Cemento en efectivo'});
 await assert.rejects(asAdmin().assignCash({id:k.id,target:'clientes'}),{status:409},'a payment is never a customer receipt');
 const res=await asAdmin().assignCash({id:k.id,target:'materiales',projectId:p1,description:'Cemento cola'});
 assert.equal(res.assigned,'materiales');
 assert.ok(!(await inbox()).some(r=>r.id===k.id),'it leaves the inbox');
 const m=(await db.query('SELECT m.total::text,m.description,m.occurred_on::text,m.project_id FROM ledens.material_expenses m JOIN ledens.cash_movements k ON k.material_id=m.id WHERE k.id=$1',[k.id])).rows[0];
 assert.deepEqual(m,{total:'-121.00',description:'Cemento cola',occurred_on:'2026-10-01',project_id:p1},'signed like the import; the engine fills project_id');
 const r=(await db.query('SELECT id,version,gross_amount::text FROM ledens.financial_records WHERE id=$1',[res.recordId])).rows[0];
 assert.equal(r.gross_amount,'121.00');
 await approve(asAdmin().finance,r,'materials','121');
 const s=await asAdmin().finance.summary(admin,p1);
 assert.equal(Number(s.material_cost),121);assert.equal(Number(s.payments),121,'cash paid is a payment of the project');
 await assert.rejects(asAdmin().assignCash({id:k.id,target:'materiales'}),{status:409},'assigned only once');
});

test('a cash receipt becomes a customer payment and a collection; without a project it waits for assignment',async()=>{
 const k=await cash('cobro','500.00',{concept:'Entrega a cuenta',counterparty:'Cliente Uno'});
 await assert.rejects(asAdmin().assignCash({id:k.id,target:'materiales'}),{status:409});
 const res=await asAdmin().assignCash({id:k.id,target:'clientes'});
 const c=(await db.query("SELECT total::text,cliente,id_pago,project_id FROM ledens.customer_payments cp JOIN ledens.cash_movements k ON k.customer_payment_id=cp.id WHERE k.id=$1",[k.id])).rows[0];
 assert.deepEqual(c,{total:'500.00',cliente:'Cliente Uno',id_pago:'Efectivo',project_id:null});
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.project_financial_allocations WHERE record_id=$1',[res.recordId])).rows[0].n,0,'unassigned: it goes to Pendiente de asignación');
 // Assigned later and approved as an advance, it is a collection of the project.
 const fin=asAdmin().finance;let r=(await db.query('SELECT id,version,gross_amount FROM ledens.financial_records WHERE id=$1',[res.recordId])).rows[0];
 await fin.transaction(c=>fin.replace(c,admin,{record_id:r.id,version:r.version,allocations:[{project_id:p1,amount:r.gross_amount}]},'Cobro en efectivo'));
 r=(await db.query('SELECT id,version FROM ledens.financial_records WHERE id=$1',[res.recordId])).rows[0];
 await approve(fin,r,'advance','500');
 assert.equal(Number((await fin.summary(admin,p1)).collections),500);
});

test('a cash payment to workers goes through Pendiente de trabajador and can go back while nothing is saved',async()=>{
 const back=await cash('pago','120.00');
 const sent=await asAdmin().classifyWorkerPayments({movementIds:[back.id]});
 assert.deepEqual([sent.ok,sent.results[0].role,sent.results[0].lines],[1,'ayudante',2]);
 assert.ok(!(await inbox()).some(r=>r.id===back.id));
 const batch=(await asAdmin().workerQueue()).rows.find(b=>b.cash_movement_id===back.id);
 assert.equal(batch.source_id,'Efectivo');assert.equal(batch.bank_movement_id,null);
 await assert.rejects(asAdmin().deleteCash(back.id),{status:409},'not while it is in the worker queue');
 await asAdmin().returnWorkerBatch({batchId:batch.id});
 assert.ok((await inbox()).some(r=>r.id===back.id),'back in the inbox, assignable again');
 const cobro=await cash('cobro','60.00');
 assert.match((await asAdmin().classifyWorkerPayments({movementIds:[cobro.id]})).results[0].error,/pagos salientes/);
 // Saved: a worker payment with no bank movement, allocated, approvable without a document.
 await asAdmin().classifyWorkerPayments({movementIds:[back.id]});
 const b2=(await asAdmin().workerQueue()).rows.find(b=>b.cash_movement_id===back.id);
 const saved=await asAdmin().saveWorkerSplits({items:b2.lines.map(l=>({splitId:l.id,employeeId:emp,projectId:p1}))});
 assert.equal(saved.ok,2);
 const recs=(await db.query(`SELECT r.id,r.version,r.bank_movement_id FROM ledens.financial_records r JOIN ledens.worker_payment_splits s ON s.worker_payment_id=r.worker_payment_id
  WHERE s.batch_id=$1`,[b2.id])).rows;
 assert.ok(recs.every(r=>r.bank_movement_id===null));
 const before=await asAdmin().finance.summary(admin,p1);
 for(const r of recs)await approve(asAdmin().finance,r,'labor','60');
 const s=await asAdmin().finance.summary(admin,p1);
 assert.equal(Number(s.labor_cost),120);assert.equal(Number(s.payments)-Number(before.payments),120);
});

test('only an unassigned entry can be deleted; HTTP needs an admin and the allowed origin',async()=>{
 const k=await cash('pago','9.99');
 assert.deepEqual(await asAdmin().deleteCash(k.id),{deleted:true});
 assert.ok(!(await inbox()).some(r=>r.id===k.id));
 await assert.rejects(asAdmin().deleteCash(k.id),{status:404});
 const app=express();app.use(express.json());
 app.use('/api/finanzas',createFinanzasRouter({service:asAdmin(),origin:'https://ledens.test',authenticate:(req,_res,next)=>{req.user=req.get('x-role')==='client'?{id:jefe.id,role:'client'}:{...admin};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/finanzas/conciliacion/efectivo`;
 try{
  const post=(body,headers={})=>fetch(base,{method:'POST',headers:{'content-type':'application/json',origin:'https://ledens.test',...headers},body:JSON.stringify(body)});
  const body={kind:'cobro',amount:'80',date:'2026-10-02',concept:'Señal'};
  assert.equal((await post(body,{origin:'https://evil.test'})).status,403);
  assert.equal((await post(body,{'x-role':'client'})).status,403);
  const ok=await post(body);assert.equal(ok.status,201);const k2=await ok.json();
  const assign=await fetch(`${base}/${k2.id}/asignar`,{method:'POST',headers:{'content-type':'application/json',origin:'https://ledens.test'},body:JSON.stringify({target:'clientes',projectId:p1})});
  assert.equal(assign.status,200);assert.equal((await assign.json()).assigned,'clientes');
 }finally{server.close();}
});
