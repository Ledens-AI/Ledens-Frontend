import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {FinanzasService} from '../src/finanzas/service.js';
import {createFinanzasRouter} from '../src/routes/finanzas.js';
// Documentos sin asignar on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,docs={};
const asAdmin=()=>new FinanzasService(pool,admin);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@ds.test','admin','Admin'),('jefe@ds.test','jefe','Jefe') RETURNING id,role")).rows;
 const doc=async(total,tipo,numero,on='2026-10-08',link=null)=>(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero,enlacearchivo)
  VALUES($1,$2,$3,$4,'Tercero '||$4,'B12345678',$5) RETURNING id`,[total,tipo,on,numero,link])).rows[0].id;
 const bank=async(amount)=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES(gen_random_uuid()::text,$1,$1,'2026-10-10','Mov','EUR','COMPLETED') RETURNING id`,[amount])).rows[0].id;
 const link=async(d,amount,state)=>db.query('INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,$4,$5)',[await bank(amount),d,amount,state,'2026-10-10']);
 docs.free=await doc(-120,'Pagar','F-LIBRE','2026-10-08','https://ledens.sharepoint.com/f.pdf');
 docs.issued=await doc(900,'Cobrar','F-EMITIDA','2026-10-01','https://evil.test/f.pdf');
 docs.review=await doc(-40,'Pagar','F-REVISION');await link(docs.review,-40,'Propuesto');
 docs.done=await doc(-80,'Pagar','F-CONCILIADA');await link(docs.done,-80,'Confirmado');
 docs.partial=await doc(-100,'Pagar','F-PARCIAL');await link(docs.partial,-30,'Confirmado');
 await doc(0,'Pagar','F-CERO');
});
after(()=>db?.close());

test('lists processed documents with no confirmed movement, with their Bridge state and safe file link',async()=>{
 const r=await asAdmin().unassignedDocuments({pageSize:100});
 assert.deepEqual(r.rows.map(x=>x.numerodocumento).sort(),['F-EMITIDA','F-LIBRE','F-REVISION']);
 assert.deepEqual(r.importes,{pagar:'160',cobrar:'900'});
 const free=r.rows.find(x=>x.numerodocumento==='F-LIBRE');
 assert.deepEqual([free.archivo,free.bridge_estado,free.revision,free.tipo],['https://ledens.sharepoint.com/f.pdf','pending',0,'Pagar']);
 assert.equal(r.rows.find(x=>x.numerodocumento==='F-EMITIDA').archivo,null,'only SharePoint links are passed on');
 assert.equal(r.rows.find(x=>x.numerodocumento==='F-REVISION').revision,1);
 assert.equal((await asAdmin().unassignedDocuments({tipo:'Cobrar'})).total,1);
 assert.equal((await asAdmin().unassignedDocuments({estado:'revision'})).total,1);
 assert.equal((await asAdmin().unassignedDocuments({q:'libre'})).total,1);
 assert.equal((await asAdmin().unassignedDocuments({from:'2026-10-05'})).total,2);
 await assert.rejects(asAdmin().unassignedDocuments({tipo:'Otro'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).unassignedDocuments(),{status:403});
});

test('HTTP: the route answers with the filters applied',async()=>{
 const app=express();app.use('/api/finanzas',createFinanzasRouter({service:asAdmin(),authenticate:(req,_res,next)=>{req.user={...admin};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/finanzas/documentos-sin-asignar?tipo=Pagar`);assert.equal(res.status,200);assert.equal((await res.json()).total,2);}
 finally{server.close();}
});
