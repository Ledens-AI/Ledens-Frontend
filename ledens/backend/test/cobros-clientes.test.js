import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {FinanzasService} from '../src/finanzas/service.js';
import {BridgeWorkspace} from '../src/bridge/workspace.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// «Pago de clientes» from Pendiente de conciliación on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,p1;
const asAdmin=()=>new FinanzasService(pool,admin);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql','027_transferencias_internas.sql','028_treasury_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@cc.test','admin','Admin'),('jefe@cc.test','jefe','Jefe') RETURNING id,role")).rows;
 p1=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Marbella','OBRA-001') RETURNING id")).rows[0].id;
});
after(()=>db?.close());
const movement=async(amount,extra={})=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,payer,currency,state,is_internal_transfer)
 VALUES($1,$2,$2,$3,'Transferencia recibida',$4,$5,'COMPLETED',$6) RETURNING id`,[extra.source||'MOV-'+Math.random().toString(36).slice(2,8),amount,extra.date||'2026-10-15',extra.payer??'Cliente Uno',extra.currency||'EUR',extra.internal??false])).rows[0].id;
const inInbox=async(id)=>(await asAdmin().reconciliation({view:'movimientos',pageSize:100})).rows.some(r=>r.id===id);

test('an unrecognised receipt becomes a client payment on a project and leaves Pendiente de conciliación',async()=>{
 const m=await movement('1500.00',{source:'4T2026-501',payer:'Elske Cliente'});
 assert.equal(await inInbox(m),true);
 const counts=new BridgeWorkspace(pool);const before=(await counts.counts()).reconciliation;
 await assert.rejects(new FinanzasService(pool,jefe).classifyCustomerPayments({movementIds:[m]}),{status:403});
 const res=await asAdmin().classifyCustomerPayments({movementIds:[m],projectId:p1});
 assert.deepEqual([res.ok,res.failed],[1,0]);
 assert.equal(await inInbox(m),false,'it leaves the inbox');
 assert.equal((await counts.counts()).reconciliation,before-1,'and the menu counter');
 const cp=(await db.query('SELECT total::text,cliente,id_pago,occurred_on::text FROM ledens.customer_payments WHERE bank_movement_id=$1',[m])).rows;
 assert.deepEqual(cp,[{total:'1500.00',cliente:'Elske Cliente',id_pago:'4T2026-501',occurred_on:'2026-10-15'}]);
 const r=(await db.query('SELECT r.category,r.bank_movement_id,a.project_id FROM ledens.financial_records r JOIN ledens.customer_payments c ON c.id=r.customer_payment_id LEFT JOIN ledens.project_financial_allocations a ON a.record_id=r.id WHERE c.bank_movement_id=$1',[m])).rows[0];
 assert.deepEqual(r,{category:'advance',bank_movement_id:m,project_id:p1},'a client receipt of the project');
 const list=await asAdmin().listRecords({type:'cliente',pageSize:100});
 assert.ok(list.rows.some(x=>x.tercero==='Elske Cliente'),'it shows in Pagos de clientes');
 // The same movement cannot be recorded twice.
 assert.match((await asAdmin().classifyCustomerPayments({movementIds:[m]})).results[0].error,/Ya está registrado/);
});

test('without a project it waits in Pendientes de asignación; only incoming euro movements without another use',async()=>{
 const free=await movement('300.00');
 const res=await asAdmin().classifyCustomerPayments({movementIds:[free]});
 assert.equal(res.ok,1);
 const rec=(await db.query('SELECT count(*)::int n FROM ledens.project_financial_allocations a JOIN ledens.financial_records r ON r.id=a.record_id JOIN ledens.customer_payments c ON c.id=r.customer_payment_id WHERE c.bank_movement_id=$1',[free])).rows[0].n;
 assert.equal(rec,0);
 const out=await movement('-50.00'),usd=await movement('80.00',{currency:'USD'}),internal=await movement('900.00',{internal:true}),ok=await movement('45.00');
 const r=await asAdmin().classifyCustomerPayments({movementIds:[out,usd,internal,ok]});
 assert.deepEqual(r.results.map(x=>x.ok),[false,false,false,true]);
 assert.match(r.results[0].error,/cobros/);assert.match(r.results[1].error,/euros/);assert.match(r.results[2].error,/traspaso/);
 assert.equal(await inInbox(out),true,'the refused ones stay in the inbox');
 await assert.rejects(asAdmin().classifyCustomerPayments({movementIds:[await movement('10.00')],projectId:'00000000-0000-4000-8000-000000000000'}),{status:400});
});

test('Pagos de clientes always shows a client',async()=>{
 await db.exec('ALTER TABLE ledens.projects ADD COLUMN IF NOT EXISTS customer_name_source text');
 const proj=(await db.query("INSERT INTO ledens.projects(name,project_id,customer_name_source) VALUES('Nerja','OBRA-002','Cliente de la Obra') RETURNING id")).rows[0].id;
 // A receipt with no ordering party takes the obra's client when it is recorded.
 const m=await movement('210.00',{payer:''});
 await asAdmin().classifyCustomerPayments({movementIds:[m],projectId:proj});
 assert.equal((await db.query('SELECT cliente FROM ledens.customer_payments WHERE bank_movement_id=$1',[m])).rows[0].cliente,'Cliente de la Obra');
 // Rows recorded before without a client are read from the movement, the obra, or flagged.
 const legacy=async(bank,project)=>{const c=(await db.query('INSERT INTO ledens.customer_payments(occurred_on,id_pago,total,bank_movement_id) VALUES($1,$2,$3,$4) RETURNING id',['2026-10-20','X'+Math.random(),'99.00',bank])).rows[0].id;
  const r=(await db.query('UPDATE ledens.financial_records SET counterparty=NULL WHERE customer_payment_id=$1 RETURNING id,version,gross_amount',[c])).rows[0];
  if(project)await asAdmin().finance.replace(pool,admin,{record_id:r.id,version:r.version,allocations:[{project_id:project,amount:r.gross_amount}]},'test');return c;};
 const fromBank=await legacy(await movement('99.00',{payer:'Ordenante Banco'})),fromProject=await legacy(null,proj),none=await legacy(null);
 const rows=(await asAdmin().listRecords({type:'cliente',pageSize:100})).rows,by=id=>rows.find(r=>r.id===id)?.tercero;
 assert.deepEqual([by(fromBank),by(fromProject),by(none)],['Ordenante Banco','Cliente de la Obra','Cliente sin identificar']);
 assert.ok(rows.every(r=>r.tercero),'never empty');
});

test('HTTP: admins only and the allowed origin',async()=>{
 const app=express();app.use(express.json());
 app.use('/api/finanzas',createFinanzasRouter({service:asAdmin(),origin:'https://ledens.test',authenticate:(req,_res,next)=>{req.user=req.get('x-role')==='client'?{id:jefe.id,role:'client'}:{...admin};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/finanzas/conciliacion/pago-clientes`;
 try{
  const m=await movement('70.00');
  const post=(headers)=>fetch(base,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({movementIds:[m]})});
  assert.equal((await post({origin:'https://evil.test'})).status,403);
  assert.equal((await post({'x-role':'client',origin:'https://ledens.test'})).status,403);
  const ok=await post({origin:'https://ledens.test'});assert.equal(ok.status,200);assert.equal((await ok.json()).ok,1);
 }finally{server.close();}
});
