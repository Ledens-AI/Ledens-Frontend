import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinanzasService} from '../src/finanzas/service.js';
// «Gastos operacionales»: the costs imputed to the company's own «Gastos
// operacionales» / «Gastos operativos» projects, month by month, and the
// records of one month. Same records and amounts as Rentabilidad por proyecto.
let db,pool,svc,admin,jefe,opex,opex2,obra;
before(async()=>{
 if(process.env.FINANZAS_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.FINANZAS_TEST_DATABASE_URL});db={exec:q=>pool.query(q),query:(...a)=>pool.query(...a),close:()=>pool.end()};}
 else {const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 await db.exec('ALTER TABLE public.audit_log ADD COLUMN target_label text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql','027_transferencias_internas.sql','028_treasury_movements.sql','030_efectivo_importado.sql','051_categorias_gastos_operacionales.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role) VALUES('admin@opex.test','admin'),('jefe@opex.test','jefe') RETURNING id,role")).rows;
 [opex,opex2,obra]=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Gastos Operacionales','P2026-001'),('GASTOS OPERATIVOS 2025','P2025-099'),('Reforma Marbella','P2026-002') RETURNING id")).rows.map(x=>x.id);
 svc=new FinanzasService(pool,admin);
});
after(()=>db?.close());
const material=async(total,description,on)=>{const id=(await db.query('INSERT INTO ledens.material_expenses(total,description,occurred_on) VALUES($1,$2,$3) RETURNING id',[total,description,on])).rows[0].id;return svc.getRecord('material',id);};
const assign=(r,projectId)=>svc.assign({type:r.type,id:r.id,projectId,version:r.version,requestId:randomUUID(),reason:'Asignación revisada'});

test('gastos operacionales: the costs of the company\'s own projects, month by month',async()=>{
 // Imported materials carry a negative total: their record is a positive cost.
 await assign(await material(-300,'Alquiler oficina','2026-01-05'),opex);
 await assign(await material(-120.50,'Seguro furgoneta','2026-01-20'),opex2);
 await assign(await material(-80,'Gestoría','2026-03-02'),opex);
 await assign(await material(-1000,'Cemento obra','2026-01-10'),obra); // an obra: never an operating expense
 const wid=(await db.query("INSERT INTO ledens.worker_payments(amount,occurred_on,empleado) VALUES(-450,'2026-03-15','Pepe') RETURNING id")).rows[0].id;
 await assign(await svc.getRecord('trabajador',wid),opex);
 // A client payment imputed there is an income, not a cost: it is left out.
 const cid=(await db.query("INSERT INTO ledens.customer_payments(total,cliente,occurred_on) VALUES(999,'Cliente','2026-01-11') RETURNING id")).rows[0].id;
 await assign(await svc.getRecord('cliente',cid),opex);

 const d=await svc.operatingExpenses({});
 assert.deepEqual(d.proyectos.map(p=>p.label).sort(),['GASTOS OPERATIVOS 2025','Gastos Operacionales'],'matched by name, any case, and never an obra');
 assert.equal(Number(d.totales.total),950.5);assert.equal(Number(d.totales.materiales),500.5);assert.equal(Number(d.totales.trabajadores),450);
 assert.equal(d.totales.movimientos,4);
 assert.deepEqual(d.meses.map(m=>[m.mes,Number(m.total),m.movimientos]),[['2026-01',420.5,2],['2026-03',530,2]]);
 assert.equal(Number(d.meses[1].trabajadores),450);
 assert.equal(d.total,4);assert.ok(d.rows.every(r=>[opex,opex2].includes(r.project_id)));

 // Clicking a month: the table shows its records; the chart and totals keep every month.
 const enero=await svc.operatingExpenses({month:'2026-01'});
 assert.deepEqual(enero.rows.map(r=>r.concepto).sort(),['Alquiler oficina','Seguro furgoneta']);
 assert.equal(enero.total,2);assert.equal(enero.meses.length,2);assert.equal(Number(enero.totales.total),950.5);
 assert.equal(Number(enero.rows.find(r=>r.concepto==='Alquiler oficina').gasto),300);

 // One project: its own months; `proyectos` keeps both, with their totals.
 const one=await svc.operatingExpenses({project:opex2});
 assert.equal(Number(one.totales.total),120.5);assert.deepEqual(one.meses.map(m=>m.mes),['2026-01']);
 assert.equal(Number(one.proyectos.find(p=>p.id===opex).total),830);
 assert.equal(Number((await svc.projectResults({project:opex})).totales.costes),830,'the same figure as «Costes» in Rentabilidad por proyecto');
 assert.equal((await svc.operatingExpenses({tipo:'trabajadores'})).total,1);
 assert.equal((await svc.operatingExpenses({q:'gestor'})).total,1);
 assert.equal((await svc.operatingExpenses({from:'2026-03-01'})).meses.length,1);
});

