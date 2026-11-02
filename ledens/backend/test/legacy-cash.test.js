import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import {runMigrations} from '../src/db/migrate.js';
import {FinanzasService} from '../src/finanzas/service.js';
import {BridgeWorkspace} from '../src/bridge/workspace.js';

test('real migration runner adopts imported cash, preserves history and restores both pending screens',async()=>{
 let pool,db;
 if(process.env.LEGACY_CASH_TEST_DATABASE_URL){pool=new pg.Pool({connectionString:process.env.LEGACY_CASH_TEST_DATABASE_URL});db={query:(...a)=>pool.query(...a),exec:q=>pool.query(q),close:()=>pool.end()};}
 else{db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};}
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ledens-cash-compat-'));
 try{
  await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
  for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
  await db.exec(`CREATE TABLE ledens.cash_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text UNIQUE,raw_id uuid UNIQUE,movimientoefectivoid text,occurred_on date,tipomovimiento text,concepto text,tercero text,project_source text,categoria text,comportamientocoste text,amount numeric,impactoresultado text,observaciones text,CHECK((source_id IS NULL)=(raw_id IS NULL)));
   INSERT INTO ledens.cash_movements(movimientoefectivoid,tipomovimiento,concepto,tercero,amount) VALUES('LEGACY-1','Pago','Original importado','Histórico',-123.45);`);
  for(const name of ['015z_adopt_legacy_cash.sql','016_cash_movements.sql','027_transferencias_internas.sql','028_treasury_movements.sql','029_efectivo_importado.sql'])await fs.copyFile(new URL('../src/db/migrations/'+name,import.meta.url),path.join(dir,name));
  // 016 would fail CREATE TABLE on this exact legacy shape; the runner must
  // refresh the ledger after adoption and skip it, not just check its startup cache.
  await runMigrations({pool,migrationsDir:dir});
  const legacy=(await db.query("SELECT movimientoefectivoid,tipomovimiento,concepto,tercero,amount::text,kind FROM ledens.cash_movements WHERE movimientoefectivoid='LEGACY-1'")).rows[0];
  assert.deepEqual(legacy,{movimientoefectivoid:'LEGACY-1',tipomovimiento:'Pago',concepto:'Original importado',tercero:'Histórico',amount:'-123.45',kind:null});
  assert.equal((await db.query("SELECT count(*)::int n FROM schema_migrations WHERE name IN ('015z_adopt_legacy_cash.sql','016_cash_movements.sql','027_transferencias_internas.sql','028_treasury_movements.sql','029_efectivo_importado.sql')")).rows[0].n,5);
  // A row that cannot be read (no date) is not adopted by 029: untouched and out of the validation screens.
  assert.deepEqual((await db.query("SELECT origin,amount::text,direction,validable FROM ledens.treasury_movements")).rows,
   [{origin:'cash_movements',amount:'-123.45',direction:null,validable:false}]);
  const admin=(await db.query("INSERT INTO users(email,role) VALUES('cash-compat@test.invalid','admin') RETURNING id,role")).rows[0];
  const svc=new FinanzasService(pool,admin);
  assert.equal((await svc.reconciliation()).total,0,'imported cash is not reintroduced as a new unassigned payment');
  assert.equal((await svc.workerQueue()).total,0);
  const cash=await svc.createCash({kind:'pago',amount:'100.00',date:'2026-10-25',concept:'Pago nuevo'});
  assert.equal((await svc.reconciliation()).total,1);
  assert.equal((await new BridgeWorkspace(pool).counts()).reconciliation,1);
  assert.equal((await svc.classifyWorkerPayments({movementIds:[cash.id]})).results[0].ok,true);
  assert.equal((await svc.workerQueue()).total,1);
  assert.equal((await svc.reconciliation()).total,0);
  await runMigrations({pool,migrationsDir:dir});
  assert.equal((await db.query('SELECT count(*)::int n FROM ledens.cash_movements')).rows[0].n,2,'restarting preserves both imported and new records');
 }finally{await db.close();if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('ledens-cash-compat-'))throw new Error('Unsafe test cleanup path');await fs.rm(dir,{recursive:true,force:true});}
});

