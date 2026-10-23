import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import {FinanceService} from '../src/finance/service.js';
import {cents} from '../src/bridge/rules.js';
import {createFinanceRouter} from '../src/routes/finance.js';
import {storeInvoiceLines,extractLines} from '../src/finance/ingestion.js';
let db,pool,service,admin,p1,p2;
const read=p=>fs.readFile(new URL(p,import.meta.url),'utf8');
before(async()=>{
 // FINANCE_TEST_DATABASE_URL must name an EMPTY, DISPOSABLE database, never production.
 if(process.env.FINANCE_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.FINANCE_TEST_DATABASE_URL});db={query:(...a)=>pool.query(...a),exec:q=>pool.query(q),close:()=>pool.end()};}
 else{const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 await db.exec(await read('./finance-fixture.sql'));
 await db.exec(await read('../src/db/migrations/004_invoice_ingestion.sql'));
 await db.exec(await read('../src/db/migrations/005_bank_bridge.sql'));
 await db.exec(await read('../src/db/migrations/006_project_finance.sql'));
 admin={id:(await db.query("INSERT INTO users(email,role) VALUES('admin@test','admin') RETURNING id")).rows[0].id,role:'admin'};
 [p1,p2]=(await db.query("INSERT INTO ledens.projects(project_id,name) VALUES('OBRA-001','Marbella'),('OBRA-002','Velez') RETURNING id")).rows.map(r=>r.id);
 service=new FinanceService(pool);
});
after(async()=>db?.close());
const doc=async(total='-1210')=>(await db.query("INSERT INTO ledens.documents(total,tipo,document_on) VALUES($1,$2,'2025-09-01') RETURNING id",[total,Number(total)<0?'Pagar':'Cobrar'])).rows[0].id;
const material=async(total='-1210',documentId=null)=>{
 const source=(await db.query("INSERT INTO ledens.material_expenses(total,document_id,description,occurred_on) VALUES($1,$2,'Cemento','2025-09-01') RETURNING id",[total,documentId])).rows[0];
 return (await db.query('SELECT * FROM ledens.financial_records WHERE material_id=$1',[source.id])).rows[0];
};
const replace=(r,allocations,extra={})=>service.bulk(admin,{request_id:randomUUID(),reason:'Validado por usuario',records:[{record_id:r.id,version:r.version,allocations}],...extra});
const share=(project_id,amount)=>({project_id,amount});
const recognize=async(r,extra={})=>service.approve(admin,r.id,{version:r.version,category:'materials',status:'approved',currency:'EUR',net_amount:'1000',vat_amount:'210',nondeductible_vat:'0',withholding_amount:'0',recognized_on:'2025-09-01',reason:'Factura comprobada',...extra});

