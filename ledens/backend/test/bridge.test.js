import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {BridgeService} from '../src/bridge/service.js';
import {cents,eligibleBank,automaticBlock} from '../src/bridge/rules.js';
let db,service,pool;
before(async()=>{
 db=new PGlite();for(const path of ['finance-fixture.sql','../src/db/migrations/004_invoice_ingestion.sql','../src/db/migrations/005_bank_bridge.sql'])await db.exec(await fs.readFile(new URL(path,import.meta.url),'utf8'));
 pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};service=new BridgeService(pool);
});after(()=>db?.close());
const document=async(number,total='-121')=>{
 const d=(await db.query("INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero,niftercero) VALUES($1,'Pagar','2025-09-01',$2,'Proveedor Ejemplo','B12345678') RETURNING id",[total,number])).rows[0].id;
 await db.query(`INSERT INTO ledens.invoice_ingestions(document_id,content_hash,filename,content_type,status,invoice_currency,date_confidence,total_confidence,number_confidence,party_confidence,tax_id_confidence,direction_confidence)
  VALUES($1,$2,'invoice.pdf','application/pdf','archived','EUR',.99,.99,.99,.99,.99,.99)`,[d,number]);return d;
};
const bank=async(reference,total='-121')=>(await db.query("INSERT INTO ledens.bank_movements(amount,total_amount,state,type,completed_on,currency,reference,beneficiary_name,is_internal_transfer) VALUES($1,$1,'COMPLETED','TRANSFER','2025-09-02','EUR',$2,'Proveedor Ejemplo',false) RETURNING id",[total,reference])).rows[0].id;
test('exact verified reference and party reconcile once using signed Confirmado ledger',async()=>{
 const d=await document('TEST-000001'),b=await bank('TEST-000001');assert.equal((await service.evaluate(d,{force:true})).status,'matched');
 await service.evaluate(d,{force:true});const rows=(await db.query('SELECT * FROM ledens.bank_document_allocations WHERE document_id=$1',[d])).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].bank_movement_id,b);assert.equal(rows[0].allocated_amount,'-121');assert.equal(rows[0].state,'Confirmado');
});
test('same amount without reference remains pending',async()=>{
 const d=await document('TEST-000002');await bank('Transferencia');assert.equal((await service.evaluate(d,{force:true})).reason,'insufficient_evidence');
});
test('ambiguous banks and competing documents are not assigned greedily',async()=>{
 const d=await document('TEST-000003');await bank('TEST-000003');await bank('TEST-000003');assert.equal((await service.evaluate(d,{force:true})).reason,'ambiguous_match');
 const a=await document('TEST-000004'),b=await document('TEST-000004-copy');await db.query("UPDATE ledens.documents SET numerodocumento='TEST-000004' WHERE id=$1",[b]);await bank('TEST-000004');
 assert.equal((await service.evaluate(a,{force:true})).reason,'competing_document');
});
test('late bank arrival can retry and reversed owned match returns to review',async()=>{
 const d=await document('TEST-000005');assert.equal((await service.evaluate(d,{force:true})).status,'pending');const b=await bank('TEST-000005');assert.equal((await service.evaluate(d,{force:true})).status,'matched');
 await db.query("UPDATE ledens.bank_movements SET state='REVERTED' WHERE id=$1",[b]);await service.monitor(d);
 assert.equal((await db.query('SELECT state FROM ledens.bank_document_allocations WHERE document_id=$1',[d])).rows[0].state,'Revisar');
});
test('manual or imported partial match is preserved for user review',async()=>{
 const d=await document('TEST-000006'),b=await bank('TEST-000006');await db.query("INSERT INTO ledens.bank_document_allocations(document_id,bank_movement_id,allocated_amount,state) VALUES($1,$2,-60,'Confirmado')",[d,b]);
 assert.equal((await service.evaluate(d,{force:true})).reason,'partial_or_existing_allocation');assert.equal((await db.query('SELECT allocated_amount FROM ledens.bank_document_allocations WHERE document_id=$1',[d])).rows[0].allocated_amount,'-60');
});
test('fees, currency mismatch, internal transfer and missing confidence cannot auto-reconcile',()=>{
 const d={total:'-121',tipo:'Pagar',document_on:'2025-09-01',invoice_currency:'EUR',date_confidence:.99,total_confidence:.99,number_confidence:.99,direction_confidence:.99,numerodocumento:'TEST-000007',tercero:'Proveedor Ejemplo',party_confidence:.99};
 const b={amount:'-121',total_amount:'-121',state:'COMPLETED',currency:'EUR',type:'TRANSFER',completed_on:'2025-09-02',is_internal_transfer:false,reference:'TEST-000007',beneficiary_name:'Proveedor Ejemplo'};
 assert.ok(eligibleBank(d,b));for(const bad of [{bank_fee:'1'},{currency:'USD'},{is_internal_transfer:true},{is_internal_transfer:null}])assert.equal(eligibleBank(d,{...b,...bad}),false);
 assert.equal(automaticBlock({...d,total_confidence:null}),'unverified_invoice_fields');assert.equal(cents('0.001'),null);
});
