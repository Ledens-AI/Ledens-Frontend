import {cents,day,nativePurchaseVerified,nativeStatementVerified,INVOICE_MIN_CONFIDENCE} from '../bridge/rules.js';
export function archiveIssue(d){
 if(day(d.document_on)===null)return 'invoice_date_requires_review';
 if(nativePurchaseVerified(d)&&d.purchase_proof.kind==='delivery')return null;
 const total=cents(d.total);if(total===null||total===0n)return 'invoice_total_requires_review';
 if(!/^[A-Z]{3}$/.test(d.invoice_currency||''))return 'invoice_currency_requires_review';
 if(!['Pagar','Cobrar'].includes(d.tipo)||(d.tipo==='Pagar')!==(total<0n))return 'invoice_direction_requires_review';
 if(nativePurchaseVerified(d)||nativeStatementVerified(d))return null;
 if(['date_confidence','total_confidence','direction_confidence'].some(k=>d[k]===null||d[k]===undefined||Number(d[k])<INVOICE_MIN_CONFIDENCE||Number(d[k])>1||!Number.isFinite(Number(d[k]))))return 'invoice_fields_require_review';
 return null;
}
