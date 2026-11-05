import {test,before,after} from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {FinanzasService} from '../src/finanzas/service.js';
import {bankFingerprint} from '../src/bridge/rules.js';
// Concepto de movimientos on PGlite with the shared finance fixture; synthetic rows only.
let db,pool,admin,jefe,m={},lines;
const asAdmin=()=>new FinanzasService(pool,admin);
before(async()=>{
 const {PGlite}=await import('@electric-sql/pglite');db=new PGlite();pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(await fs.readFile(new URL('./finance-fixture.sql',import.meta.url),'utf8'));
 await db.exec('ALTER TABLE users ADD COLUMN name text');
 for(const name of ['004_invoice_ingestion.sql','005_bank_bridge.sql','006_project_finance.sql','010_finanzas_imputacion.sql','013_pago_trabajadores.sql','016_cash_movements.sql','026_materiales_provisionales.sql','029_provisional_todas_las_facturas.sql','027_transferencias_internas.sql','028_treasury_movements.sql','030_efectivo_importado.sql'])
  await db.exec(await fs.readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
 [admin,jefe]=(await db.query("INSERT INTO users(email,role,name) VALUES('admin@mv.test','admin','Admin'),('jefe@mv.test','jefe','Jefe') RETURNING id,role")).rows;
 const bank=async(amount,description,extra='')=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state${extra?',is_internal_transfer':''})
  VALUES($1,$2,$2,'2026-10-10',$3,'EUR','COMPLETED'${extra?',true':''}) RETURNING *`,['MOV-'+description,amount,description])).rows[0];
 const doc=async(total,tipo,numero)=>(await db.query(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES($1,$2,'2026-10-08',$3,'Tercero '||$3) RETURNING id`,[total,tipo,numero])).rows[0].id;
 const link=(b,d,amount)=>db.query("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,'Confirmado','2026-10-10')",[b,d,amount]);
 const line=async(d,n,gross,description)=>{const l=(await db.query('INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3) RETURNING id',[d,n,description])).rows[0].id;
  return (await db.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-08',$3,$4,'EUR') RETURNING id`,[l,d,description,gross])).rows[0].id;};
 // A supplier invoice (lines unclassified) reconciled with its payment: pending.
 m.factura=await bank(-200,'Pago almacén azulejos');const inv=await doc(-200,'Pagar','F-AZULEJOS');await link(m.factura.id,inv,-200);
 lines=[await line(inv,1,'120','Azulejos'),await line(inv,2,'80','Cemento cola')];
 // An imported material with its document reconciled: concluded as materiales through the Bridge.
 m.material=await bank(-50,'Pago almacén');const matDoc=await doc(-50,'Pagar','F-MAT');await link(m.material.id,matDoc,-50);
 await db.query("INSERT INTO ledens.material_expenses(total,document_id,description,occurred_on) VALUES(-50,$1,'Cemento','2026-10-08')",[matDoc]);
 // Movements with no document: a payment, a receipt and a nómina.
 m.pago=await bank(-90,'Pago sin factura');m.cobro=await bank(500,'Transferencia cliente');m.nomina=await bank(-300,'Nómina octubre');
 // A reconciled document without records cannot be concluded.
 m.bare=await bank(-40,'Pago documento vacío');await link(m.bare.id,await doc(-40,'Pagar','F-VACIA'),-40);
 await bank(-1000,'Traspaso','internal');
 m.cash=(await db.query("INSERT INTO ledens.cash_movements(kind,amount,occurred_on,concept) VALUES('pago',30,'2026-10-09','Tornillos') RETURNING *")).rows[0];
});
after(()=>db?.close());
const list=async(f={})=>asAdmin().movements({pageSize:100,...f});
const row=async(id)=>(await list()).rows.find(r=>r.id===id);
const classify=async(id,clase,reason)=>asAdmin().classifyMovement({id,clase,version:(await row(id)).version,reason});

test('every movement appears once with the class concluded from the Bridge, or pending',async()=>{
 const all=await list();
 assert.equal(all.total,7,'internal transfers are left out');
 assert.deepEqual([(await row(m.factura.id)).clase,(await row(m.factura.id)).origen,(await row(m.factura.id)).documentos],['pendiente','bridge','F-AZULEJOS']);
 assert.deepEqual([(await row(m.material.id)).clase,(await row(m.material.id)).origen],['materiales','bridge']);
 for(const id of [m.pago.id,m.cobro.id,m.nomina.id,m.bare.id,m.cash.id])assert.equal((await row(id)).clase,'pendiente');
 assert.deepEqual(all.resumen,{pendiente:6,materiales:1,trabajadores:0,clientes:0,reembolso_proveedor:0,transferencia:0,mixto:0});
 assert.equal((await list({clase:'pendiente'})).total,6);
 assert.deepEqual(await asAdmin().movementsPending(),{pendientes:6},'the sidebar badge counts the same pending movements');
 await assert.rejects(new FinanzasService(pool,jefe).movementsPending(),{status:403});
 assert.equal((await list({q:'azulejos'})).total,1);
 await assert.rejects(list({clase:'nada'}),{status:400});
 await assert.rejects(new FinanzasService(pool,jefe).movements(),{status:403});
});

