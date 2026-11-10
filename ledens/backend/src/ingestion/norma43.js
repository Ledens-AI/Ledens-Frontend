// Reader of «Cuaderno 43» (Norma 43 AEB/CSB), the fixed-width account statement
// Spanish banks export as .txt: 80-character records, ISO-8859-1.
//   11 account header (period, opening balance)   22 movement
//   23 extra concept lines of the last movement    24 currency equivalence (ignored)
//   33 account trailer (counts, totals, closing)   88 end of file (record count)
// Nothing is guessed: a file whose counts, totals or balances do not add up is
// refused whole, so a truncated or edited statement never reaches the ledger.
import {decimal} from '../bridge/rules.js';

export class Norma43Error extends Error{
 constructor(code,line=null){super('norma43_'+code);this.code='norma43_'+code;this.line=line;}
}
const fail=(code,line)=>{throw new Norma43Error(code,line);};
const digits=(s,code,line)=>{if(!/^\d+$/.test(s))fail(code,line);return s;};
const cents=(s,line)=>BigInt(digits(s,'amount',line));
// «1» debe (cargo), «2» haber (abono).
const signed=(sign,value,line)=>sign==='1'?-value:sign==='2'?value:fail('sign',line);
function date(s,line){
 digits(s,'date',line);
 const iso=`20${s.slice(0,2)}-${s.slice(2,4)}-${s.slice(4,6)}`,d=new Date(iso+'T00:00:00Z');
 if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==iso)fail('date',line);
 return iso;
}
const clean=s=>s.replace(/\s+/g,' ').trim();
const reference=s=>{const t=clean(s);return t&&!/^0+$/.test(t)?t:null;};

export function parseNorma43(content){
 let text=Buffer.from(content).toString('latin1').replace(/\x1a+$/,'');
 if(text.charCodeAt(0)===0xef&&text.charCodeAt(1)===0xbb&&text.charCodeAt(2)===0xbf)text=text.slice(3);
 const lines=text.split(/\r\n|\n|\r/);
 while(lines.length&&!lines.at(-1).trim())lines.pop();
 if(!lines.length)fail('empty');
 const accounts=[];let current=null,movement=null,records=0,ended=false;
 lines.forEach((raw,i)=>{
  const n=i+1;
  if(ended)fail('records_after_end',n);
  if(raw.length>80||/[^\x20-\x7e\xa0-\xff]/.test(raw))fail('line_format',n);
  const l=raw.padEnd(80),type=l.slice(0,2);
  if(type==='88'){
   if(current)fail('account_not_closed',n);
   if(l.slice(2,20)!=='9'.repeat(18)||Number(digits(l.slice(20,26),'record_count',n))!==records)fail('record_count',n);
   ended=true;return;
  }
  records++;
  if(type==='11'){
   if(current)fail('account_not_closed',n);
   const currency=l.slice(47,50);
   current={bank:digits(l.slice(2,6),'account',n),branch:digits(l.slice(6,10),'account',n),account:digits(l.slice(10,20),'account',n),
    from:date(l.slice(20,26),n),to:date(l.slice(26,32),n),opening:signed(l[32],cents(l.slice(33,47),n),n),
    currency:currency==='978'?'EUR':fail('currency',n),holder:clean(l.slice(51,77)),movements:[]};
   if(current.from>current.to)fail('period',n);
   movement=null;return;
  }
  if(!current)fail('record_outside_account',n);
  if(type==='22'){
   const amount=signed(l[27],cents(l.slice(28,42),n),n);
   movement={line:n,office:l.slice(6,10).trim(),operationDate:date(l.slice(10,16),n),valueDate:date(l.slice(16,22),n),
    common:digits(l.slice(22,24),'concept',n),own:digits(l.slice(24,27),'concept',n),cents:amount,amount:decimal(amount),
    document:reference(l.slice(42,52)),reference1:reference(l.slice(52,64)),reference2:reference(l.slice(64,80)),concepts:[]};
   if(amount===0n)fail('zero_amount',n);
   current.movements.push(movement);return;
  }
  if(type==='23'){
   if(!movement)fail('concept_without_movement',n);
   for(const part of [l.slice(4,42),l.slice(42,80)]){const t=clean(part);if(t&&!movement.concepts.includes(t))movement.concepts.push(t);}
   return;
  }
  if(type==='24'){if(!movement)fail('concept_without_movement',n);return;}
  if(type==='33'){
   if(l.slice(2,20)!==current.bank+current.branch+current.account)fail('trailer_account',n);
   const debits=current.movements.filter(m=>m.cents<0n),credits=current.movements.filter(m=>m.cents>0n);
   const sum=list=>list.reduce((a,m)=>a+m.cents,0n);
   if(Number(digits(l.slice(20,25),'totals',n))!==debits.length||cents(l.slice(25,39),n)!==-sum(debits)
    ||Number(digits(l.slice(39,44),'totals',n))!==credits.length||cents(l.slice(44,58),n)!==sum(credits))fail('totals',n);
   const closing=signed(l[58],cents(l.slice(59,73),n),n);
   if(l.slice(73,76)!=='978')fail('currency',n);
   if(current.opening+sum(current.movements)!==closing)fail('balance',n);
   accounts.push({...current,opening:decimal(current.opening),closing:decimal(closing),
    movements:current.movements.map(({cents:_,...m})=>({...m,description:m.concepts.join(' ')}))});
   current=null;movement=null;return;
  }
  fail('record_type',n);
 });
 if(!ended)fail('missing_end');
 if(!accounts.length)fail('no_accounts');
 return {accounts,records};
}
