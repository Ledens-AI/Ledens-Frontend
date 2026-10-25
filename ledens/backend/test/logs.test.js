import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {traced,setRunLogPool,RunLogService,startRun} from '../src/logs/runs.js';
import {createIngestionRouter} from '../src/routes/ingestion.js';
import {FinError} from '../src/finanzas/service.js';
// Logs de transacciones on PGlite: users + migration 014 only. Synthetic data.
let db,pool,admin,server,base;
const runs=async()=>(await db.query('SELECT * FROM ledens.process_runs ORDER BY started_at,id')).rows;
const settle=()=>new Promise((r)=>setTimeout(r,60)); // finish is written after the response
before(async()=>{
 db=new PGlite();pool={query:(...a)=>db.query(...a)};
 await db.exec("CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,name text,role text); CREATE SCHEMA ledens;");
 await db.exec(await fs.readFile(new URL('../src/db/migrations/014_process_runs.sql',import.meta.url),'utf8'));
 admin=(await db.query("INSERT INTO users(email,name,role) VALUES('admin@lg.test','Admin Logs','admin') RETURNING id,name,role")).rows[0];
 setRunLogPool(pool);
 const app=express();app.use(express.json());
 const user=(req,_res,next)=>{req.user=admin;next();};
 app.post('/ok',user,traced('imputacion','Asignación de prueba',{entity:req=>({type:'registro',id:'r-1'}),summary:b=>({message:'Asignado a Obra X',detail:{n:b.n}})})(async(req,res)=>res.json({n:3})));
 app.post('/refused',user,traced('proyectos','Alta de prueba')(async()=>{throw new FinError(409,'El código ya existe');}));
 app.post('/broken',traced('bridge','Conciliación de prueba')(async()=>{const e=new Error('connection terminated: password=secret');e.code='57P01';throw e;}));
 app.post('/poll',traced('ocr','Sondeo',{summary:b=>(b.status==='analyzing'?{discard:true}:{})})(async(req,res)=>res.json({status:'analyzing'})));
 app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.status?e.message:'internal'}));
 const tokenHash=createHash('sha256').update('t'.repeat(43)).digest('hex');
 let processCalls=0;
 const service={process:async(id)=>(++processCalls===1?{ingestion_id:id,status:'analyzing'}:{ingestion_id:id,document_id:'d-1',status:'ready',invoice_date:'2026-09-30'}),
  archived:async(id)=>({ingestion_id:id,document_id:'d-1',status:'archived',destination_folder:'/Shared Documents/datasource/3T-2026'})};
 app.use('/ingesta',createIngestionRouter({service,tokenHash,config:{site:'https://x.sharepoint.com/sites/s',folder:'f',archiveRoot:'datasource'}}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{server?.close();setRunLogPool(null);await db?.close();});
const post=(p,headers={},body={})=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

test('a successful process is logged from start to finish with duration, actor, entity and summary',async()=>{
 assert.equal((await post('/ok')).status,200);await settle();
 const r=(await runs()).find(x=>x.step==='Asignación de prueba');
 assert.equal(r.process,'imputacion');assert.equal(r.status,'ok');assert.ok(r.finished_at);assert.ok(r.duration_ms>=0);
 assert.equal(r.actor_label,'Admin Logs');assert.equal(r.actor_id,admin.id);assert.equal(r.entity_type,'registro');assert.equal(r.entity_id,'r-1');
 assert.equal(r.message,'Asignado a Obra X');assert.equal(r.detail.n,3);assert.equal(r.http_status,200);
});

test('a refused request is «rechazado» with its readable message; a technical failure is «error» with only its code',async()=>{
 assert.equal((await post('/refused')).status,409);
 assert.equal((await post('/broken')).status,500);await settle();
 const refused=(await runs()).find(x=>x.step==='Alta de prueba');
 assert.equal(refused.status,'rechazado');assert.equal(refused.message,'El código ya existe');assert.equal(refused.http_status,409);
 const broken=(await runs()).find(x=>x.step==='Conciliación de prueba');
 assert.equal(broken.status,'error');assert.equal(broken.error_code,'57P01');assert.equal(broken.actor_label,'Automatización (Logic App)');
 assert.ok(!JSON.stringify(broken).includes('secret'),'exception texts are never stored');
});

test('intermediate polls are discarded; the OCR outcome and the archive are logged',async()=>{
 const id='11111111-1111-1111-1111-111111111111',auth={authorization:'Bearer '+'t'.repeat(43)};
 assert.equal((await post('/poll')).status,200);
 assert.equal((await post(`/ingesta/${id}/process`,auth)).status,200); // analyzing → discarded
 assert.equal((await post(`/ingesta/${id}/process`,auth)).status,200); // ready → logged
 assert.equal((await post(`/ingesta/${id}/archive`,auth,{archive_url:'x'})).status,200);await settle();
 const all=await runs();
 assert.ok(!all.some(x=>x.step==='Sondeo'));
 const ocr=all.filter(x=>x.process==='ocr');assert.equal(ocr.length,1);assert.equal(ocr[0].message,'Datos extraídos');assert.equal(ocr[0].entity_id,id);
 const arch=all.find(x=>x.process==='archivo');assert.equal(arch.status,'ok');assert.match(arch.message,/3T-2026/);
});

test('the log page lists, filters and summarises, and only for admins',async()=>{
 await db.query("INSERT INTO ledens.process_runs(process,step,started_at) VALUES('bridge','Colgado',now()-interval '1 hour')");
 await db.query("INSERT INTO ledens.process_runs(process,step,status,finished_at,detail) VALUES('alertas','Recogida de alertas','ok',now(),'{\"vacio\":true}')");
 const svc=new RunLogService(pool,admin);
 const l=await svc.list();
 assert.ok(!l.rows.some(r=>r.step==='Recogida de alertas'),'empty polls hidden by default');
 assert.ok((await svc.list({empty:true})).rows.some(r=>r.step==='Recogida de alertas'));
 assert.deepEqual((await svc.list({status:'sin_terminar'})).rows.map(r=>r.step),['Colgado']);
 const problems=(await svc.list({status:'problemas'})).rows.map(r=>r.step).sort();
 assert.deepEqual(problems,['Alta de prueba','Colgado','Conciliación de prueba']);
 assert.equal((await svc.list({process:'ocr'})).total,1);
 assert.equal((await svc.list({q:'Obra X'})).total,1);
 await assert.rejects(svc.list({process:'nada'}),{status:400});
 const s=await svc.summary();
 const bridge=s.last24h.find(x=>x.process==='bridge');assert.equal(bridge.errores,1);assert.equal(bridge.sin_terminar,1);
 const alertas=s.last24h.find(x=>x.process==='alertas');assert.equal(alertas.total,0,'empty poll not counted');assert.ok(alertas.ultima,'but it shows the automation is alive');
 await assert.rejects(new RunLogService(pool,{role:'jefe'}).list(),{status:403});
});

test('logging never breaks the process: a broken log table still lets the request succeed',async()=>{
 setRunLogPool({query:async()=>{throw Object.assign(new Error('relation does not exist'),{code:'42P01'});}});
 try{
  assert.equal(await startRun({process:'ingesta',step:'x'}),null);
  const r=await post('/ok');assert.equal(r.status,200);assert.deepEqual(await r.json(),{n:3});
 }finally{setRunLogPool(pool);}
});