test('classifying a reconciled movement classifies its whole document at once, audited',async()=>{
 const res=await classify(m.factura.id,'materiales');
 assert.deepEqual([res.via,res.changed],['registros',2]);
 assert.equal((await row(m.factura.id)).clase,'materiales');
 const pending=(await asAdmin().listRecords({type:'material',pending:true,pageSize:100})).rows.map(r=>r.concepto).sort();
 assert.deepEqual(pending,['Azulejos','Cemento','Cemento cola']);
 const ev=(await db.query("SELECT reason FROM ledens.finance_events WHERE record_id=ANY($1::uuid[]) AND action='reclassified'",[lines])).rows;
 assert.equal(ev.length,2);
 await assert.rejects(classify(m.factura.id,'trabajadores'),{status:400,message:/motivo/});
 await assert.rejects(classify(m.factura.id,'materiales'),{status:409,message:/Ya está/});
 const stale=(await row(m.factura.id)).version;
 assert.equal((await classify(m.factura.id,'trabajadores','Era la factura del alicatador')).clase,'trabajadores');
 await assert.rejects(asAdmin().classifyMovement({id:m.factura.id,clase:'materiales',version:stale,reason:'Otra vez'}),{status:409,message:/ha cambiado/});
});

test('a movement without documents enters through the usual flow for its class',async()=>{
 assert.equal((await classify(m.pago.id,'materiales')).via,'material');
 assert.equal((await row(m.pago.id)).clase,'materiales');
 assert.equal((await db.query('SELECT total::text FROM ledens.material_expenses WHERE bank_movement_id=$1',[m.pago.id])).rows[0].total,'-90.00');
 assert.equal((await classify(m.cobro.id,'clientes')).via,'cobro-cliente');
 assert.equal((await row(m.cobro.id)).clase,'clientes');
 assert.equal((await classify(m.nomina.id,'trabajadores')).via,'pendiente-trabajador');
 assert.equal((await row(m.nomina.id)).clase,'trabajadores');
 await assert.rejects(classify(m.nomina.id,'materiales'),{status:400,message:/motivo/},'undoing Pago a trabajadores needs a reason');
 await assert.rejects(classify(m.nomina.id,'trabajadores','Otra vez'),{status:409,message:/Ya está en pagos a trabajadores/});
 assert.equal((await classify(m.cash.id,'materiales')).via,'efectivo');
 assert.equal((await row(m.cash.id)).clase,'materiales');
 assert.equal((await list()).resumen.pendiente,1);
});

test('direction, documents without records and roles guard the classification',async()=>{
 await assert.rejects(classify(m.bare.id,'clientes'),{status:409,message:/Un pago/});
 await assert.rejects(classify(m.cobro.id,'materiales'),{status:409,message:/Un cobro/});
 await assert.rejects(new FinanzasService(pool,jefe).classifyMovement({id:m.bare.id,clase:'materiales',version:(await row(m.bare.id)).version}),{status:403});
});

test('Pendiente de conciliación carries what «Asignar documento» needs for each bank movement',async()=>{
 const r=(await asAdmin().reconciliation({pageSize:100})).rows.find(x=>x.id===m.pago.id);
 const b=(await db.query('SELECT * FROM ledens.bank_movements WHERE id=$1',[m.pago.id])).rows[0];
 assert.deepEqual(r.bank,{id:b.id,description:'Pago sin factura',reference:null,total_amount:'-90',remaining:r.por_conciliar,state:'COMPLETED',currency:'EUR',bank_fingerprint:bankFingerprint(b),bloqueo:null});
});

