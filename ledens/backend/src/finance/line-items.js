import {cents,decimal,INVOICE_MIN_CONFIDENCE} from '../bridge/rules.js';
const money=f=>f?.valueCurrency?.amount??f?.valueNumber??null;
const amount=f=>cents(money(f));
const trusted=f=>f&&typeof f.confidence==='number'&&f.confidence>=INVOICE_MIN_CONFIDENCE&&f.confidence<=1;
const round=(n,d)=>n<0n?-((-n+d/2n)/d):(n+d/2n)/d;
const rate=f=>{const s=String(f?.valueNumber??f?.valueString??'').replace('%','').trim().replace(',','.');const n=cents(s);return n!==null&&n>=0n&&n<=10000n?n:null;};
export function extractedLineItems(result){
 const doc=result.analyzeResult?.documents?.[0],fields=doc?.fields||{},items=fields.Items?.valueArray;
 if(!Array.isArray(items)||items.length>500)return [];
 const rows=items.map((item,index)=>{const f=item.valueObject||{};return {line_number:index+1,description:(f.Description?.valueString||f.Description?.content||'').slice(0,1000),quantity:f.Quantity?.valueNumber??null,
  product_code:(f.ProductCode?.valueString||'').slice(0,100),unit_price:money(f.UnitPrice),net_amount:money(f.Amount),vat_amount:money(f.Tax),gross_amount:null,currency:f.Amount?.valueCurrency?.currencyCode||null,confidence:f.Amount?.confidence||0,
  evidence:{origin:'azure-di',product_code:f.ProductCode?.valueString||null,unit_price:money(f.UnitPrice),raw_amount:money(f.Amount),raw_tax:money(f.Tax),tax_rate:f.TaxRate?.valueString??f.TaxRate?.valueNumber??null,amount_basis:'unverified'},fields:f};});
 const total=amount(fields.InvoiceTotal),tax=amount(fields.TotalTax);
 if(total===null||!trusted(fields.InvoiceTotal))return rows.map(({fields,...r})=>r);
 const net=tax!==null&&trusted(fields.TotalTax)?total-tax:null;
 const candidates=rows.map(r=>{
  const f=r.fields,a=amount(f.Amount),t=amount(f.Tax),pct=rate(f.TaxRate),options=new Map();
  const add=(n,v,basis)=>{const g=n+v;if(!g)return;options.set(n+':'+v,{net:n,vat:v,gross:g,basis});};
  if(a===null||!trusted(f.Amount))return [];
  if(t!==null&&trusted(f.Tax)){add(a,t,'amount_excludes_tax');add(a-t,t,'amount_includes_tax');}
  if(pct!==null&&trusted(f.TaxRate)){add(a,round(a*pct,10000n),'rate_amount_excludes_tax');const n=round(a*10000n,10000n+pct);add(n,a-n,'rate_amount_includes_tax');}
  return [...options.values()];
 });
 // A unique reconciliation of line gross AND net is required before inferring tax basis.
 let states=new Map([['0:0',{gross:0n,net:0n,count:1,previous:null,choice:null}]]),overflow=false;
 if(net===null||candidates.some(c=>!c.length))states.clear();
 for(const options of candidates){
  const next=new Map();
  for(const previous of states.values())for(const choice of options){
   const gross=previous.gross+choice.gross,n=previous.net+choice.net,key=gross+':'+n;
   const old=next.get(key);if(old)old.count=Math.min(2,old.count+previous.count);else next.set(key,{gross,net:n,count:previous.count,previous,choice});
   if(next.size>2048){overflow=true;break;}
  }
  if(overflow){states.clear();break;}states=next;
 }
 const solution=net===null?null:states.get(total+':'+net);
 if(solution?.count===1){
  const chosen=[];for(let n=solution;n?.choice;n=n.previous)chosen.unshift(n.choice);
  return rows.map(({fields,...r},i)=>({...r,net_amount:decimal(chosen[i].net),vat_amount:decimal(chosen[i].vat),gross_amount:decimal(chosen[i].gross),evidence:{...r.evidence,amount_basis:chosen[i].basis,document_totals_reconciled:true}}));
 }
 // Even with unknown tax, explicit line gross amounts can be assigned if their sum is exact.
 const raw=rows.map(r=>amount(r.fields.Amount));
 if(raw.every(n=>n!==null)&&rows.every(r=>trusted(r.fields.Amount))&&raw.reduce((a,n)=>a+n,0n)===total){
  return rows.map(({fields,...r},i)=>({...r,net_amount:null,vat_amount:null,gross_amount:decimal(raw[i]),evidence:{...r.evidence,amount_basis:'gross_total_reconciled_tax_requires_review',document_totals_reconciled:true}}));
 }
 return rows.map(({fields,...r})=>r);
}