test('029 adopts imported FactMovimientosEfectivo rows: they enter Pendiente de conciliación with their data and, once assigned, the results',async()=>{
 const db=new PGlite(),pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ledens-cash-compat-'));
 try{
  await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
  for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','026_materiales_provisionales.sql'])await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
  const obra=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Casa Sol','OBRA-77') RETURNING id")).rows[0].id;
  await db.exec(`CREATE TABLE ledens.cash_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text UNIQUE,raw_id uuid UNIQUE,movimientoefectivoid text,occurred_on date,tipomovimiento text,concepto text,tercero text,project_source text,categoria text,comportamientocoste text,amount numeric,impactoresultado text,observaciones text,CHECK((source_id IS NULL)=(raw_id IS NULL)));
   INSERT INTO ledens.cash_movements(movimientoefectivoid,occurred_on,tipomovimiento,concepto,tercero,project_source,categoria,observaciones,amount) VALUES
    ('ME-1','2026-09-01','Pago','Arena y cemento','Almacén Ruiz','OBRA-77','Materiales','Pagado en mano',-80),
    ('ME-2','2026-09-02','Cobro','Señal reforma','Cliente Pérez',NULL,'Ventas',NULL,300),
    ('ME-3','2026-09-03',NULL,'Sin tipo',NULL,NULL,NULL,NULL,-45.5),
    ('ME-4','2026-09-04','Pago','Tres decimales',NULL,NULL,NULL,NULL,-10.005);`);
  // A cash material already imported without bank movement, same date and amount as ME-1.
  await db.query("INSERT INTO ledens.material_expenses(occurred_on,total,description) VALUES('2026-09-01',-80,'Arena')");
  for(const name of ['015z_adopt_legacy_cash.sql','016_cash_movements.sql','027_transferencias_internas.sql','028_treasury_movements.sql','029_efectivo_importado.sql'])await fs.copyFile(new URL('../src/db/migrations/'+name,import.meta.url),path.join(dir,name));
  await runMigrations({pool,migrationsDir:dir});
  // Imported columns are never rewritten; the application columns come from them.
  const k=Object.fromEntries((await db.query('SELECT movimientoefectivoid m,tipomovimiento,concepto,tercero,amount::text,kind,concept,counterparty,imported FROM ledens.cash_movements')).rows.map(r=>[r.m,r]));
  assert.deepEqual([k['ME-1'].tipomovimiento,k['ME-1'].concepto,k['ME-1'].amount,k['ME-1'].kind,k['ME-1'].concept,k['ME-1'].counterparty,k['ME-1'].imported],['Pago','Arena y cemento','-80','pago','Arena y cemento','Almacén Ruiz',true]);
  assert.deepEqual([k['ME-2'].kind,k['ME-3'].kind,k['ME-4'].kind,k['ME-4'].imported],['cobro','pago',null,false],'no type: the sign; more than two decimals: left out');
  const admin=(await db.query("INSERT INTO users(email,role) VALUES('cash-import@test.invalid','admin') RETURNING id,role")).rows[0];
  const svc=new FinanzasService(pool,admin);
  const rows=Object.fromEntries((await svc.reconciliation({pageSize:100})).rows.map(r=>[r.detalle_importado?.id,r]));
  assert.deepEqual(Object.keys(rows).sort(),['ME-1','ME-2','ME-3']);
  assert.deepEqual([rows['ME-1'].type,Number(rows['ME-1'].importe),rows['ME-1'].concepto,rows['ME-1'].tercero,rows['ME-1'].importado],['efectivo',-80,'Arena y cemento','Almacén Ruiz',true]);
  assert.deepEqual(rows['ME-1'].motivos,['efectivo','efectivo_importado','posible_duplicado']);
  assert.deepEqual(rows['ME-1'].obra_sugerida,{id:obra,label:'Casa Sol'});
  assert.deepEqual([rows['ME-1'].detalle_importado.categoria,rows['ME-1'].detalle_importado.observaciones],['Materiales','Pagado en mano']);
  assert.deepEqual([Number(rows['ME-2'].importe),rows['ME-2'].motivos],[300,['efectivo','efectivo_importado']]);
  assert.equal((await svc.reconciliation({reason:'efectivo_importado'})).total,3);
  assert.equal((await new BridgeWorkspace(pool).counts()).reconciliation,3);
  // Assigned to its obra, it becomes a material expense signed like the import and counts as cash.
  await assert.rejects(svc.deleteCash(rows['ME-3'].id),{status:409,message:/importado/});
  const {recordId}=await svc.assignCash({id:rows['ME-3'].id,target:'materiales',projectId:obra});
  const rec=(await db.query('SELECT f.gross_amount::text gross,m.total::text total FROM ledens.financial_records f JOIN ledens.material_expenses m ON m.id=f.material_id WHERE f.id=$1',[recordId])).rows[0];
  assert.deepEqual([Number(rec.gross),Number(rec.total)],[45.5,-45.5],"same signs as any cash material");
  assert.equal((await db.query('SELECT count(*)::int n FROM ledens.v_cash_records WHERE record_id=$1',[recordId])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM ledens.project_financial_allocations WHERE record_id=$1 AND project_id=$2',[recordId,obra])).rows[0].n,1);
  // A duplicate is discarded with a reason: it stays in the table, out of every screen.
  await assert.rejects(svc.discardCash({id:rows['ME-1'].id,reason:'x'}),{status:400});
  assert.deepEqual(await svc.discardCash({id:rows['ME-1'].id,reason:'Ya está en Materiales'}),{discarded:true});
  await assert.rejects(svc.assignCash({id:rows['ME-1'].id,target:'materiales'}),{status:409,message:/descartado/});
  const hand=await svc.createCash({kind:'pago',amount:'5',date:'2026-09-05',concept:'A mano'});
  await assert.rejects(svc.discardCash({id:hand.id,reason:'No es importado'}),{status:409});
  assert.deepEqual((await svc.reconciliation({reason:'efectivo_importado'})).rows.map(r=>r.detalle_importado.id),['ME-2']);
  assert.ok(!(await svc.movements({pageSize:100})).rows.some(r=>r.id===rows['ME-1'].id),'Concepto de movimientos leaves the discarded entry out');
  // A receipt goes to Pagos de clientes with its imported client.
  await svc.assignCash({id:rows['ME-2'].id,target:'clientes'});
  assert.equal((await db.query("SELECT cliente FROM ledens.customer_payments WHERE total=300")).rows[0].cliente,'Cliente Pérez');
  await runMigrations({pool,migrationsDir:dir});
  assert.equal((await db.query("SELECT count(*)::int n FROM ledens.cash_movements WHERE imported")).rows[0].n,3,'restarting adopts nothing twice');
 }finally{await db.close();if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('ledens-cash-compat-'))throw new Error('Unsafe test cleanup path');await fs.rm(dir,{recursive:true,force:true});}
});