test('«Asignar documento» says why a bank movement cannot take a document; one the bank voided leaves the list',async()=>{
 const add=async(source,state,currency)=>(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,-60.18,-60.18,'2026-10-14','Factura Obramat',$2,$3) RETURNING id`,[source,currency,state])).rows[0].id;
 const pendiente=await add('MOV-pend','PENDING','EUR'),revertido=await add('MOV-rev','REVERTED','EUR'),usd=await add('MOV-usd','COMPLETED','USD'),sinEstado=await add('MOV-null',null,'EUR');
 const rows=(await asAdmin().reconciliation({pageSize:100})).rows,find=id=>rows.find(x=>x.id===id);
 assert.match(find(pendiente).bank.bloqueo,/aún no ha completado/);
 assert.match(find(usd).bank.bloqueo,/USD/);
 assert.match(find(sinEstado).bank.bloqueo,/sin informar/);
 const eurAccount=(await db.query("INSERT INTO ledens.bank_accounts(name,currency) VALUES('Revolut EUR','EUR') RETURNING id")).rows[0].id;
 const sinDivisa=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state,bank_account_id)
  VALUES('MOV-sin-divisa',-60.18,-60.18,'2026-10-14','Factura Obramat',NULL,'COMPLETED',$1) RETURNING id`,[eurAccount])).rows[0].id;
 const huerfano=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-huerfano',-60.18,-60.18,'2026-10-14','Factura Obramat',NULL,'COMPLETED') RETURNING id`)).rows[0].id;
 const again=(await asAdmin().reconciliation({pageSize:100})).rows;
 const ok=again.find(x=>x.id===sinDivisa).bank;
 assert.deepEqual([ok.currency,ok.bloqueo],['EUR',null],'no currency: the account\'s EUR, so «Asignar documento» is enabled');
 assert.match(again.find(x=>x.id===huerfano).bank.bloqueo,/ni de qué cuenta/);
 await db.query('DELETE FROM ledens.bank_movements WHERE id=ANY($1::uuid[])',[[sinDivisa,huerfano]]);
 assert.equal(find(revertido),undefined,'a reverted movement never moved money: nothing to reconcile');
 await db.query('DELETE FROM ledens.bank_movements WHERE id=ANY($1::uuid[])',[[pendiente,revertido,usd,sinEstado]]);
});

