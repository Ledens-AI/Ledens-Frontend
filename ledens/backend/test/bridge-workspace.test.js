import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {BridgeService} from '../src/bridge/service.js';
import {BridgeWorkspace} from '../src/bridge/workspace.js';
import {createBridgeRouter} from '../src/routes/bridge.js';
import {checkRole} from '../src/auth/sessions.js';
let db,pool,service,workspace,server,base,actor;
before(async()=>{
 if(process.env.BRIDGE_WORKSPACE_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.BRIDGE_WORKSPACE_TEST_DATABASE_URL});db={query:(...a)=>pool.query(...a),exec:q=>pool.query(q),close:()=>pool.end()};}
 else{const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 for(const path of ['finance-fixture.sql','../src/db/migrations/004_invoice_ingestion.sql','../src/db/migrations/005_bank_bridge.sql','../src/db/migrations/012_bridge_party_amount_date.sql','../src/db/migrations/016_bridge_amount_near_date.sql'])await db.exec(await fs.readFile(new URL(path,import.meta.url),'utf8'));
 actor=(await db.query("INSERT INTO users(email,role) VALUES('reviewer@bridge.test','admin') RETURNING id")).rows[0].id;
 service=new BridgeService(pool);workspace=new BridgeWorkspace(pool);
 const app=express();app.use(express.json());process.env.CORS_ORIGIN='https://ledens.test';
 app.use('/api/bridge',createBridgeRouter({service,authorize:[(req,res,next)=>{if(!req.get('x-role'))return res.status(401).end();req.user={id:actor,role:req.get('x-role')};next();},checkRole('admin')]}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port+'/api/bridge';
});after(async()=>{if(server)await new Promise(r=>server.close(r));await db?.close();});
const doc=async(n,amount,tipo=Number(amount)<0?'Pagar':'Cobrar')=>(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES($1,$2,'2026-10-22',$3,'Cliente de prueba') RETURNING id",[amount,tipo,n])).rows[0].id;
const bank=async(amount)=>(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,state,type,currency,completed_on,description,payer,is_internal_transfer) VALUES($1,$1,'COMPLETED','TRANSFER','EUR','2026-10-23','Pago de otra persona','Tercero distinto',false) RETURNING id",[amount])).rows[0].id;
async function request(path,{method='GET',body,role='admin',origin='https://ledens.test'}={}){const r=await fetch(base+path,{method,headers:{...(role?{'x-role':role}:{}),origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>null)};}
async function confirmation(id,bankId,amount){const b=(await workspace.movements({limit:50})).rows.find(r=>r.id===bankId),d=(await workspace.documents(bankId,{q:id,limit:50})).rows.find(r=>r.id===id)||(await workspace.documents(bankId,{limit:50})).rows.find(r=>r.id===id);return {bank_movement_id:bankId,request_id:randomUUID(),version:d.version,document_fingerprint:d.document_fingerprint,bank_fingerprint:b.bank_fingerprint,amount,currency:'EUR',tipo:Number(b.total_amount)<0?'Pagar':'Cobrar',reason:'Documento revisado por Business User'};}
test('manual Save links an existing document, supports partial amounts, refreshes pending counts and replays safely',async()=>{
 const d=await doc('MANUAL-100','-100'),b=await bank('-100');
 const list=await request('/workspace/movements?q=otra');assert.equal(list.status,200);assert.ok(list.data.rows.some(r=>r.id===b));
 assert.equal((await request('/workspace/movements/'+b+'/documents?q=MANUAL-100')).data.total,1);
 const first=await confirmation(d,b,'40.00');assert.equal((await request('/'+d+'/confirm',{method:'POST',body:first})).data.status,'partial');
 const partial=(await workspace.movements()).rows.find(r=>r.id===b);assert.equal(Number(partial.remaining),-60);
 const final=await confirmation(d,b,'60.00');assert.equal((await request('/'+d+'/confirm',{method:'POST',body:final})).status,200);
 assert.equal((await request('/'+d+'/confirm',{method:'POST',body:final})).data.replay,true);
 assert.equal((await workspace.movements()).rows.some(r=>r.id===b),false);assert.equal((await workspace.counts()).pending,0);
 const history=await workspace.allocations({q:'MANUAL-100'});assert.equal(history.total,1);assert.equal(Number(history.rows[0].allocated_amount),-100);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.bridge_events WHERE document_id=$1 AND action='manual_confirmed'",[d])).rows[0].n,2);
});
test('manual confirmation rejects stale selection, excessive amounts and unauthorized users',async()=>{
 const d=await doc('GUARDS-200','-200'),b=await bank('-200'),body=await confirmation(d,b,'201.00');
 assert.equal((await request('/'+d+'/confirm',{method:'POST',body})).status,409);
 assert.equal((await request('/'+d+'/confirm',{method:'POST',body:{...body,amount:'200.00',version:body.version+1}})).status,409);
 await db.query("UPDATE ledens.bank_movements SET description='Cambio' WHERE id=$1",[b]);
 assert.equal((await request('/'+d+'/confirm',{method:'POST',body:{...body,amount:'200.00'}})).data.error,'bank_changed');
 assert.equal((await request('/workspace/counts',{role:'client'})).status,403);assert.equal((await request('/workspace/counts',{role:'jefe'})).status,403);assert.equal((await request('/workspace/counts',{role:''})).status,401);
 assert.equal((await request('/'+d+'/confirm',{method:'POST',body,origin:'https://other.test'})).status,403);
 assert.equal((await request('/workspace/movements?limit=999')).status,400);assert.equal((await request('/workspace/movements?from=2026-02-31')).status,400);
 assert.equal((await workspace.allocations({q:'GUARDS-200'})).total,0);
});
test('matching amount and nearby date work with another payer, while two competing documents remain pending',async()=>{
 const d=await doc('CLIENT-2640','2640.50'),b=await bank('2640.50');
 await db.query("UPDATE ledens.bank_movements SET type='TOPUP',description='Payment from Otro Pagador',is_internal_transfer=NULL WHERE id=$1",[b]);
 await db.query("INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status,invoice_currency,date_confidence,total_confidence,direction_confidence) VALUES($1,$2,'customer.pdf','application/pdf','archived','EUR',.9,.9,.9)",[d,randomUUID()]);
 assert.equal((await service.evaluate(d,{force:true})).status,'matched');
 const event=(await db.query("SELECT detail FROM ledens.bridge_events WHERE document_id=$1 AND action='auto_confirmed'",[d])).rows[0].detail;assert.equal(event.party,false);assert.equal(event.evidence_mode,'amount_near_date');
 assert.equal((await workspace.movements()).rows.some(r=>r.id===b),false);
 const a=await doc('AMB-1','77'),other=await doc('AMB-2','77');await bank('77');
 for(const id of [a,other])await db.query("INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status,invoice_currency,date_confidence,total_confidence,direction_confidence) VALUES($1,$2,'amb.pdf','application/pdf','archived','EUR',.9,.9,.9)",[id,randomUUID()]);
 assert.equal((await service.evaluate(a,{force:true})).reason,'competing_document');
});
test('a reviewed direction correction is audited without another document or payment',async()=>{
 const d=await doc('REFUND-MANUAL','6.44','Pagar'),b=await bank('6.44'),body=await confirmation(d,b,'6.44');
 assert.equal((await request('/'+d+'/confirm',{method:'POST',body})).status,200);
 assert.equal((await db.query('SELECT tipo FROM ledens.documents WHERE id=$1',[d])).rows[0].tipo,'Cobrar');
 assert.equal((await workspace.allocations({q:'REFUND-MANUAL'})).total,1);
 const detail=(await db.query("SELECT detail FROM ledens.bridge_events WHERE document_id=$1 AND action='manual_confirmed'",[d])).rows[0].detail;
 assert.equal(detail.document_before.tipo,'Pagar');assert.equal(detail.document_after.tipo,'Cobrar');
});
test('PostgreSQL simultaneous manual saves cannot spend a bank balance twice',{skip:!process.env.BRIDGE_WORKSPACE_TEST_DATABASE_URL},async()=>{
 const a=await doc('RACE-A','-33'),b=await doc('RACE-B','-33'),movement=await bank('-33');
 const first=await confirmation(a,movement,'33.00'),second=await confirmation(b,movement,'33.00');
 const result=await Promise.all([request('/'+a+'/confirm',{method:'POST',body:first}),request('/'+b+'/confirm',{method:'POST',body:second})]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 assert.equal(Number((await db.query("SELECT sum(abs(allocated_amount)) n FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 AND state='Confirmado'",[movement])).rows[0].n),33);
});
test('the new rule queues pending verified invoices without changing dismissed or already linked documents',async()=>{
 const d=await doc('RETRY-RULE','88');await db.query("INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status,invoice_currency,date_confidence,total_confidence,direction_confidence) VALUES($1,$2,'retry.pdf','application/pdf','archived','EUR',.9,.9,.9)",[d,randomUUID()]);
 await db.query("UPDATE ledens.bridge_cases SET next_attempt_at='infinity' WHERE document_id=$1",[d]);
 const dismissed=await doc('DISMISSED','99');await db.query("UPDATE ledens.bridge_cases SET status='dismissed',next_attempt_at='infinity' WHERE document_id=$1",[dismissed]);
 await db.exec(await fs.readFile(new URL('../src/db/migrations/016_bridge_amount_near_date.sql',import.meta.url),'utf8'));
 assert.ok(Number.isFinite(+new Date((await db.query('SELECT next_attempt_at FROM ledens.bridge_cases WHERE document_id=$1',[d])).rows[0].next_attempt_at)));
 assert.equal((await db.query('SELECT status FROM ledens.bridge_cases WHERE document_id=$1',[dismissed])).rows[0].status,'dismissed');
});
