import {normalize,cents,decimal} from '../bridge/rules.js';
import {extractedLineItems} from './line-items.js';
export function extractLines(result){
 if(/DEPOSITO PREVIO ICIO/i.test(result.analyzeResult?.content||'')&&/PRESUPUESTO EJECUCI[ÓO]N DE OBRAS/i.test(result.analyzeResult?.content||''))return [];
 return extractedLineItems(result);
}
export async function storeInvoiceLines(c,documentId,lines,{currency,direction,actorId=null,reason='Desglose documental verificado contra el total'}={}){
 if(!(await c.query("SELECT to_regclass('ledens.invoice_lines') table_name")).rows[0].table_name)return;
 const d=(await c.query('SELECT * FROM ledens.documents WHERE id=$1 FOR UPDATE',[documentId])).rows[0];if(!d)return;
 const existing=(await c.query('SELECT r.*,l.line_number FROM ledens.financial_records r LEFT JOIN ledens.invoice_lines l ON l.id=r.invoice_line_id WHERE r.document_id=$1 FOR UPDATE OF r',[documentId])).rows;
 const active=existing.filter(r=>r.source_valid&&r.status!=='excluded');
 const values=lines.map(line=>{const n=cents(line.net_amount),v=cents(line.vat_amount);return {...line,gross:cents(line.gross_amount)??(!line.evidence&&n!==null&&v!==null?n+v:null)};});
 const expected=cents(d.total)===null?null:d.tipo==='Pagar'?-cents(d.total):cents(d.total);
 const balanced=Boolean(direction&&expected!==null&&expected!==0n&&values.length&&values.every(l=>l.gross!==null&&l.gross!==0n&&(!l.currency||!currency||l.currency===currency))&&values.reduce((s,l)=>s+l.gross,0n)===expected);
 const envelopes=active.filter(r=>r.line_number===10000);
 if(balanced){
  if(active.some(r=>!r.invoice_line_id))throw new Error('existing_source_requires_line_review');
  for(const r of envelopes){if(r.status!=='pending'||(await c.query('SELECT 1 FROM ledens.project_financial_allocations WHERE record_id=$1 LIMIT 1',[r.id])).rows.length)throw new Error('assigned_envelope_requires_line_review');}
  for(const line of values){const r=active.find(r=>r.line_number===line.line_number);if(r&&cents(r.gross_amount)!==line.gross)throw new Error('existing_line_amount_requires_review');}
 }
 for(const line of values){
  const r=active.find(r=>r.line_number===line.line_number);if(r)continue;
  const evidence={origin:'azure-di',amount_basis:'verify_net_and_tax',...line.evidence,product_code:line.product_code||line.evidence?.product_code||null,unit_price:line.unit_price??line.evidence?.unit_price??null};
  const row=(await c.query(`INSERT INTO ledens.invoice_lines(document_id,line_number,description,quantity,net_amount,vat_amount,gross_amount,currency,extraction_confidence,evidence)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(document_id,line_number) DO UPDATE SET description=excluded.description,quantity=excluded.quantity,net_amount=excluded.net_amount,vat_amount=excluded.vat_amount,gross_amount=excluded.gross_amount,currency=excluded.currency,extraction_confidence=excluded.extraction_confidence,evidence=ledens.invoice_lines.evidence||excluded.evidence RETURNING id`,
   [documentId,line.line_number,line.description||'Concepto '+line.line_number,line.quantity??null,line.net_amount??null,line.vat_amount??null,line.gross===null?null:decimal(line.gross),line.currency||currency,line.confidence||0,JSON.stringify(evidence)])).rows[0];
  if(!balanced)continue;
  await c.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,counterparty,gross_amount,net_amount,vat_amount,currency)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(invoice_line_id) DO NOTHING`,[row.id,documentId,d.document_on,line.description||'Concepto '+line.line_number,d.tercero,decimal(line.gross),line.net_amount??null,line.vat_amount??null,line.currency||currency]);
 }
 if(balanced){
  for(const r of envelopes){
   await c.query("UPDATE ledens.financial_records SET status='excluded',source_valid=false,version=version+1,updated_at=now() WHERE id=$1",[r.id]);
   await c.query('INSERT INTO ledens.finance_events(record_id,actor_id,action,reason,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)',[r.id,actorId,'document_line_breakdown_replaced',reason,JSON.stringify(r),JSON.stringify({document_id:documentId,line_count:values.length,total:decimal(expected)})]);
  }
  return {line_count:values.length,balanced:true,replaced_envelopes:envelopes.length};
 }
 if(expected!==null&&expected!==0n&&!active.length){
  const l=(await c.query(`INSERT INTO ledens.invoice_lines(document_id,line_number,description,evidence) VALUES($1,10000,'Documento pendiente de desglose','{"kind":"document_review_envelope"}') ON CONFLICT(document_id,line_number) DO NOTHING RETURNING id`,[documentId])).rows[0];
  if(l)await c.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,counterparty,gross_amount,currency) VALUES($1,$2,$3,'Documento pendiente de desglose',$4,$5,$6)`,[l.id,documentId,d.document_on,d.tercero,decimal(expected),currency||null]);
 }
 return {line_count:values.length,balanced:false,replaced_envelopes:0};
}
export async function projectSuggestions(c,record,user){
 const projects=(await c.query(`SELECT id,project_id code,name FROM ledens.projects
  WHERE project_id IS NOT NULL AND length(project_id)>=5 AND ($1 OR EXISTS
   (SELECT 1 FROM ledens.finance_project_permissions f WHERE f.user_id=$2 AND f.project_id=ledens.projects.id))
  ORDER BY id LIMIT 1001`,[user.role==='admin',user.id])).rows;
 if(projects.length>1000)return [];
 const text=' '+normalize(record.description)+' ';
 return projects.filter(p=>text.includes(' '+normalize(p.code)+' ')).map(p=>({project_id:p.id,project_name:p.name,
  rule:'exact_project_code',evidence:p.code,status:'suggested',confidence:null}));
}