test('a provisional material payment is replaced by its invoice when the Bridge reconciles it: class and obra carried, never counted twice',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const project=(await q("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Calle Larios','P-LARIOS') RETURNING id")).rows[0].id;
 const bankRow=async(amount,description)=>(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,$2,$2,'2026-10-12',$3,'EUR','COMPLETED') RETURNING id`,['MOV-'+description,amount,description])).rows[0].id;
 const document=async(total,numero)=>(await q(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES($1,'Pagar','2026-10-11',$2,'OBRAMAT') RETURNING id`,[total,numero])).rows[0].id;
 const addLine=async(d,n,gross)=>{const l=(await q('INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,$2,$3) RETURNING id',[d,n,'Línea '+n])).rows[0].id;
  return (await q(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-10-11',$3,$4,'EUR') RETURNING id`,[l,d,'Línea '+n,gross])).rows[0].id;};
 const confirm=(b,d,amount)=>q("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,$3,'Confirmado','2026-10-12')",[b,d,amount]);
 const live=async(b)=>(await q(`SELECT r.category,r.gross_amount::text gross,(SELECT project_id FROM ledens.project_financial_allocations a WHERE a.record_id=r.id) project
  FROM ledens.financial_records r WHERE r.source_valid AND r.status<>'excluded' AND (r.bank_movement_id=$1 OR r.document_id IN(SELECT document_id FROM ledens.bank_document_allocations WHERE bank_movement_id=$1))
  ORDER BY r.gross_amount`,[b])).rows;

 // 1) Reconciled first, invoice lines registered afterwards.
 const b1=await bankRow(-120,'Obramat sin factura');
 const {materialId}=await classify(b1,'materiales');
 assert.equal((await row(b1)).origen,'provisional');
 const rec=(await asAdmin().listRecords({type:'material',pending:true,q:'Obramat sin factura'})).rows[0];
 await asAdmin().assign({type:'material',id:materialId,projectId:project,version:rec.version,requestId:crypto.randomUUID()});
 const d1=await document(-120,'OB-1');await confirm(b1,d1,-120);
 assert.deepEqual((await live(b1)).map(r=>r.gross),['120.00'],'without lines the provisional record stays');
 await addLine(d1,1,'70');await addLine(d1,2,'50');
 assert.deepEqual(await live(b1),[{category:'materials',gross:'50',project},{category:'materials',gross:'70',project}]);
 const replaced=(await q('SELECT replaced_by_document_id doc,carried_project_id project FROM ledens.provisional_material_payments WHERE material_id=$1',[materialId])).rows[0];
 assert.deepEqual(replaced,{doc:d1,project});
 assert.equal((await q("SELECT count(*)::int n FROM ledens.finance_events e JOIN ledens.financial_records r ON r.id=e.record_id WHERE r.material_id=$1 AND e.action='provisional_replaced'",[materialId])).rows[0].n,1);
 assert.deepEqual([(await row(b1)).clase,(await row(b1)).origen],['materiales','bridge']);

 // 2) Invoice registered first, reconciled afterwards; no obra to carry.
 const b2=await bankRow(-60,'Ferretería sin factura');
 await classify(b2,'materiales');
 const d2=await document(-60,'FE-1');await addLine(d2,1,'60');
 await confirm(b2,d2,-60);
 assert.deepEqual(await live(b2),[{category:'materials',gross:'60',project:null}]);
 assert.equal((await row(b2)).clase,'materiales');
});

test('a bank receipt with nothing registered can be a supplier refund: a negative material cost, never on a payment, cash or a receipt with records',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-abono',45,45,'2026-10-13','Devolución Leroy','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const res=await classify(b,'reembolso_proveedor');
 assert.deepEqual([res.via,res.provisional],['material',false]);
 assert.deepEqual([(await row(b)).clase,(await row(b)).origen],['reembolso_proveedor','registro']);
 const r=(await db.query('SELECT r.category,r.gross_amount::text gross,m.total::text total FROM ledens.material_expenses m JOIN ledens.financial_records r ON r.material_id=m.id WHERE m.bank_movement_id=$1',[b])).rows[0];
 assert.deepEqual(r,{category:'materials',gross:'-45.00',total:'45.00'},'the record lowers the material cost');
 assert.equal((await db.query('SELECT count(*)::int n FROM ledens.provisional_material_payments WHERE bank_movement_id=$1',[b])).rows[0].n,0);
 assert.ok((await asAdmin().listRecords({type:'material',pending:true,pageSize:100})).rows.some(x=>x.concepto==='Devolución Leroy'));
 // Assigned to an obra and approved on the bank receipt alone, it lowers that obra's material cost.
 const project=(await db.query("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Reembolso','P-REEMB') RETURNING id")).rows[0].id;
 const rec=(await asAdmin().listRecords({type:'material',pending:true,q:'Devolución Leroy'})).rows[0];
 await asAdmin().assign({type:'material',id:res.materialId,projectId:project,version:rec.version,requestId:crypto.randomUUID()});
 const fin=asAdmin().finance,record=async(id)=>(await db.query('SELECT id,version FROM ledens.financial_records WHERE id=$1',[id])).rows[0];
 const approve=async(id,net)=>fin.approve(admin,id,{version:(await record(id)).version,category:'materials',status:'approved',currency:'EUR',net_amount:net,vat_amount:'0',nondeductible_vat:'0',withholding_amount:'0',recognized_on:'2026-10-13',reason:'Devolución comprobada en el banco'});
 assert.equal((await approve(res.recordId,'-45')).status,'approved');
 assert.equal(Number((await fin.summary(admin,project)).material_cost),-45);
 // The exception is only for refunds: a material payment without its invoice still needs the document.
 const pagoRec=(await db.query('SELECT r.id FROM ledens.material_expenses m JOIN ledens.financial_records r ON r.material_id=m.id WHERE m.bank_movement_id=$1',[m.pago.id])).rows[0].id;
 await assert.rejects(approve(pagoRec,'90'),{message:'recognition_requires_document'});
 // Never above the bank receipt: a second refund on the same movement cannot be approved.
 const extra=(await db.query("INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on,bank_movement_id) VALUES('ud','Otra devolución',1,10,10,'2026-10-13',$1) RETURNING id",[b])).rows[0].id;
 const extraRec=(await db.query('SELECT id FROM ledens.financial_records WHERE material_id=$1',[extra])).rows[0].id;
 await assert.rejects(approve(extraRec,'-10'),{message:'bank_amount_exceeded'});
 assert.equal((await list({clase:'reembolso_proveedor'})).total,1);
 assert.equal((await list()).resumen.reembolso_proveedor,1);
 await assert.rejects(classify(b,'clientes'),{status:400,message:/motivo/},'undoing a refund needs a reason');
 await assert.rejects(classify(m.bare.id,'reembolso_proveedor'),{status:409,message:/Un pago/});
 await assert.rejects(classify(m.cobro.id,'reembolso_proveedor'),{status:400,message:/motivo/},'undoing a client receipt needs a reason');
 const cash=(await db.query("INSERT INTO ledens.cash_movements(kind,amount,occurred_on,concept) VALUES('cobro',20,'2026-10-13','Devolución en tienda') RETURNING id")).rows[0].id;
 await assert.rejects(classify(cash,'reembolso_proveedor'),{status:409,message:/efectivo/});
});

