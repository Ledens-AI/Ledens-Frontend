import {randomUUID} from 'node:crypto';
import {municipalAssessment} from './municipal.js';
import {FinanceService} from '../finance/service.js';
import {BridgeService} from '../bridge/service.js';
import {cents,abs,decimal,hasParty} from '../bridge/rules.js';
export async function recoverMunicipalAssessment(pool,{ingestionId,actorId,result,apply=false}){
 const parsed=municipalAssessment(result);if(!parsed)throw new Error('municipal_evidence_not_verified');
 const user=(await pool.query('SELECT id,email,role FROM users WHERE id=$1',[actorId])).rows[0];
 if(user?.role!=='admin')throw new Error('admin_required');
 const finance=new FinanceService(pool),bridge=new BridgeService(pool);
 const reason='Revisión solicitada por el usuario: fecha de expedición y cuota ICIO verificadas en el original; presupuesto y tipo no son conceptos; evitar duplicar el provisional bancario.';
 const state=await finance.transaction(async c=>{
  const ingestion=(await c.query('SELECT * FROM ledens.invoice_ingestions WHERE id=$1 FOR UPDATE',[ingestionId])).rows[0];if(!ingestion)throw new Error('ingestion_not_found');
  const doc=(await c.query('SELECT * FROM ledens.documents WHERE id=$1 FOR UPDATE',[ingestion.document_id])).rows[0];
  const candidates=(await c.query(`SELECT * FROM ledens.bank_movements WHERE amount=-$1::numeric AND currency='EUR' AND state='COMPLETED' AND NOT coalesce(is_internal_transfer,false) AND reference ILIKE $2 AND completed_on BETWEEN $3::date-7 AND $3::date+90 FOR UPDATE`,[parsed.total,'%'+parsed.reference+'%',parsed.date])).rows.filter(x=>hasParty({tercero:parsed.vendor},x));
  if(candidates.length!==1)throw new Error('bank_match_not_unique');const bank=candidates[0];
  const fee=cents(bank.bank_fee??'0');if(fee===null||fee<0n||cents(bank.total_amount)!==cents(bank.amount)-fee)throw new Error('bank_fee_not_verified');
  const existing=(await c.query('SELECT * FROM ledens.financial_records WHERE document_id=$1 AND invoice_line_id IS NOT NULL',[doc.id])).rows;
  const recovery=existing.find(r=>r.description===parsed.description&&cents(r.gross_amount)===cents(parsed.total));
  if(recovery)return {document_id:doc.id,bank_id:bank.id,record_id:recovery.id,fee:decimal(fee),parsed,replay:true};
  if(existing.length)throw new Error('existing_financial_lines_require_review');
  const related=(await c.query('SELECT f.*,d.numerodocumento,d.enlacearchivo,d.observaciones FROM ledens.financial_records f JOIN ledens.documents d ON d.id=f.document_id WHERE f.bank_movement_id=$1 AND f.document_id<>$2',[bank.id,doc.id])).rows;
  for(const r of related){if(r.status!=='pending'||!r.material_id||r.numerodocumento||r.enlacearchivo||!/Registro creado autom.ticamente desde FactMovimientosBancarios/i.test(r.observaciones||''))throw new Error('existing_source_requires_review');}
  const beforeLines=(await c.query('SELECT * FROM ledens.invoice_lines WHERE document_id=$1',[doc.id])).rows;
  if((await c.query('SELECT 1 FROM ledens.bank_document_allocations WHERE bank_movement_id=$1 OR document_id=$2',[bank.id,doc.id])).rows.length)throw new Error('existing_bridge_requires_review');
  if(!apply)return {document_id:doc.id,bank_id:bank.id,fee:decimal(fee),parsed,provisionals:related.map(r=>r.id),apply:false};
  for(const r of related){
   const before=await finance.record(c,r.id,user,true);
   await c.query(`UPDATE ledens.financial_records SET status='excluded',source_valid=false,version=version+1,updated_at=now() WHERE id=$1`,[r.id]);
   await finance.audit(c,before,user,'source_replaced',reason,{canonical_document_id:doc.id,old_project_allocations_preserved:true});
   await c.query(`UPDATE ledens.documents SET review_state='Sustituido',observaciones=coalesce(observaciones,'')||$2 WHERE id=$1`,[r.document_id,'\nProvisional sustituido por documento real '+doc.id+'; cuota '+parsed.total+' EUR y comisión bancaria '+decimal(fee)+' EUR separadas.']);
   await c.query(`UPDATE ledens.bridge_cases SET status='dismissed',reason='source_placeholder_replaced',resolution_mode='manual',version=version+1,next_attempt_at='infinity',updated_at=now() WHERE document_id=$1 AND status='pending'`,[r.document_id]);
  }
  await c.query(`UPDATE ledens.documents SET document_on=$2,trimestre=$3,numerodocumento=$4,tercero=$5,total=-$6::numeric,tipo='Pagar',base_amount=NULL,vat_amount=NULL,review_state='Revisado',observaciones=coalesce(observaciones,'')||$7 WHERE id=$1`,[doc.id,parsed.date,parsed.quarter,parsed.liquidation,parsed.vendor,parsed.total,'\n'+reason+' Expediente '+parsed.reference+'; no constituye clasificación como materiales ni aprobación contable.']);
  await c.query(`UPDATE ledens.invoice_ingestions SET status='ready',reason=NULL,invoice_date=$2,date_confidence=$3,total_confidence=$4,invoice_currency='EUR',destination_folder=$5,updated_at=now() WHERE id=$1`,[ingestion.id,parsed.date,parsed.confidence,parsed.totalConfidence,'/Shared Documents/datasource/'+parsed.quarter]);
  // Retain incorrect OCR readings in evidence instead of deleting their history.
  await c.query(`UPDATE ledens.invoice_lines SET evidence=evidence||jsonb_build_object('superseded_by_municipal_review',true,'original_net_amount',net_amount),net_amount=NULL,vat_amount=NULL,gross_amount=NULL WHERE document_id=$1`,[doc.id]);
  const line=(await c.query(`INSERT INTO ledens.invoice_lines(document_id,line_number,description,gross_amount,currency,evidence) VALUES($1,9999,$2,$3,'EUR',$4) RETURNING id`,[doc.id,parsed.description,parsed.total,JSON.stringify(parsed.evidence)])).rows[0];
  const record=(await c.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,bank_movement_id,occurred_on,description,counterparty,category,gross_amount,currency) VALUES($1,$2,$3,$4,$5,$6,'other_direct',$7,'EUR') RETURNING *`,[line.id,doc.id,bank.id,parsed.date,parsed.description,parsed.vendor,parsed.total])).rows[0];
  await finance.audit(c,record,user,'municipal_document_recovered',reason,{before_document:doc,before_lines:beforeLines,evidence:parsed.evidence,reference:parsed.reference,bank_id:bank.id});
  return {document_id:doc.id,bank_id:bank.id,record_id:record.id,fee:decimal(fee),parsed};
 });
 if(!apply)return state;
 const details=await bridge.details(state.document_id);
 if(details.case.status==='matched')return {...state,bridge:'matched'};
 const choice=details.candidates.find(x=>x.bank_movement_id===state.bank_id);if(!choice)throw new Error('bank_candidate_changed');
 const confirmation=await bridge.confirm(state.document_id,{bank_movement_id:state.bank_id,amount:parsed.total,currency:'EUR',tipo:'Pagar',reason,request_id:randomUUID(),version:details.case.version,document_fingerprint:details.document.document_fingerprint,bank_fingerprint:choice.bank_fingerprint},actorId);
 return {...state,bridge:confirmation.status};
}