test('individual assignment, change, removal and immutable history',async()=>{
 let r=await material();r=(await replace(r,[share(p1,'1210')])).records[0];assert.equal(r.allocations[0].project_id,p1);
 r=(await replace(r,[share(p2,'1210')])).records[0];assert.equal(r.allocations[0].project_id,p2);
 r=(await replace(r,[])).records[0];assert.equal(r.allocations.length,0);
 assert.equal((await service.history(admin,r.id)).length,3);
 assert.equal((await db.query('SELECT project_id FROM ledens.material_expenses WHERE id=$1',[r.material_id])).rows[0].project_id,null);
});
test('bulk atomicity, nonexistent project and over-allocation rejected',async()=>{
 const a=await material(),b=await material();
 await assert.rejects(service.bulk(admin,{request_id:randomUUID(),reason:'Asignacion conjunta',records:[{record_id:a.id,version:1,allocations:[share(p1,'1210')]},{record_id:b.id,version:1,allocations:[share(randomUUID(),'1210')]}]}),{message:'project_not_found'});
 assert.equal((await service.record(pool,a.id,admin)).version,1);
 await assert.rejects(replace(a,[share(p1,'1211')]),{message:'allocation_exceeds_source'});
 const result=await service.bulk(admin,{request_id:randomUUID(),reason:'Asignacion conjunta',records:[a,b].map(r=>({record_id:r.id,version:1,allocations:[share(p1,'1210')]}))});assert.equal(result.records.length,2);
});
test('partial and multi-project allocation preserve one source and legacy null',async()=>{
 let r=await material();r=(await replace(r,[share(p1,'500'),share(p2,'300')])).records[0];
 assert.equal(r.allocations.length,2);assert.equal(r.gross_amount,'1210');
 assert.equal((await db.query('SELECT project_id FROM ledens.material_expenses WHERE id=$1',[r.material_id])).rows[0].project_id,null);
 const rows=await service.list(admin,{unassigned:true});assert.ok(rows.some(x=>x.id===r.id&&x.unassigned_amount==='410'));
});
test('idempotent replay and stale update conflict',async()=>{
 const r=await material(),body={request_id:randomUUID(),reason:'Reintento seguro',records:[{record_id:r.id,version:1,allocations:[share(p1,'1210')]}]};
 const a=await service.bulk(admin,body),b=await service.bulk(admin,body);assert.deepEqual(a,b);
 await assert.rejects(replace(r,[]),{message:'stale_record'});
 await assert.rejects(service.bulk(admin,{...body,reason:'Otro contenido'}),{message:'idempotency_conflict'});
});
test('database guard prevents bypassing amount limit',async()=>{
 const r=await material();await db.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES($1,$2,1200)',[r.id,p1]);
 await assert.rejects(db.query('INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES($1,$2,20)',[r.id,p2]),{code:'23514'});
});
test('unauthorized user and customer cannot read or assign finance',async()=>{
 const r=await material(),user={id:randomUUID(),role:'jefe'};
 await assert.rejects(service.bulk(user,{request_id:randomUUID(),reason:'No autorizado',records:[{record_id:r.id,version:1,allocations:[share(p1,'1210')]}]}),{status:403});
 await assert.rejects(service.summary({id:randomUUID(),role:'client'},p1),{status:403});
 assert.equal((await service.list(user,{})).length,0);
});
test('invoice with multiple lines/projects has one invoice and one bank payment; no cost duplication',async()=>{
 const d=await doc();const b=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,currency,state) VALUES(-1210,-1210,'EUR','COMPLETED') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$2,-1210,'Confirmado')",[d,b]);
 await storeInvoiceLines(pool,d,[1,2].map(i=>({line_number:i,description:'Cemento',net_amount:500,vat_amount:105,confidence:.99})),{direction:'Pagar',currency:'EUR'});
 const rows=(await db.query('SELECT * FROM ledens.financial_records WHERE document_id=$1 ORDER BY id',[d])).rows;
 for(let i=0;i<2;i++){let r=rows[i];r=(await replace(r,[share(i?p2:p1,'605')])).records[0];await recognize(r,{net_amount:'500',vat_amount:'105'});}
 const a=await service.summary(admin,p1);assert.equal(Number(a.material_cost),500);assert.equal(Number(a.payments),605);
 assert.equal(a.direct_margin_percent,null);assert.equal(Number(a.direct_result),-500);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.documents WHERE id=$1',[d])).rows[0].n,1);
 const before=(await db.query('SELECT count(*)::int n FROM ledens.financial_records WHERE document_id=$1',[d])).rows[0].n;
 await storeInvoiceLines(pool,d,[{line_number:1,net_amount:500,vat_amount:105}],{direction:'Pagar',currency:'EUR'});
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.financial_records WHERE document_id=$1',[d])).rows[0].n,before);
});
test('worker payment splits 500/300 without duplicating original 800',async()=>{
 const w=(await db.query("INSERT INTO ledens.worker_payments(amount) VALUES(-800) RETURNING id")).rows[0].id;
 let r=(await db.query('SELECT * FROM ledens.financial_records WHERE worker_payment_id=$1',[w])).rows[0];
 r=(await replace(r,[share(p1,'500'),share(p2,'300')])).records[0];assert.equal(r.gross_amount,'800');assert.equal(r.allocations.length,2);
});
test('non-deductible VAT and credit notes reduce economic cost consistently',async()=>{
 const project=(await db.query("INSERT INTO ledens.projects(name) VALUES('IVA') RETURNING id")).rows[0].id;
 let r=await material('-121',await doc('-121'));r=(await replace(r,[share(project,'121')])).records[0];
 await recognize(r,{net_amount:'100',vat_amount:'21',nondeductible_vat:'21'});
 r=await material('60.50',await doc('60.50'));r=(await replace(r,[share(project,'-60.50')])).records[0];
 await recognize(r,{net_amount:'-50',vat_amount:'-10.50',nondeductible_vat:'-10.50'});
 const s=await service.summary(admin,project);assert.equal(Number(s.material_cost),60.5);
});
test('customer advance affects treasury only, never recognized revenue',async()=>{
 const project=(await db.query("INSERT INTO ledens.projects(name) VALUES('Anticipo') RETURNING id")).rows[0].id;
 const b=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,currency,state) VALUES(800,800,'EUR','COMPLETED') RETURNING id")).rows[0].id;
 const c=(await db.query('INSERT INTO ledens.customer_payments(total,bank_movement_id) VALUES(800,$1) RETURNING id',[b])).rows[0].id;
 let r=(await db.query('SELECT * FROM ledens.financial_records WHERE customer_payment_id=$1',[c])).rows[0];r=(await replace(r,[share(project,'800')])).records[0];
 await recognize(r,{category:'advance',net_amount:'800',vat_amount:'0'});
 const s=await service.summary(admin,project);assert.equal(Number(s.collections),800);assert.equal(Number(s.recognized_revenue),0);assert.equal(s.direct_margin_percent,null);
});
test('source correction invalidates approval and retains audit',async()=>{
 const d=await doc('-121'),r=await material('-121',d);await recognize(r,{net_amount:'100',vat_amount:'21'});
 await db.query('UPDATE ledens.material_expenses SET total=-242 WHERE id=$1',[r.material_id]);
 const updated=await service.record(pool,r.id,admin);assert.equal(updated.status,'pending');assert.equal(updated.gross_amount,'242');assert.ok((await service.history(admin,r.id)).some(e=>e.action==='source_changed'));
});
test('revenue without costs has 100 percent direct margin; partial collection remains treasury',async()=>{
 const project=(await db.query("INSERT INTO ledens.projects(name) VALUES('Ingresos') RETURNING id")).rows[0].id;
 const d=await doc('1100');const line=await service.createLine(admin,d,{line_number:1,gross_amount:'1100',description:'Trabajo terminado',reason:'Factura emitida validada'});
 let r=(await replace(line,[share(project,'1100')])).records[0];
 await recognize(r,{category:'revenue',net_amount:'1000',vat_amount:'100'});
 const b=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,currency,state) VALUES(550,550,'EUR','COMPLETED') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$2,550,'Confirmado')",[d,b]);
 const s=await service.summary(admin,project);assert.equal(Number(s.recognized_revenue),1000);assert.equal(Number(s.direct_cost),0);assert.equal(Number(s.direct_margin_percent),100);assert.equal(Number(s.collections),550);
});
test('partial bank payment changes cash, never the recognized cost',async()=>{
 const project=(await db.query("INSERT INTO ledens.projects(name) VALUES('Pago parcial') RETURNING id")).rows[0].id;
 const d=await doc('-1210');let r=await material('-1210',d);r=(await replace(r,[share(project,'1210')])).records[0];await recognize(r);
 const b=(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,currency,state) VALUES(-605,-605,'EUR','COMPLETED') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$2,-605,'Confirmado')",[d,b]);
 const s=await service.summary(admin,project);assert.equal(Number(s.material_cost),1000);assert.equal(Number(s.payments),605);
});
test('withholding is a liability component, not extra execution cost',async()=>{
 const d=await doc('-106'),r=await material('-106',d);
 const approved=await recognize(r,{net_amount:'100',vat_amount:'21',withholding_amount:'15'});assert.equal(approved.net_amount,'100');assert.equal(approved.gross_amount,'106');
});
test('duplicate representation and invoice overstatement cannot enter profitability',async()=>{
 const d=await doc('-121');const line=await service.createLine(admin,d,{line_number:1,gross_amount:'121',description:'Material',reason:'Detalle contrastado'});
 await recognize(line,{net_amount:'100',vat_amount:'21'});
 const legacy=await material('-121',d);await assert.rejects(recognize(legacy,{net_amount:'100',vat_amount:'21'}),{message:'duplicate_document_representation'});
 const extra=await service.createLine(admin,d,{line_number:2,gross_amount:'121',description:'Duplicado',reason:'Control de total'});
 await assert.rejects(recognize(extra,{net_amount:'100',vat_amount:'21'}),{message:'document_amount_exceeded'});
});
test('project-specific permission cannot expose other projects or global unassigned records',async()=>{
 const user={id:(await db.query("INSERT INTO users(email,role) VALUES('jefe@test','jefe') RETURNING id")).rows[0].id,role:'jefe'};
 await db.query('INSERT INTO ledens.finance_project_permissions(user_id,project_id,can_write) VALUES($1,$2,true)',[user.id,p1]);
 const r=await material();await replace(r,[share(p1,'600'),share(p2,'610')]);
 await assert.rejects(service.record(pool,r.id,user),{status:403});assert.ok(!(await service.list(user,{})).some(x=>x.id===r.id));
 await assert.rejects(service.summary(user,p2),{status:403});assert.ok((await service.projects(user)).every(p=>p.id===p1));
});
test('line extraction retains distinct tax rates and missing tax stays pending',()=>{
 const lines=extractLines({analyzeResult:{documents:[{fields:{Items:{valueArray:[{valueObject:{Amount:{valueCurrency:{amount:100},confidence:.99},Tax:{valueCurrency:{amount:21}}}},{valueObject:{Amount:{valueCurrency:{amount:100}},Tax:{valueCurrency:{amount:10}}}},{valueObject:{Amount:{valueCurrency:{amount:100}}}}]}}}]}});
 assert.deepEqual(lines.map(l=>l.vat_amount),[21,10,null]);
});
test('missing line tax creates one pending document envelope and replay cannot duplicate it',async()=>{
 const d=await doc('-121');await storeInvoiceLines(pool,d,[{line_number:1,description:'Material pendiente',net_amount:100,vat_amount:null}],{direction:'Pagar',currency:'EUR'});
 await storeInvoiceLines(pool,d,[{line_number:1,description:'Material pendiente',net_amount:100,vat_amount:null}],{direction:'Pagar',currency:'EUR'});
 const records=(await db.query('SELECT * FROM ledens.financial_records WHERE document_id=$1',[d])).rows;assert.equal(records.length,1);assert.equal(cents(records[0].gross_amount),12100n);assert.equal(records[0].status,'pending');assert.equal(records[0].category,'unclassified');
});
test('zeroed source cannot retain approved economics or receive assignments',async()=>{
 const d=await doc('-121');let r=await material('-121',d);r=(await replace(r,[share(p1,'121')])).records[0];await recognize(r,{net_amount:'100',vat_amount:'21'});
 await db.query('UPDATE ledens.material_expenses SET total=0 WHERE id=$1',[r.material_id]);r=await service.record(pool,r.id,admin);assert.equal(r.source_valid,false);assert.equal(r.status,'pending');assert.equal(r.allocations.length,0);
 await assert.rejects(replace(r,[share(p1,'121')]),{message:'source_requires_correction'});
});
test('PostgreSQL concurrent assignments serialize and reject the stale writer',{skip:!process.env.FINANCE_TEST_DATABASE_URL},async()=>{
 const r=await material();const results=await Promise.allSettled([replace(r,[share(p1,'1210')]),replace(r,[share(p2,'1210')])]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.message,'stale_record');
 assert.equal((await service.record(pool,r.id,admin)).allocations.length,1);
});
test('only accepted, approved and verified net budgets enter current budget; source changes invalidate it',async()=>{
 const project=(await db.query("INSERT INTO ledens.projects(name) VALUES('Presupuesto') RETURNING id")).rows[0].id;
 assert.equal((await service.summary(admin,project)).budget,null);
 const b=(await db.query('INSERT INTO ledens.budgets(project_id) VALUES($1) RETURNING id',[project])).rows[0].id;
 const v=(await db.query("INSERT INTO ledens.budget_versions(budget_id,version_number,state) VALUES($1,1,'accepted') RETURNING id",[b])).rows[0].id;
 await db.query("INSERT INTO ledens.budget_approvals(version_id,decision) VALUES($1,'approved')",[v]);
 await db.query('INSERT INTO ledens.budget_lines(version_id,budget_id,quantity,unit_price,total) VALUES($1,$2,1,10000,10000)',[v,b]);
 await service.verifyBudget(admin,v,{amount_basis:'net',reason:'Presupuesto sin IVA comprobado'});
 assert.equal((await service.summary(admin,project)).budget,'10000');
 await db.query('UPDATE ledens.budget_lines SET total=12000 WHERE version_id=$1',[v]);assert.equal((await service.summary(admin,project)).budget,null);
});
test('HTTP rejects missing authentication, customer, invalid ids and cross-origin writes',async()=>{
 const app=express();app.use(express.json());app.use('/api',createFinanceRouter({service,origin:'https://ledens.test',authorize:(req,res,next)=>{
   if(!req.get('x-test-user'))return res.status(401).json({error:'unauthenticated'});req.user={...admin,role:req.get('x-test-user')};next();
 }}));const server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'/api/projects')).status,401);
 assert.equal((await fetch(base+'/api/projects',{headers:{'x-test-user':'client'}})).status,403);
 assert.equal((await fetch(base+'/api/finance/records/bad',{headers:{'x-test-user':'admin'}})).status,400);
 assert.equal((await fetch(base+'/api/finance/allocations/bulk',{method:'POST',headers:{'x-test-user':'admin','content-type':'application/json'},body:'{}'})).status,403);
 const user=(await db.query("INSERT INTO users(email,role) VALUES('grant@test','jefe') RETURNING id")).rows[0].id;
 const headers={'x-test-user':'admin','content-type':'application/json',origin:'https://ledens.test'};
 assert.equal((await fetch(base+'/api/finance/permissions',{method:'PUT',headers,body:JSON.stringify({user_id:user,project_id:p1,can_write:true,can_review_unassigned:false,reason:'Permiso de prueba'})})).status,200);
 assert.equal((await fetch(base+'/api/finance/permissions',{method:'DELETE',headers,body:JSON.stringify({user_id:user,project_id:p1,reason:'Revocacion comprobada'})})).status,200);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.finance_project_permissions WHERE user_id=$1',[user])).rows[0].n,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
