import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {ProjectsService} from '../src/finanzas/projects.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// Proyectos on PGlite: the shared finance fixture plus the production columns of
// ledens.projects, ledens.customers and ledens.project_statuses. Synthetic rows only.
let db,pool,admin,jefe,client,st1,st2,cust,imported;
const as=(u)=>new ProjectsService(pool,u);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text; ALTER TABLE audit_log ADD COLUMN target_label text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`CREATE TABLE ledens.customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text UNIQUE,display_name text NOT NULL);
  CREATE TABLE ledens.project_statuses(id uuid PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL);
  ALTER TABLE ledens.projects ADD COLUMN source_id text UNIQUE,ADD COLUMN raw_id uuid UNIQUE,ADD COLUMN customer_name_source text,ADD COLUMN salesman text,
   ADD COLUMN start_date date,ADD COLUMN municipio text,ADD COLUMN provincia text,ADD COLUMN customer_id uuid REFERENCES ledens.customers(id),
   ADD COLUMN status_id uuid REFERENCES ledens.project_statuses(id),ADD COLUMN end_date date,ADD CHECK ((source_id IS NULL)=(raw_id IS NULL));`);
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@pr.test','admin','Admin Test'),('jefe@pr.test','jefe','Jefe Test') RETURNING id,role,name")).rows;
 client={id:jefe.id,role:'client'};
 [st1,st2]=(await db.query("INSERT INTO ledens.project_statuses(id,code,name) VALUES(gen_random_uuid(),'EN_CURSO','En curso'),(gen_random_uuid(),'CERRADO','Cerrado') RETURNING id")).rows.map(r=>r.id);
 cust=(await db.query("INSERT INTO ledens.customers(display_name) VALUES('Cliente Prueba') RETURNING id")).rows[0].id;
 imported=(await db.query("INSERT INTO ledens.projects(project_id,name,source_id,raw_id) VALUES('IMP-001','Importado',$1,gen_random_uuid()) RETURNING id",['legacy-1'])).rows[0].id;
});
after(()=>db?.close());

test('an admin creates a project with its real fields and the change is audited',async()=>{
 const p=await as(admin).create({code:' OBRA-100 ',name:'Reforma ático',customerId:cust,salesman:'Comercial X',address:'C/ Prueba 1',municipio:'Marbella',provincia:'Málaga',statusId:st1,startDate:'2026-10-01',endDate:'2026-12-15'});
 assert.equal(p.code,'OBRA-100');assert.equal(p.name,'Reforma ático');assert.equal(p.cliente,'Cliente Prueba');assert.equal(p.customer_name_source,'Cliente Prueba','text name defaults to the customer');
 assert.equal(p.estado,'En curso');assert.equal(p.start_date,'2026-10-01');assert.equal(p.end_date,'2026-12-15');assert.equal(p.importado,false);
 const row=(await db.query('SELECT source_id,raw_id,municipio FROM ledens.projects WHERE id=$1',[p.id])).rows[0];
 assert.deepEqual(row,{source_id:null,raw_id:null,municipio:'Marbella'});
 const a=(await db.query("SELECT actor_label,detail FROM audit_log WHERE action='Proyecto creado' ORDER BY id DESC LIMIT 1")).rows[0];
 assert.equal(a.actor_label,'Admin Test');assert.match(a.detail,/Reforma ático \(OBRA-100\)/);
});

test('validation: name required, unique code (any case), coherent dates, real status and client',async()=>{
 await assert.rejects(as(admin).create({name:'  '}),{status:400,message:/nombre/});
 await assert.rejects(as(admin).create({name:'Otra',code:'obra-100'}),{status:409,message:/OBRA-100|obra-100/});
 await assert.rejects(as(admin).create({name:'Otra',startDate:'2026-10-10',endDate:'2026-10-01'}),{status:400,message:/fin/});
 await assert.rejects(as(admin).create({name:'Otra',startDate:'10/10/2026'}),{status:400});
 await assert.rejects(as(admin).create({name:'Otra',statusId:'00000000-0000-0000-0000-000000000000'}),{status:400,message:/Estado/});
 await assert.rejects(as(admin).create({name:'Otra',customerId:'no-uuid'}),{status:400,message:/Cliente/});
 const p=await as(admin).create({name:'Sin código'});assert.equal(p.code,null,'a project without code is allowed');
});

