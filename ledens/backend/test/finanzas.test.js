import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {FinanzasService,safeDocumentUrl} from '../src/finanzas/service.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
let db,pool,svc,admin,jefe,p1,p2;
before(async()=>{
 if(process.env.FINANZAS_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.FINANZAS_TEST_DATABASE_URL});db={exec:q=>pool.query(q),query:(...a)=>pool.query(...a),close:()=>pool.end()};}
 else {const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 const users=(await db.query("INSERT INTO users(email,role) VALUES('admin@ui.test','admin'),('jefe@ui.test','jefe') RETURNING id,role")).rows;[admin,jefe]=users;
 [p1,p2]=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Marbella','OBRA-001'),('Velez','OBRA-002') RETURNING id")).rows.map(x=>x.id);
 svc=new FinanzasService(pool,admin);
});after(()=>db?.close());
const source=async()=>{const id=(await db.query("INSERT INTO ledens.material_expenses(total,description,occurred_on) VALUES(-1200,'Cemento','2025-09-01') RETURNING id")).rows[0].id;return svc.getRecord('material',id);};
const assign=(r,projectId,extra={})=>svc.assign({type:r.type,id:r.id,projectId,version:r.version,requestId:randomUUID(),reason:'Asignación revisada',...extra});
test('UI and canonical API share exactly one allocation and source project',async()=>{
 let r=await source();await assign(r,p1);r=await svc.getRecord(r.type,r.id);
 assert.equal(r.project_id,p1);assert.equal(r.parts,0);assert.equal(r.importe,'1200');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.project_financial_allocations WHERE record_id=$1',[r.record_id])).rows[0].n,1);
 assert.equal((await db.query("SELECT to_regclass('ledens.project_allocations') id")).rows[0].id,null);
 await assign(r,p2);r=await svc.getRecord(r.type,r.id);assert.equal(r.project_id,p2);assert.ok(r.historial.some(e=>e.old_label==='Marbella'&&e.new_label==='Velez'));
});
test('distribution uses canonical caps, clears legacy project, rejects stale writes',async()=>{
 let r=await source();await svc.distribute({type:r.type,id:r.id,version:r.version,requestId:randomUUID(),parts:[{projectId:p1,amount:'700'},{projectId:p2,amount:'500'}]});
 await assert.rejects(assign(r,p1),{status:409});r=await svc.getRecord(r.type,r.id);assert.equal(r.distribucion.length,2);assert.equal(r.project_id,null);
 await assert.rejects(svc.distribute({type:r.type,id:r.id,version:r.version,requestId:randomUUID(),reason:'Reparto corregido',parts:[{projectId:p1,amount:'1400'}]}),{status:409});
 assert.equal((await db.query('SELECT project_id FROM ledens.material_expenses WHERE id=$1',[r.id])).rows[0].project_id,null);
});
test('pagination, filters and pending totals use canonical gross cents',async()=>{
 const r=await source();const listed=await svc.listRecords({type:'material',pending:true,q:'Cemento',pageSize:1});assert.equal(listed.rows.length,1);assert.ok(listed.total>0);
 const summary=await svc.pendingSummary();assert.ok(summary.pendientes>0);assert.ok(Number(summary.importePendiente)>=1200);
 await svc.distribute({type:r.type,id:r.id,version:r.version,requestId:randomUUID(),parts:[{projectId:p1,amount:'700'}]});
 assert.ok((await svc.listRecords({estado:'parcial'})).rows.some(x=>x.id===r.id));
});
test('jefe sees only explicit project grants and cannot read global banking',async()=>{
 const restricted=new FinanzasService(pool,jefe);assert.equal((await restricted.listRecords()).total,0);
 await db.query('INSERT INTO ledens.finance_project_permissions(user_id,project_id,can_write) VALUES($1,$2,true)',[jefe.id,p1]);
 const r=await source();await assign(r,p2);await assert.rejects(restricted.getRecord(r.type,r.id),{status:404});
 assert.ok((await restricted.listProjects()).every(p=>p.id===p1));await assert.rejects(restricted.reconciliation(),{status:403});
});
test('review flag has audit and never approves accounting or duplicates a record',async()=>{
 let r=await source();await svc.setReview({type:r.type,id:r.id,version:r.version,needsReview:true,note:'Comprobar IVA'});r=await svc.getRecord(r.type,r.id);
 assert.equal(r.needs_review,true);assert.equal(r.accounting_status,'pending');assert.ok(r.historial.some(x=>x.action==='Revisión'));
 assert.equal((await svc.listRecords({estado:'revision'})).rows.filter(x=>x.id===r.id).length,1);
});
test('bulk reports per-record conflicts without overwriting another writer',async()=>{
 const a=await source(),b=await source();await assign(b,p2);
 const result=await svc.bulk({action:'assign',projectId:p1,reason:'Asignación conjunta',requestId:randomUUID(),items:[{type:a.type,id:a.id,version:a.version},{type:b.type,id:b.id,version:b.version}]});
 assert.equal(result.ok,1);assert.equal(result.failed,1);assert.equal((await svc.getRecord(b.type,b.id)).project_id,p2);
});
test('profitability facade returns recognized economics and independent cash only',async()=>{
 const r=await source();await assign(r,p1);const s=await svc.profitability(p1);
 assert.equal(Number(s.kpis.costeTotal),0);assert.equal(Number(s.kpis.cobros),0);assert.ok(s.kpis.pendientesRevision>0);assert.equal(s.kpis.margenDirectoPct,null);
 assert.equal(safeDocumentUrl('https://evil.example/a'),null);assert.ok(safeDocumentUrl('https://ledenses.sharepoint.com/a'));
});
test('HTTP authentication, role check, CSRF and assignment version survive the adapter',async()=>{
 const app=express();app.use(express.json());app.use('/api/finanzas',createFinanzasRouter({service:svc,origin:'https://ledens.test',authenticate:(req,res,next)=>{if(!req.get('x-user'))return res.status(401).json({error:'login'});req.user={...admin,role:req.get('x-user')};next();}}));
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port+'/api/finanzas';
 try{assert.equal((await fetch(base+'/resumen')).status,401);assert.equal((await fetch(base+'/resumen',{headers:{'x-user':'client'}})).status,403);
 const r=await source(),url=base+'/registros/material/'+r.id+'/proyecto',body={projectId:p1,version:r.version,request_id:randomUUID(),reason:'Proyecto revisado'};
 assert.equal((await fetch(url,{method:'PUT',headers:{'x-user':'admin','content-type':'application/json'},body:JSON.stringify(body)})).status,403);
 assert.equal((await fetch(url,{method:'PUT',headers:{'x-user':'admin','content-type':'application/json',origin:'https://ledens.test'},body:JSON.stringify(body)})).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('reconciliation inbox includes missing documents and Bridge, partial and review; excludes confirmed',async()=>{
 const r=await source();let inbox=await svc.reconciliation({view:'registros',q:'Cemento'});assert.ok(inbox.rows.some(x=>x.id===r.id&&x.motivos.includes('sin_documento')&&x.motivos.includes('sin_bridge')));
 const doc=(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-1200,'Pagar','2025-09-01','RECON-TEST') RETURNING id")).rows[0].id;
 const bank=(await db.query("INSERT INTO ledens.bank_movements(total_amount,amount,currency,completed_on,description) VALUES(-1200,-1200,'EUR','2025-09-01','RECON-TEST') RETURNING id")).rows[0].id;
 await db.query('UPDATE ledens.material_expenses SET document_id=$1 WHERE id=$2',[doc,r.id]);
 inbox=await svc.reconciliation({view:'registros',reason:'sin_bridge',q:'RECON-TEST'});assert.ok(inbox.rows.some(x=>x.id===r.id));
 await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$2,-600,'Confirmado')",[doc,bank]);
 assert.ok((await svc.reconciliation({view:'registros',reason:'parcial',q:'RECON-TEST'})).rows.some(x=>x.id===r.id));
 await db.query("UPDATE ledens.bank_document_allocations SET allocated_amount=-1200 WHERE document_id=$1",[doc]);
 assert.ok(!(await svc.reconciliation({view:'registros',q:'RECON-TEST'})).rows.some(x=>x.id===r.id));
 assert.equal((await svc.reconciliation({view:'documentos',q:'RECON-TEST'})).total,0);
 assert.equal((await svc.reconciliation({view:'movimientos',q:'RECON-TEST'})).total,0);
 await db.query("UPDATE ledens.bank_document_allocations SET state='Revisar' WHERE document_id=$1",[doc]);
 assert.ok((await svc.reconciliation({view:'registros',reason:'revision',q:'RECON-TEST'})).rows.some(x=>x.id===r.id));
 assert.equal((await svc.reconciliation({view:'movimientos',q:'RECON-TEST'})).total,1);
 const beyond=await svc.reconciliation({view:'registros',q:'RECON-TEST',page:100,pageSize:1});assert.equal(beyond.rows.length,0);assert.ok(beyond.total>0);
 await assert.rejects(svc.reconciliation({view:'invalid'}),{status:400});await assert.rejects(svc.reconciliation({from:'invalid'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).reconciliation({view:'registros'}),{status:403});
});

test('default reconciliation inbox contains only bank movements and deduplicates document links',async()=>{
 const d1=(await db.query("INSERT INTO ledens.documents(total,tipo,numerodocumento) VALUES(-40,'Pagar','BANK-ONLY-A') RETURNING id")).rows[0].id;
 const d2=(await db.query("INSERT INTO ledens.documents(total,tipo,numerodocumento) VALUES(-60,'Pagar','BANK-ONLY-B') RETURNING id")).rows[0].id;
 const bank=(await db.query("INSERT INTO ledens.bank_movements(total_amount,amount,currency,description) VALUES(-100,-100,'EUR','BANK-ONLY') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$3,-40,'Confirmado'),($2,$3,-30,'Confirmado')",[d1,d2,bank]);
 const inbox=await svc.reconciliation({q:'BANK-ONLY'});assert.equal(inbox.total,1);assert.equal(inbox.rows.length,1);assert.equal(inbox.rows[0].type,'movimiento');assert.equal(Number(inbox.rows[0].por_conciliar),-30);assert.equal(inbox.rows[0].enlaces,2);assert.ok(inbox.rows[0].numerodocumento.includes('BANK-ONLY-A'));
 await db.query("UPDATE ledens.bank_document_allocations SET allocated_amount=-60 WHERE document_id=$1",[d2]);assert.equal((await svc.reconciliation({q:'BANK-ONLY'})).total,0);
});
