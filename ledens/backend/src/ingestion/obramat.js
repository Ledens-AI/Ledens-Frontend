import {createHash} from 'node:crypto';
import {cents,decimal,taxId,normalize} from '../bridge/rules.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const money=s=>{s=String(s).replace(/−/g,'-');return cents(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const check=(ok,code)=>{if(!ok)throw new Error(code);};
function allocateNet(rows,net,rate){
 const denominator=10000n+rate;const parts=rows.map(l=>({l,value:money(l.gross_amount)*10000n/denominator,remainder:money(l.gross_amount)*10000n%denominator}));
 let residual=net-parts.reduce((s,p)=>s+p.value,0n);check(residual>=0n&&residual<=BigInt(parts.length),'tax_rounding_inconsistent');
 for(const p of [...parts].sort((a,b)=>a.remainder===b.remainder?a.l.line_number-b.l.line_number:a.remainder>b.remainder?-1:1)){if(residual>0n){p.value++;residual--;}}
 return parts.map(p=>({...p.l,net_amount:decimal(p.value),vat_amount:decimal(money(p.l.gross_amount)-p.value),evidence:{...p.l.evidence,net_basis:'gross_and_document_tax_group',rounding_rule:'largest_remainder_line_number'}}));
}
export function parseObramatPages(pages,{businessTaxId='B19753805'}={}){
 const all=pages.join('\n');
 if(!/BRICOLAJE BRICOMAN/i.test(all)||!/PAGO ANTICIPADO DEL PEDIDO|YA PAGADO DEL PEDIDO|Reembolso Acuenta|Entrega \(/i.test(all))return null;
 try{
  check(/B[\s-]*84406289/i.test(all),'issuer_not_verified');
  const financial=pages.filter(p=>/FACTURA\s+(?:RECTIFICATIVA\s+)?\d{3}-/i.test(p));
  check(financial.length>0&&pages.every(p=>financial.includes(p)||/^\s*CONDICIONES GENERALES/i.test(p)),'unknown_financial_page');
  const text=financial.join('\n');check(/\bEUR\b/.test(text),'currency_not_verified');const numbers=[...new Set([...text.matchAll(/FACTURA\s+(?:RECTIFICATIVA\s+)?(\d{3}-\d{4}-(?:R)?\d+)/gi)].map(m=>m[1]))];check(numbers.length===1,'multiple_invoice_numbers');
  const customer=[...new Set([...text.matchAll(/Numero NIF\s*:\s*([A-Z0-9-]+)/gi)].map(m=>taxId(m[1])))];check(customer.length===1&&customer[0]===taxId(businessTaxId),'buyer_not_verified');
  const orders=[...new Set([...text.matchAll(/(?:PEDIDO\s*(?:NO)?\s*:?\s*|Reembolso Acuenta\s*\(\s*)(\d{4,})/gi)].map(m=>m[1]))];check(orders.length===1,'order_not_unique');
  const pageNumbers=[...text.matchAll(/Pag\.\s*(\d+)\s*\/\s*(\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  check(pageNumbers.length===financial.length&&pageNumbers.every(p=>p[1]===financial.length)&&new Set(pageNumbers.map(p=>p[0])).size===financial.length&&pageNumbers.every(p=>p[0]>=1&&p[0]<=financial.length),'missing_invoice_page');
  if(!/PAGO ANTICIPADO DEL PEDIDO|YA PAGADO DEL PEDIDO|Reembolso Acuenta/i.test(text))return null;
  const dates=[...new Set([...text.matchAll(/Fecha de (?:venta|devolucion)\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/gi)].map(m=>m[3]+'-'+m[2]+'-'+m[1]))];check(dates.length===1,'date_not_unique');
  const date=new Date(dates[0]+'T00:00:00Z');check(Number.isFinite(+date)&&date.toISOString().slice(0,10)===dates[0]&&date.getUTCFullYear()>=2000&&date.getUTCFullYear()<=new Date().getUTCFullYear()+1,'invalid_invoice_date');
  const rows=[];const lines=text.split('\n').map(s=>s.trim());
  const row=/^(\d{1,3})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:(UNID\.)\s+)?(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s+(\d+[.,]\d{2})\s+(-?[\d.,]+)\s+(-?[\d.,]+)$/;
  for(let i=0;i<lines.length;i++){const m=lines[i].match(row);if(!m)continue;const sku=lines[i+1];check(/^\d{8}$/.test(sku),'item_reference_missing');const gross=money(m[10]),quantity=m[3].replace(',','.');check(gross!==null&&gross!==0n,'invalid_item_amount');
   const q=Number(quantity),unitGross=money(m[9]);check(Number.isInteger(q)&&q>0&&unitGross!==null&&unitGross*BigInt(q)===gross,'item_quantity_amount_mismatch');
   rows.push({line_number:Number(m[1]),description:m[2],product_code:sku,quantity:q,gross_amount:decimal(gross),rate:money(m[8]),evidence:{origin:'native-pdf-obramat-v1',product_code:sku,unit_price:m[5].replace(',','.'),unit_gross:decimal(unitGross),unit:'UNID.',line_kind:/PALET RETORNABLE/i.test(m[2])?'returnable_deposit':/PREPARACION MERCANCIA/i.test(m[2])?'preparation_service':'product'}});
  }
  check(rows.length>0&&rows.every((r,i)=>r.line_number===i+1),'missing_or_duplicate_item');
  const summary=[...text.matchAll(/^(ANTICIPO\s+)?(\d+[.,]\d{2})%?\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s*$/gm)].map(m=>({advance:Boolean(m[1]),rate:money(m[2]),net:money(m[3]),vat:money(m[4]),due:money(m[5])}));
  check(summary.length>0&&summary.every(s=>s.net!==null&&s.vat!==null&&s.due!==null),'tax_summary_missing');
  const positive=rows.filter(r=>money(r.gross_amount)>0n),negative=rows.filter(r=>money(r.gross_amount)<0n),total=rows.reduce((s,r)=>s+money(r.gross_amount),0n);
  let kind,goods=[],goodsNet=0n,goodsVat=0n,applied=0n;
  if(rows.length===1&&positive.length===1&&/^PAGO ANTICIPADO DEL PEDIDO /i.test(rows[0].description)&&rows[0].product_code==='99999991'){
   kind='advance';check(summary.length===1&&summary[0].advance&&summary[0].net+summary[0].vat===total&&summary[0].due===total,'advance_total_mismatch');
  }else if(rows.length===1&&negative.length===1&&/^YA PAGADO DEL PEDIDO /i.test(rows[0].description)&&/FACTURA RECTIFICATIVA/i.test(text)&&/Reembolso Acuenta/i.test(text)){
   kind='advance_refund';check(summary.length===1&&summary[0].advance&&summary[0].net+summary[0].vat===total&&summary[0].due===total,'refund_total_mismatch');
  }else{
   kind='delivery';check(positive.length>0&&negative.length===1&&negative[0].product_code==='99999991'&&/^YA PAGADO DEL PEDIDO /i.test(negative[0].description)&&total===0n,'delivery_not_settled');
   applied=-money(negative[0].gross_amount);const groups=summary.filter(s=>!s.advance&&s.net>0n),adjustments=summary.filter(s=>s.advance&&s.net<0n);
   check(groups.length>0&&new Set(groups.map(s=>String(s.rate))).size===groups.length&&groups.reduce((s,g)=>s+g.net+g.vat,0n)===applied&&adjustments.reduce((s,g)=>s-g.net-g.vat,0n)===applied&&summary.every(s=>s.due===0n),'delivery_tax_mismatch');
   for(const g of groups){const members=positive.filter(l=>l.rate===g.rate);check(members.length>0&&members.reduce((s,l)=>s+money(l.gross_amount),0n)===g.net+g.vat,'item_tax_group_mismatch');goods.push(...allocateNet(members,g.net,g.rate));goodsNet+=g.net;goodsVat+=g.vat;}
   check(goods.length===positive.length,'unknown_item_tax_rate');goods.sort((a,b)=>a.line_number-b.line_number);
  }
  const data={kind,issuer_tax_id:'B84406289',buyer_tax_id:customer[0],document_number:numbers[0],order_reference:orders[0],currency:'EUR',issued_on:dates[0],nominal_gross:decimal(total),nominal_net:decimal(summary.reduce((n,s)=>n+s.net,0n)),nominal_vat:decimal(summary.reduce((n,s)=>n+s.vat,0n)),goods_gross:decimal(applied),goods_net:decimal(goodsNet),goods_vat:decimal(goodsVat),applied_gross:decimal(applied),lines:goods.map(({rate,...l})=>l),settlement_lines:rows.filter(r=>!goods.some(g=>g.line_number===r.line_number)).map(({rate,...r})=>({...r,evidence:{...r.evidence,line_kind:kind==='delivery'?'advance_application':kind}})),financial_pages:financial.length,original_pages:pages.length};
  data.fingerprint=digest({...data,original_pages:undefined,financial_pages:undefined});return {data};
 }catch(e){return {reason:'purchase_'+e.message};}
}
export async function readObramatPdf(content,options={}){
 let pdf;try{
  pdf=await getDocument({data:new Uint8Array(content),isEvalSupported:false,useSystemFonts:true,disableFontFace:true}).promise;
  if(pdf.numPages>10)return null;const pages=[];
  for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),text=await page.getTextContent(),groups=[];
   for(const item of text.items.filter(x=>x.str?.trim())){let g=groups.find(g=>Math.abs(g.y-item.transform[5])<2);if(!g){g={y:item.transform[5],items:[]};groups.push(g);}g.items.push(item);}
   pages.push(groups.sort((a,b)=>b.y-a.y).map(g=>g.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(i=>i.str).join(' ')).join('\n'));
  }
  return parseObramatPages(pages,options);
 }catch{return null;}finally{await pdf?.destroy();}
}
