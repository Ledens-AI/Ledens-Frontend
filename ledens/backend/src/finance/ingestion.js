import {normalize,cents,decimal} from '../bridge/rules.js';

// Extracted lines are evidence, never approved accounting entries by themselves.
export function extractLines(result){
 const items=result.analyzeResult?.documents?.[0]?.fields?.Items?.valueArray;
 if(!Array.isArray(items))return [];
 return items.slice(0,500).map((item,index)=>{
   const f=item.valueObject||{};
   const money=k=>f[k]?.valueCurrency?.amount??f[k]?.valueNumber??null;
   return {line_number:index+1,description:(f.Description?.valueString||f.Description?.content||'').slice(0,1000),
     quantity:f.Quantity?.valueNumber??null,net_amount:money('Amount'),vat_amount:money('Tax'),
     currency:f.Amount?.valueCurrency?.currencyCode||null,confidence:f.Amount?.confidence||0};
 });
}
export async function storeInvoiceLines(c,documentId,lines,{currency,direction}={}){
 if(!(await c.query("SELECT to_regclass('ledens.invoice_lines') table_name")).rows[0].table_name)return;
 for(const line of lines){
   if(cents(line.net_amount)===null)continue;
   const row=(await c.query(`INSERT INTO ledens.invoice_lines(document_id,line_number,description,quantity,net_amount,vat_amount,currency,extraction_confidence,evidence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(document_id,line_number) DO NOTHING RETURNING *`,
    [documentId,line.line_number,line.description,line.quantity,line.net_amount,line.vat_amount,line.currency||currency,line.confidence,JSON.stringify({origin:'azure-di',amount_basis:'verify_net_and_tax'})])).rows[0];
   if(!row||!direction||cents(line.vat_amount)===null)continue;
   const gross=cents(line.net_amount)+cents(line.vat_amount);
   if(gross===0n)continue;
   await c.query(`INSERT INTO ledens.financial_records(invoice_line_id,document_id,occurred_on,description,gross_amount,currency)
    SELECT $1,d.id,d.document_on,$3,$4,$5 FROM ledens.documents d WHERE d.id=$2`,
    [row.id,documentId,line.description,decimal(gross),line.currency||currency]);
 }
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