test('a provisional payment replaced by an invoice that later lost its concepts is restored when classified again as materials',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const b=(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-omb',-7.44,-7.44,'2026-09-24','Omb Malaga','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const {materialId,recordId}=await classify(b,'materiales');
 // Assigned whole to an obra before its invoice arrives.
 const obra=(await q("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Omb','P-OMB') RETURNING id")).rows[0].id;
 const rec=(await asAdmin().listRecords({type:'material',pending:true,q:'Omb Malaga'})).rows[0];
 await asAdmin().assign({type:'material',id:materialId,projectId:obra,version:rec.version,requestId:crypto.randomUUID()});
 const d=(await q(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento,tercero) VALUES(-7.44,'Pagar','2026-09-24','008-0010-411173','OBRAMAT') RETURNING id`)).rows[0].id;
 const l=(await q("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,1,'Tornillos') RETURNING id",[d])).rows[0].id;
 const line=(await q(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-09-24','Tornillos',7.44,'EUR') RETURNING id`,[l,d])).rows[0].id;
 await q("INSERT INTO ledens.bank_document_allocations(bank_movement_id,document_id,allocated_amount,state,reconciled_on) VALUES($1,$2,-7.44,'Confirmado','2026-09-24')",[b,d]);
 assert.equal((await q('SELECT status FROM ledens.financial_records WHERE id=$1',[recordId])).rows[0].status,'excluded','026 replaced the provisional');
 // The invoice later loses its concepts (re-ingested): nothing represents the payment, it is pending again.
 await q("UPDATE ledens.financial_records SET status='excluded',source_valid=false WHERE id=$1",[line]);
 assert.equal((await row(b)).clase,'pendiente');
 const res=await classify(b,'materiales');
 assert.deepEqual([res.materialId,res.restored],[materialId,true]);
 assert.deepEqual([(await row(b)).clase,(await row(b)).origen],['materiales','provisional']);
 assert.deepEqual((await q('SELECT status,source_valid FROM ledens.financial_records WHERE id=$1',[recordId])).rows[0],{status:'pending',source_valid:true});
 assert.equal((await q("SELECT count(*)::int n FROM ledens.finance_events WHERE record_id=$1 AND action='provisional_restored'",[recordId])).rows[0].n,1);
 assert.deepEqual((await q('SELECT project_id,allocated_amount::text amount FROM ledens.project_financial_allocations WHERE record_id=$1',[recordId])).rows,[{project_id:obra,amount:'7.44'}],'it keeps the obra it had before 026 replaced it');
 // A material excluded otherwise (no provisional row, for the payment's amount) is recovered as provisional too.
 const mov=async(amount,description)=>(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,$2,$2,'2026-09-25',$3,'EUR','COMPLETED') RETURNING id`,['MOV-'+description,amount,description])).rows[0].id;
 const material=async(b,total,action)=>{const id=(await q("INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on,bank_movement_id) VALUES('ud','Importado',1,$2,$2,'2026-09-25',$1) RETURNING id",[b,total])).rows[0].id;
  const r=(await q("UPDATE ledens.financial_records SET status='excluded',source_valid=false WHERE material_id=$1 RETURNING *",[id])).rows[0];
  if(action)await q("INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value) VALUES($1,$2,'prueba','{}','{}')",[r.id,action]);
  return {id,record:r.id};};
 const b2=await mov(-9,'Pago almacén');const m2=await material(b2,-9,'source_changed');
 const res2=await classify(b2,'materiales');
 assert.deepEqual([res2.materialId,res2.restored],[m2.id,true]);
 assert.equal((await q('SELECT count(*)::int n FROM ledens.provisional_material_payments WHERE material_id=$1 AND replaced_at IS NULL',[m2.id])).rows[0].n,1);
 assert.equal((await row(b2)).clase,'materiales');
 // Never one excluded on purpose by a native Obramat purchase, nor one for another amount.
 const b3=await mov(-11,'Pago anticipo');await material(b3,-11,'purchase_source_replaced');
 await assert.rejects(classify(b3,'materiales'),{status:409,message:/purchase_source_replaced.*no se puede recuperar/});
 // A material with no financial record at all (an old import that bypassed the trigger): registered and made provisional.
 const b5=await mov(-7.44,'Omb Malaga');
 await q("SELECT set_config('ledens.finance_sync','on',false)");
 const orphan=(await q("INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on,bank_movement_id) VALUES('ud','Importado',1,-7.44,-7.44,'2026-09-24',$1) RETURNING id",[b5])).rows[0].id;
 await q("SELECT set_config('ledens.finance_sync','off',false)");
 assert.equal((await q('SELECT count(*)::int n FROM ledens.financial_records WHERE material_id=$1',[orphan])).rows[0].n,0,'no record: it counts nowhere');
 assert.equal((await row(b5)).clase,'pendiente');
 const res5=await classify(b5,'materiales');
 assert.deepEqual([res5.materialId,res5.restored],[orphan,true]);
 assert.deepEqual([(await row(b5)).clase,(await row(b5)).origen],['materiales','provisional']);
 assert.deepEqual((await q('SELECT category,status,gross_amount::text g FROM ledens.financial_records WHERE material_id=$1',[orphan])).rows,[{category:'materials',status:'pending',g:'7.44'}]);
 const b4=await mov(-12,'Pago parcial');await material(b4,-5,null);
 await assert.rejects(classify(b4,'materiales'),{status:409,message:/no se puede recuperar/});
});

test('the read-only diagnosis of a movement shows its documents, records with their last events and provisional payment',async()=>{
 const b=(await db.query(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES('MOV-diag',-15,-15,'2026-09-26','Pago diagnóstico','EUR','COMPLETED') RETURNING id`)).rows[0].id;
 const {materialId,recordId}=await classify(b,'materiales');
 const dg=await asAdmin().movementDiagnosis(b);
 assert.equal(dg.origen,'banco');assert.equal(dg.movimiento.id,b);
 assert.deepEqual([dg.fila.clase,dg.fila.origen],['materiales','provisional']);
 assert.deepEqual(dg.registros.map(r=>[r.id,r.tipo,r.status]),[[recordId,'material','pending']]);
 assert.equal(dg.provisionales[0].material_id,materialId);
 assert.ok(Array.isArray(dg.documentos)&&dg.lote===null);
 await assert.rejects(new FinanzasService(pool,jefe).movementDiagnosis(b),{status:403});
 await assert.rejects(asAdmin().movementDiagnosis('nada'),{status:404});
});