test('editing needs the version that was shown and audits exactly what changed',async()=>{
 const p=(await as(admin).list({q:'OBRA-100'})).rows[0];
 const u=await as(admin).update(p.id,{...form(p),name:'Reforma ático y terraza',statusId:st2,version:p.version});
 assert.equal(u.changed,true);assert.equal(u.name,'Reforma ático y terraza');assert.equal(u.estado,'Cerrado');assert.notEqual(u.version,p.version);
 const a=(await db.query("SELECT detail FROM audit_log WHERE action='Proyecto editado' ORDER BY id DESC LIMIT 1")).rows[0].detail;
 assert.equal(a,'Nombre: Reforma ático → Reforma ático y terraza · Estado: En curso → Cerrado');
 await assert.rejects(as(admin).update(p.id,{...form(p),name:'Pisado',version:p.version}),{status:409},'stale version is refused');
 const same=await as(admin).update(u.id,{...form(u),version:u.version});assert.equal(same.changed,false);
 await assert.rejects(as(admin).update(u.id,{...form(u),code:'IMP-001',version:u.version}),{status:409},'cannot take another project code');
});

test('imported projects are flagged and stay editable',async()=>{
 const p=(await as(admin).list({q:'IMP-001'})).rows[0];
 assert.equal(p.importado,true);
 const u=await as(admin).update(imported,{...form(p),municipio:'Antequera',version:p.version});
 assert.equal(u.municipio,'Antequera');
 assert.equal((await db.query('SELECT source_id FROM ledens.projects WHERE id=$1',[imported])).rows[0].source_id,'legacy-1','provenance untouched');
});

test('jefes only see granted projects and cannot create or edit; clients see nothing',async()=>{
 const p=(await as(admin).list({q:'OBRA-100'})).rows[0];
 assert.equal((await as(jefe).list()).total,0);
 await db.query('INSERT INTO ledens.finance_project_permissions(user_id,project_id,can_write) VALUES($1,$2,true)',[jefe.id,p.id]);
 const l=await as(jefe).list();assert.deepEqual(l.rows.map(r=>r.id),[p.id]);assert.equal(l.canEdit,false);
 await assert.rejects(as(jefe).create({name:'X'}),{status:403});
 await assert.rejects(as(jefe).update(p.id,{...form(p),version:p.version}),{status:403});
 await assert.rejects(as(client).list(),{status:403});
});

test('list filters by text and status; options list statuses and clients',async()=>{
 assert.ok((await as(admin).list({q:'marbella'})).rows.every(r=>r.municipio==='Marbella'));
 assert.ok((await as(admin).list({estado:st2})).rows.every(r=>r.estado==='Cerrado'));
 await assert.rejects(as(admin).list({estado:'x'}),{status:400});
 const o=await as(admin).options();assert.deepEqual(o.statuses.map(s=>s.name),['Cerrado','En curso']);assert.equal(o.customers[0].name,'Cliente Prueba');assert.equal(o.canEdit,true);
});

test('HTTP: writes need the allowed origin and a non-client role',async()=>{
 const app=express();app.use(express.json());
 app.use('/api/finanzas',createFinanzasRouter({service:{},projects:as(admin),origin:'https://ledens.test',authenticate:(req,_res,next)=>{req.user=req.get('x-role')==='client'?client:admin;next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/finanzas/gestion-proyectos`;
 try{
  const post=(headers)=>fetch(base,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({name:'Desde HTTP',code:'HTTP-1'})});
  assert.equal((await post({origin:'https://evil.test'})).status,403);
  assert.equal((await post({origin:'https://ledens.test','x-role':'client'})).status,403);
  const ok=await post({origin:'https://ledens.test'});assert.equal(ok.status,201);assert.equal((await ok.json()).project.code,'HTTP-1');
  const list=await (await fetch(base+'?q=HTTP')).json();assert.equal(list.total,1);
 }finally{server.close();}
});

// The edit form sends every field back, as the page does.
function form(p){return {code:p.code,name:p.name,customerId:p.customer_id,customerName:p.customer_name_source,salesman:p.salesman,address:p.address,
 municipio:p.municipio,provincia:p.provincia,statusId:p.status_id,startDate:p.start_date,endDate:p.end_date};}
