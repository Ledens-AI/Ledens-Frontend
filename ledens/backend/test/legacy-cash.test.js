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
  for(const name of ['015z_adopt_legacy_cash.sql','016_cash_movements.sql'])await fs.copyFile(new URL('../src/db/migrations/'+name,import.meta.url),path.join(dir,name));
  // 016 would fail CREATE TABLE on this exact legacy shape; the runner must
  // refresh the ledger after adoption and skip it, not just check its startup cache.
  await runMigrations({pool,migrationsDir:dir});
  const legacy=(await db.query("SELECT movimientoefectivoid,tipomovimiento,concepto,tercero,amount::text,kind FROM ledens.cash_movements WHERE movimientoefectivoid='LEGACY-1'")).rows[0];
  assert.deepEqual(legacy,{movimientoefectivoid:'LEGACY-1',tipomovimiento:'Pago',concepto:'Original importado',tercero:'Histórico',amount:'-123.45',kind:null});
  assert.equal((await db.query("SELECT count(*)::int n FROM schema_migrations WHERE name IN ('015z_adopt_legacy_cash.sql','016_cash_movements.sql')")).rows[0].n,2);
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