test('gastos operacionales: invalid filters, other projects and roles',async()=>{
 await assert.rejects(svc.operatingExpenses({project:obra}),{status:400});
 await assert.rejects(svc.operatingExpenses({month:'2026-13'}),{status:400});
 await assert.rejects(svc.operatingExpenses({tipo:'ingresos'}),{status:400});
 await assert.rejects(svc.operatingExpenses({from:'ayer'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).operatingExpenses({}),{status:403});
});

test('gastos operacionales: a split record counts only its share',async()=>{
 const r=await material(-200,'Software de gestión','2026-02-01');
 await svc.distribute({type:r.type,id:r.id,version:r.version,requestId:randomUUID(),parts:[{projectId:opex,amount:'150'},{projectId:obra,amount:'50'}]});
 const feb=await svc.operatingExpenses({month:'2026-02'});
 assert.equal(feb.total,1);assert.equal(feb.rows[0].gasto,'150');assert.equal(feb.rows[0].importe,'200');
 assert.equal(Number(feb.meses.find(m=>m.mes==='2026-02').total),150);
});

const cat=async name=>(await svc.operatingExpenses({})).categorias.find(c=>c.name===name);
test('categorías: the seeded list, in its order',async()=>{
 const d=await svc.operatingExpenses({});
 assert.deepEqual(d.categorias.map(c=>c.name),['Empleado','AI','Gasolina','Furgoneta','Oficina','Comisión financiera','Responsabilidad civil','Móvil','Marketing','Fibra','Software']);
});

test('categorías: assign one to several records, filter and sum by category',async()=>{
 const gasolina=await cat('Gasolina'),oficina=await cat('Oficina');
 const all=await svc.operatingExpenses({q:'Alquiler oficina'});const alquiler=all.rows[0];
 const seguro=(await svc.operatingExpenses({q:'Seguro furgoneta'})).rows[0],gestoria=(await svc.operatingExpenses({q:'Gestoría'})).rows[0];
 assert.equal(alquiler.categoria_id,null);
 assert.deepEqual(await svc.setOpexCategory({recordIds:[seguro.record_id,gestoria.record_id],categoryId:gasolina.id}),{updated:2,categoria:{id:gasolina.id,name:'Gasolina'}});
 await svc.setOpexCategory({recordIds:[alquiler.record_id],categoryId:oficina.id});
 // Moving one of them to another category; the same category again changes nothing.
 assert.equal((await svc.setOpexCategory({recordIds:[gestoria.record_id],categoryId:oficina.id})).updated,1);
 assert.equal((await svc.setOpexCategory({recordIds:[gestoria.record_id],categoryId:oficina.id})).updated,0);

 const d=await svc.operatingExpenses({});
 assert.deepEqual(d.porCategoria.map(c=>[c.id,Number(c.total),c.movimientos]),[[oficina.id,380,2],[gasolina.id,120.5,1]],'largest first');
 assert.ok(Number(d.sinCategoria.total)>0&&d.sinCategoria.movimientos>0,'the rest has no category');
 assert.equal(d.categorias.find(c=>c.id===oficina.id).movimientos,2);

 const solo=await svc.operatingExpenses({category:oficina.id});
 assert.deepEqual(solo.rows.map(r=>r.concepto).sort(),['Alquiler oficina','Gestoría']);
 assert.equal(Number(solo.totales.total),380,'the chart and totals follow the category');
 assert.equal(solo.porCategoria.length,2,'the breakdown keeps every category');
 const sin=await svc.operatingExpenses({category:'sin'});
 assert.ok(sin.rows.length&&sin.rows.every(r=>r.categoria_id===null));
 assert.deepEqual((await svc.operatingExpenses({month:'2026-01'})).porCategoria.map(c=>[c.id,Number(c.total)]),[[oficina.id,300],[gasolina.id,120.5]],'the breakdown follows the month');

 // Each change is an event of the record; «Sin categoría» takes it away.
 const ev=(await db.query("SELECT after_value FROM ledens.finance_events WHERE record_id=$1 AND action='opex_category' ORDER BY id",[gestoria.record_id])).rows;
 assert.equal(ev.length,2);assert.equal(ev[1].after_value.categoria.name,'Oficina');assert.equal(ev[1].after_value.anterior.name,'Gasolina');
 await svc.setOpexCategory({recordIds:[gestoria.record_id],categoryId:null});
 assert.equal((await svc.operatingExpenses({q:'Gestoría'})).rows[0].categoria_id,null);
});

test('categorías: only for records of a «Gastos operacionales» project, by an admin',async()=>{
 const oficina=await cat('Oficina');
 const obraRecord=(await db.query("SELECT f.id FROM ledens.financial_records f JOIN ledens.material_expenses m ON m.id=f.material_id WHERE m.description='Cemento obra'")).rows[0].id;
 const opexRecord=(await svc.operatingExpenses({q:'Alquiler oficina'})).rows[0].record_id;
 await assert.rejects(svc.setOpexCategory({recordIds:[opexRecord,obraRecord],categoryId:oficina.id}),{status:409});
 assert.equal((await svc.operatingExpenses({q:'Alquiler oficina'})).rows[0].categoria_id,oficina.id,'all or nothing: nothing changed');
 await assert.rejects(svc.setOpexCategory({recordIds:[opexRecord],categoryId:randomUUID()}),{status:404});
 await assert.rejects(svc.setOpexCategory({recordIds:[],categoryId:oficina.id}),{status:400});
 await assert.rejects(svc.operatingExpenses({category:randomUUID()}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).setOpexCategory({recordIds:[opexRecord],categoryId:oficina.id}),{status:403});
 await assert.rejects(new FinanzasService(pool,jefe).createOpexCategory({name:'Viajes'}),{status:403});
});

test('categorías: admins add, rename and remove (only unused) categories',async()=>{
 const {categoria}=await svc.createOpexCategory({name:'  Viajes  '});
 assert.equal(categoria.name,'Viajes');
 assert.equal((await svc.operatingExpenses({})).categorias.at(-1).name,'Viajes','added at the end');
 await assert.rejects(svc.createOpexCategory({name:'gasolina'}),{status:409});
 await assert.rejects(svc.createOpexCategory({name:' '}),{status:400});
 assert.equal((await svc.renameOpexCategory(categoria.id,{name:'Viajes y dietas'})).categoria.name,'Viajes y dietas');
 await assert.rejects(svc.renameOpexCategory(categoria.id,{name:'Software'}),{status:409});
 await assert.rejects(svc.deleteOpexCategory((await cat('Oficina')).id),{status:409},'in use');
 assert.deepEqual(await svc.deleteOpexCategory(categoria.id),{deleted:true});
 assert.ok(!(await svc.operatingExpenses({})).categorias.some(c=>c.id===categoria.id));
 assert.ok((await db.query("SELECT count(*)::int n FROM public.audit_log WHERE action LIKE 'Categoría de gasto operacional%'")).rows[0].n>=3);
});

test('gastos operacionales: without such a project, nothing to show',async()=>{
 await db.query("UPDATE ledens.projects SET name='Oficina' WHERE id=ANY($1)",[[opex,opex2]]);
 const d=await svc.operatingExpenses({});
 assert.deepEqual(d.proyectos,[]);assert.equal(d.total,0);assert.equal(d.totales.total,'0');
});