test('materials with no financial record are found and registered only when they cannot count twice',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const mov=async(amount,description)=>(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,$2,$2,'2026-09-27',$3,'EUR','COMPLETED') RETURNING id`,['MOV-'+description,amount,description])).rows[0].id;
 // The trigger leaves no record for a total with more than two decimals, zero or NULL.
 const mat=async(total,{bank=null,doc=null,project=null}={})=>(await q(`INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on,bank_movement_id,document_id,project_id)
  VALUES('ud','Línea importada',1,$1,$1,'2026-09-27',$2,$3,$4) RETURNING id`,[total,bank,doc,project])).rows[0].id;
 const lineas=await mov(-10,'Pago dos líneas');const l1=await mat(-3.3333,{bank:lineas}),l2=await mat(-6.6667,{bank:lineas});
 const sinImporte=await mat(null);
 const docConceptos=(await q(`INSERT INTO ledens.documents(total,tipo,document_on,numerodocumento) VALUES(-5,'Pagar','2026-09-27','F-CONCEPTOS') RETURNING id`)).rows[0].id;
 const il=(await q("INSERT INTO ledens.invoice_lines(document_id,line_number,description) VALUES($1,1,'Línea') RETURNING id",[docConceptos])).rows[0].id;
 await q(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency) VALUES($1,$2,'2026-09-27','Línea',5,'EUR')`,[il,docConceptos]);
 const dup=await mat(-5.004,{doc:docConceptos});
 const conRegistros=await mov(-8,'Pago ya registrado');await q("INSERT INTO ledens.material_expenses(und,description,quantity,unit_price,total,occurred_on,bank_movement_id) VALUES('ud','Registrado',1,-8,-8,'2026-09-27',$1)",[conRegistros]);
 const dupMov=await mat(-8.001,{bank:conRegistros});
 const descuadre=await mov(-20,'Pago descuadrado');const d1=await mat(-4.555,{bank:descuadre});
 const suelto=await mat(-2.345);
 // Three lines rounded up by a cent between them: the largest takes the difference.
 const redondeo=await mov(-10,'Pago con redondeo');const r1=await mat(-3.335,{bank:redondeo}),r2=await mat(-3.335,{bank:redondeo}),r3=await mat(-3.3349,{bank:redondeo});
 const plan=await asAdmin().registerOrphans();
 const accion=id=>plan.filas.find(f=>f.id===id);
 assert.deepEqual([l1,l2,suelto].map(id=>accion(id).accion),['registrar','registrar','registrar']);
 assert.deepEqual([accion(l1).provisional,accion(l1).gross,accion(l2).gross],[true,'3.33','6.67']);
 assert.match(accion(sinImporte).motivo_accion,/no tiene importe/);
 assert.match(accion(dup).motivo_accion,/su documento ya tiene conceptos/);
 assert.match(accion(dupMov).motivo_accion,/su movimiento ya tiene registros/);
 assert.match(accion(d1).motivo_accion,/suman 4\.56 € y el pago 20\.00 €/);
 assert.deepEqual([r1,r2,r3].map(id=>accion(id).accion),['registrar','registrar','registrar']);
 assert.deepEqual([r1,r2,r3].map(id=>accion(id).gross).sort(),['3.33','3.33','3.34'],'they add up to the payment');
 assert.equal([r1,r2,r3].filter(id=>accion(id).ajuste_redondeo).length,1);
 assert.equal([r1,r2,r3].map(id=>accion(id)).find(f=>f.ajuste_redondeo).ajuste_redondeo,'-0.01');
 assert.equal((await q('SELECT count(*)::int n FROM ledens.financial_records WHERE material_id=ANY($1::uuid[])',[[l1,l2,suelto]])).rows[0].n,0,'the plan changes nothing');
 assert.equal((await row(lineas)).clase,'pendiente');
 await assert.rejects(new FinanzasService(pool,jefe).registerOrphans(),{status:403});
 // Applied: records rounded to cents, provisional for the payment, audited; the source rows are untouched.
 const res=await asAdmin().registerOrphans(undefined,{ids:[l1,l2,suelto,dup],apply:true});
 assert.deepEqual([res.resumen.registrar,res.resumen.omitir],[3,1]);
 assert.deepEqual((await q('SELECT gross_amount::text g,category FROM ledens.financial_records WHERE material_id=ANY($1::uuid[]) ORDER BY gross_amount',[[l1,l2,suelto]])).rows,
  [{g:'2.35',category:'materials'},{g:'3.33',category:'materials'},{g:'6.67',category:'materials'}]);
 assert.equal((await q('SELECT total::text t FROM ledens.material_expenses WHERE id=$1',[l1])).rows[0].t,'-3.3333');
 assert.equal((await q('SELECT count(*)::int n FROM ledens.provisional_material_payments WHERE material_id=ANY($1::uuid[])',[[l1,l2]])).rows[0].n,2);
 assert.deepEqual([(await row(lineas)).clase,(await row(lineas)).origen],['materiales','provisional']);
 assert.equal((await q("SELECT count(*)::int n FROM ledens.finance_events e JOIN ledens.financial_records r ON r.id=e.record_id WHERE r.material_id=ANY($1::uuid[]) AND e.action='source_registered'",[[l1,l2,suelto]])).rows[0].n,3);
 assert.equal((await asAdmin().registerOrphans(undefined,{ids:[l1,l2,suelto]})).filas.length,0,'nothing left to register');
 // The diagnosis lists the movement's materials and whether they have a record.
 assert.deepEqual((await asAdmin().movementDiagnosis(descuadre)).materiales.map(m=>m.con_registro),[false]);
});

