import {createHash} from 'node:crypto';

export const RULE_VERSION='exact-reference-party-v1';
export const LOCK_ID=727032;
export const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
export const taxId=s=>normalize(s).replace(/\s/g,'').replace(/^ES(?=[A-Z0-9]{9}$)/,'');
export function cents(value){
  const s=String(value??'');
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))return null;
  const [whole,part='']=s.replace(/^-/,'').split('.');
  const n=BigInt(whole)*100n+BigInt(part.padEnd(2,'0'));
  return s.startsWith('-')?-n:n;
}
export const abs=n=>n<0n?-n:n;
export function decimal(n){const a=abs(n);return `${n<0n?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`;}
export function day(value){
  const s=value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s?+d/86400000:null;
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const documentFingerprint=d=>digest([d.id,String(d.total),d.tipo,day(d.document_on),d.numerodocumento,d.tercero,d.niftercero,d.invoice_currency]);
export const bankFingerprint=b=>digest([b.id,String(b.amount),String(b.total_amount),b.state,b.type,b.currency,day(b.completed_on),b.reference,b.description,b.beneficiary_name,b.is_internal_transfer,String(b.bank_fee),b.bill_currency,String(b.bill_amount)]);
export function hasReference(number,bank){
  const ref=normalize(number), compact=ref.replace(/\s/g,'');
  if(compact.length<6 || !/\d/.test(compact) || /^(19|20)\d{2}$/.test(compact))return false;
  const text=' '+normalize([bank.reference,bank.description].join(' '))+' ';
  return text.includes(' '+ref+' ');
}
export function hasParty(doc,bank,{verified=false}={}){
  const text=' '+normalize([bank.reference,bank.description,bank.beneficiary_name,bank.payer].join(' '))+' ';
  const nif=taxId(doc.niftercero);
  if((!verified||Number(doc.tax_id_confidence)>=0.9)&&nif.length>=8 && (text.includes(' '+nif+' ') || text.includes(' ES'+nif+' ')))return true;
  const excluded=new Set(['SOCIEDAD','LIMITADA','ANONIMA','SL','SA','SLU','DE','DEL','LA','EL']);
  const words=normalize(doc.tercero).split(' ').filter(x=>x.length>=3&&!excluded.has(x));
  return (!verified||Number(doc.party_confidence)>=0.9)&&words.join('').length>=7 && words.length>0 && words.every(x=>text.includes(' '+x+' '));
}
export function automaticBlock(doc){
  const total=cents(doc.total);
  if(total===null||total===0n||day(doc.document_on)===null)return 'incomplete_document';
  if(!['Pagar','Cobrar'].includes(doc.tipo)||(doc.tipo==='Pagar')!==(total<0n))return 'unknown_direction';
  if(doc.review_state==='Incidencia')return 'invoice_issue';
  if(doc.invoice_currency!=='EUR')return 'unverified_currency';
  for(const [key,threshold] of [['total_confidence',0.95],['date_confidence',0.9],['number_confidence',0.9],['direction_confidence',0.9]]){
    const value=Number(doc[key]);if(!Number.isFinite(value)||value<threshold||value>1)return 'unverified_invoice_fields';
  }
  return null;
}
export function eligibleBank(doc,bank){
  const dt=cents(doc.total),amount=cents(bank.amount),total=cents(bank.total_amount);
  if(dt===null||dt===0n||amount===null||total===null||dt!==amount||dt!==total)return false;
  if(bank.state!=='COMPLETED'||bank.currency!=='EUR'||bank.is_internal_transfer===true)return false;
  if(!['TRANSFER','CARD_PAYMENT','CHARGE'].includes(bank.type))return false;
  if(bank.type==='TRANSFER'&&bank.is_internal_transfer!==false)return false;
  if(bank.bank_fee!=null&&cents(bank.bank_fee)!==0n)return false;
  if(bank.bill_currency&&bank.bill_currency!==bank.currency)return false;
  if(bank.bill_amount!=null&&abs(cents(bank.bill_amount)??0n)!==abs(amount))return false;
  const a=day(doc.document_on),b=day(bank.completed_on);
  return a!==null&&b!==null&&b>=a-7&&b<=a+90&&hasReference(doc.numerodocumento,bank)&&hasParty(doc,bank,{verified:true});
}
