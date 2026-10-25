import {createHash} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {cents,decimal,day} from '../bridge/rules.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const check=(v,code)=>{if(!v)throw new Error(code);};
function ibanValid(s){if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s))return false;let n=0;for(const ch of s.slice(4)+s.slice(0,4)){for(const digit of /[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch)n=(n*10+Number(digit))%97;}return n===1;}
export function parseRevolutPage(items,{pageCount=1}={}){
 const groups=[];for(const item of items){if(!item.str?.trim())continue;let g=groups.find(g=>Math.abs(g.y-item.y)<2);if(!g){g={y:item.y,items:[]};groups.push(g);}g.items.push(item);}
 const rows=groups.sort((a,b)=>b.y-a.y).map(g=>({...g,items:g.items.sort((a,b)=>a.x-b.x),text:g.items.map(i=>i.str).join(' ')}));const text=rows.map(r=>r.text).join('\n');
 if(!/Transaction statement/i.test(text)||!/Revolut Bank UAB/i.test(text))return null;
 try{
  check(pageCount===1,'multiple_pages');
  const dates=[...new Set([...text.matchAll(/Transaction of\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/g)].map(m=>`${m[3]}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`))];
  check(dates.length===1&&day(dates[0])!==null&&Number(dates[0].slice(0,4))>=2000&&Number(dates[0].slice(0,4))<=new Date().getUTCFullYear()+1,'transaction_date');
  const currencies=[...new Set([...text.matchAll(/\bCurrency\s+([A-Z]{3})\b/g)].map(m=>m[1]))];check(currencies.length===1&&currencies[0]==='EUR','currency');
  const accounts=[...new Set(items.map(i=>i.str.replace(/^IBAN\s+/,'').replace(/\s/g,'')).filter(s=>/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)))];check(accounts.length===1&&accounts.every(ibanValid),'account');
  const header=rows.filter(r=>/Money out/.test(r.text)&&/Money in/.test(r.text)&&/Status/.test(r.text));check(header.length===1,'column_headers');
  const h=header[0],out=h.items.find(i=>i.str.trim()==='Money out'),incoming=h.items.find(i=>i.str.trim()==='Money in'),status=h.items.find(i=>i.str.trim()==='Status');check(out&&incoming&&status&&out.x<incoming.x,'column_positions');
  const moneyItems=items.filter(i=>i.y<h.y&&/^(?:€\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\s*€)$/.test(i.str.trim()));check(moneyItems.length===1,'transaction_count');
  const item=moneyItems[0],row=rows.find(r=>r.items.includes(item));check(row&&row.items.some(i=>i.str.trim()==='Completed'),'transaction_not_completed');
  const s=item.str.replace(/[€\s]/g,''),value=cents(s.includes(',')&&s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,''));check(value!==null&&value>0n,'amount');
  check(item.x>=out.x-5,'amount_column');const direction=item.x<(out.x+incoming.x)/2?'Pagar':'Cobrar';
  const description=row.items.filter(i=>i.x<status.x).map(i=>i.str).join(' ').trim();check(description.length>=3&&description.length<=1000,'description');
  const vendor=/^Revolut Business Fee/i.test(description)?'Revolut Business':description.split('•')[0].trim();
  const data={source:'native-revolut-statement-v1',date:dates[0],currency:'EUR',direction,total:decimal(direction==='Pagar'?-value:value),vendor,description,account_hash:hash(accounts[0]),statement_status:'Completed'};
  data.fingerprint=hash(JSON.stringify(data));return {data};
 }catch(e){return {reason:'revolut_statement_'+e.message};}
}
export async function readRevolutPdf(content){let pdf;try{pdf=await getDocument({data:new Uint8Array(content),isEvalSupported:false,useSystemFonts:true,disableFontFace:true}).promise;const page=await pdf.getPage(1),text=await page.getTextContent();return parseRevolutPage(text.items.map(i=>({str:i.str,x:i.transform?.[4],y:i.transform?.[5]})),{pageCount:pdf.numPages});}catch{return null;}finally{await pdf?.destroy();}}