test('every movement can change class: what its old class registered is undone, audited, and recovered when classified back',async()=>{
 const q=(sql,p)=>db.query(sql,p);
 const bankRow=async(amount,description)=>(await q(`INSERT INTO ledens.bank_movements(source_id,amount,total_amount,completed_on,description,currency,state)
  VALUES($1,$2,$2,'2026-10-20',$3,'EUR','COMPLETED') RETURNING id`,['MOV-'+description,amount,description])).rows[0].id;
 const project=(await q("INSERT INTO ledens.projects(name,project_id) VALUES('Obra Deshacer','P-DESHACER') RETURNING id")).rows[0].id;
 const emp=(await q("INSERT INTO ledens.employees(name,activo) VALUES('Trabajador Deshacer',true) RETURNING id")).rows[0].id;
 const active=async(b)=>(await q(`SELECT r.category,r.gross_amount::text gross,(SELECT project_id FROM ledens.project_financial_allocations a WHERE a.record_id=r.id) project
  FROM ledens.financial_records r WHERE r.bank_movement_id=$1 AND r.source_valid AND r.status<>'excluded' ORDER BY r.gross_amount`,[b])).rows;
 const events=async(action)=>(await q('SELECT reason,before_value FROM ledens.finance_events WHERE action=$1 ORDER BY id',[action])).rows;

 // 1) Sent to Pago a trabajadores and one line saved with its worker and obra: it can become materials.
 const nomina=await bankRow(-160,'Pago trabajador equivocado');
 await classify(nomina,'trabajadores');
 const lines=(await q('SELECT s.id FROM ledens.worker_payment_splits s JOIN ledens.worker_payment_batches b ON b.id=s.batch_id WHERE b.bank_movement_id=$1 ORDER BY s.line_number',[nomina])).rows;
 assert.equal(lines.length,3);
 assert.equal((await asAdmin().saveWorkerSplits({items:[{splitId:lines[0].id,employeeId:emp,projectId:project}]})).ok,1);
 assert.deepEqual([(await row(nomina)).clase,(await row(nomina)).lote,(await row(nomina)).registros],['trabajadores',true,1]);
 await assert.rejects(classify(nomina,'materiales'),{status:400,message:/motivo/});
 const res=await classify(nomina,'materiales','Era un pago a la ferretería');
 assert.equal(res.via,'material');
 assert.deepEqual([(await row(nomina)).clase,(await row(nomina)).lote,(await row(nomina)).origen],['materiales',false,'provisional']);
 assert.deepEqual(await active(nomina),[{category:'materials',gross:'160.00',project:null}],'only the provisional material counts: the saved worker payment no longer does');
 assert.equal((await q('SELECT count(*)::int n FROM ledens.worker_payment_batches WHERE bank_movement_id=$1',[nomina])).rows[0].n,0,'its lines left Pendiente de trabajador');
 const undone=(await events('worker_payment_undone')).at(-1);
 assert.match(undone.reason,/Era un pago a la ferretería/);
 assert.equal(undone.before_value.allocations[0].project_id,project,'the history keeps the obra it had');
 assert.equal((await q("SELECT count(*)::int n FROM ledens.financial_records r JOIN ledens.worker_payments w ON w.id=r.worker_payment_id WHERE w.bank_movement_id=$1 AND r.status='excluded'",[nomina])).rows[0].n,1,'excluded, never deleted');

 // 2) And back to Pago a trabajadores: the provisional is undone and a new batch is created.
 assert.equal((await classify(nomina,'trabajadores','Sí era el trabajador')).via,'pendiente-trabajador');
 assert.deepEqual([(await row(nomina)).clase,(await row(nomina)).lote],['trabajadores',true]);
 assert.deepEqual(await active(nomina),[]);
 assert.equal((await q('SELECT count(*)::int n FROM ledens.provisional_material_payments WHERE bank_movement_id=$1',[nomina])).rows[0].n,0,'no provisional left for 026/029 to replace');
 // ...and to materials again: the same provisional material comes back.
 const again=await classify(nomina,'materiales','Al final era material');
 assert.deepEqual([again.materialId,again.restored],[res.materialId,true]);
 assert.equal((await row(nomina)).origen,'provisional');

 // 3) A cash payment sent to Pago a trabajadores becomes materials too.
 const cash=(await q("INSERT INTO ledens.cash_movements(kind,amount,occurred_on,concept) VALUES('pago',70,'2026-10-20','Efectivo trabajador') RETURNING id")).rows[0].id;
 await classify(cash,'trabajadores');
 assert.equal((await row(cash)).lote,true);
 assert.equal((await classify(cash,'materiales','Eran tornillos')).via,'efectivo');
 assert.deepEqual([(await row(cash)).clase,(await row(cash)).lote],['materiales',false]);

 // 4) A registered supplier refund becomes a client receipt, and back.
 const abono=await bankRow(35,'Devolución o cobro');
 const refund=await classify(abono,'reembolso_proveedor');
 assert.equal((await classify(abono,'clientes','Era el cliente')).via,'cobro-cliente');
 assert.deepEqual(await active(abono),[{category:'advance',gross:'35.00',project:null}]);
 assert.equal((await row(abono)).clase,'clientes');
 const back=await classify(abono,'reembolso_proveedor','Era la devolución');
 assert.deepEqual([back.materialId,back.restored],[refund.materialId,true]);
 assert.deepEqual(await active(abono),[{category:'materials',gross:'-35.00',project:null}]);
 const receipt=await classify(abono,'clientes','Era el cliente al final');
 assert.equal(receipt.restored,true,'the client receipt comes back too');
 assert.equal((await q('SELECT count(*)::int n FROM ledens.customer_payments WHERE bank_movement_id=$1',[abono])).rows[0].n,1);
 assert.equal((await row(abono)).clase,'clientes');
});
