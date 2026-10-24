import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {AlertService,formatAlert} from '../src/notifications/service.js';
let db,pool;
before(async()=>{
 if(process.env.NOTIFICATIONS_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.NOTIFICATIONS_TEST_DATABASE_URL});db={exec:q=>pool.query(q),query:(...a)=>pool.query(...a),close:()=>pool.end()};}
 else {const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a)};}
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','011_transaction_alerts.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
});after(()=>db?.close());
test('transaction email queue captures changes once and supports lease, retry and acknowledgement',async()=>{
 const doc=(await db.query("INSERT INTO ledens.documents(total,tipo,numerodocumento) VALUES(-25,'Pagar','MAIL-TEST') RETURNING id")).rows[0].id;
 const ingestion=(await db.query("INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status) VALUES($1,$2,'MAIL-TEST.pdf','application/pdf','received') RETURNING id",[doc,randomUUID()])).rows[0].id;
 await db.query("UPDATE ledens.invoice_ingestions SET status='review',reason='invoice_date_requires_review' WHERE id=$1",[ingestion]);
 await db.query("UPDATE ledens.invoice_ingestions SET updated_at=now() WHERE id=$1",[ingestion]);
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.transaction_alerts WHERE document_id=$1',[doc])).rows[0].n,2);
 await db.query("UPDATE ledens.transaction_alerts SET delivered_at=now() WHERE document_id IS DISTINCT FROM $1",[doc]);
 const alerts=new AlertService(pool),first=await alerts.claim();assert.equal(first.messages.length,2);assert.equal((await alerts.claim()).messages.length,0);
 const msg=first.messages.find(x=>x.subject.includes('Revisión'));assert.ok(msg.html.includes('fecha del documento'));assert.ok(msg.html.includes('MAIL-TEST'));
 assert.equal(await alerts.acknowledge(msg.id,randomUUID(),true),false);assert.equal(await alerts.acknowledge(msg.id,msg.lease_token,false),true);
 await db.query("UPDATE ledens.transaction_alerts SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[msg.id]);
 const retried=(await alerts.claim()).messages[0];assert.equal(retried.id,msg.id);assert.equal(await alerts.acknowledge(retried.id,retried.lease_token,true),true);assert.equal(await alerts.acknowledge(retried.id,retried.lease_token,true),false);
 await alerts.error({type:'bridge',documentId:doc,reason:'test_failure'});await alerts.error({type:'bridge',documentId:doc,reason:'test_failure'});assert.equal((await db.query("SELECT count(*)::int n FROM ledens.transaction_alerts WHERE document_id=$1 AND status='error'",[doc])).rows[0].n,1);
 const safe=formatAlert({id:randomUUID(),event_type:'ingestion',status:'review',payload:{filename:'<script>alert(1)</script>\r\nx'},reason:'invoice_date_requires_review'});assert.ok(!safe.html.includes('<script>'));assert.ok(!safe.subject.includes('\n'));
});

test('successful Bridge alerts contain transaction details, duplicates and rollback preserve correctness',async()=>{
 const doc=(await db.query("INSERT INTO ledens.documents(total,tipo,numerodocumento) VALUES(-40,'Pagar','MAIL-SUCCESS') RETURNING id")).rows[0].id;
 const i=(await db.query("INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status) VALUES($1,$2,'success.pdf','application/pdf','ready') RETURNING id",[doc,randomUUID()])).rows[0].id;
 await db.query("INSERT INTO ledens.invoice_sources(source_key,ingestion_id,source_item_id,filename,is_duplicate) VALUES($1,$2,'duplicate-item','success.pdf',true)",[randomUUID(),i]);
 const bank=(await db.query("INSERT INTO ledens.bank_movements(total_amount,amount,currency,description,reference) VALUES(-40,-40,'EUR','Proveedor de prueba','MAIL-SUCCESS') RETURNING id")).rows[0].id;
 const a=(await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$2,-40,'Confirmado') RETURNING id",[doc,bank])).rows[0].id;
 await db.query('UPDATE ledens.bank_document_allocations SET reconciled_on=CURRENT_DATE WHERE id=$1',[a]);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.transaction_alerts WHERE document_id=$1 AND event_type='allocation'",[doc])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM ledens.transaction_alerts WHERE document_id=$1 AND status='duplicate'",[doc])).rows[0].n,1);
 await db.exec('BEGIN');await db.query("UPDATE ledens.bank_document_allocations SET state='Revisar' WHERE id=$1",[a]);await db.exec('ROLLBACK');assert.equal((await db.query("SELECT count(*)::int n FROM ledens.transaction_alerts WHERE document_id=$1 AND status='Revisar'",[doc])).rows[0].n,0);
 const msg=(await new AlertService(pool).claim()).messages.find(x=>x.subject.includes('confirmada'));assert.ok(msg.html.includes('MAIL-SUCCESS'));assert.ok(msg.html.includes(bank));assert.ok(msg.html.includes('Proveedor de prueba'));
});
