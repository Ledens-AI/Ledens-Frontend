import {cents,decimal,INVOICE_MIN_CONFIDENCE} from '../bridge/rules.js';
import {invoiceQuarter} from './validation.js';
const spanishMoney=s=>typeof s==='string'?cents(s.replace(/\./g,'').replace(',','.')):null;
// Municipal assessment bases and rates are calculation evidence, not invoice lines.
// This profile is used for explicit operator recovery; it does not assert company ownership.
export function municipalAssessment(result){
 const a=result.analyzeResult,docs=a?.documents;
 if(docs?.length!==1)return null;
 const f=docs[0].fields||{},content=a.content||'';
 if(!/AYUNTAMIENTO DE MIJAS/i.test(content)||!/DEPOSITO PREVIO ICIO/i.test(content)||!/PRESUPUESTO EJECUCI[ÓO]N DE OBRAS/i.test(content))return null;
 const date=f.InvoiceDate?.valueDate,confidence=f.InvoiceDate?.confidence;
 if(!invoiceQuarter(date)||!(confidence>=INVOICE_MIN_CONFIDENCE&&confidence<=1)||!(f.InvoiceTotal?.confidence>=INVOICE_MIN_CONFIDENCE))return null;
 const amounts=[...content.matchAll(/CUOTA A PAGAR\s+([\d.]+,\d{2})/gi)].map(m=>spanishMoney(m[1]));
 const base=spanishMoney(content.match(/BASE IMPONIBLE \(PRESUPUESTO EJECUCI[ÓO]N DE OBRAS\)[^\d]*([\d.]+,\d{2})/i)?.[1]);
 const rate=spanishMoney(content.match(/TIPO IMPOSITIVO\s+([\d.]+,\d{2})/i)?.[1]);
 const total=cents(f.InvoiceTotal?.valueCurrency?.amount),currency=f.InvoiceTotal?.valueCurrency?.currencyCode;
 const refs=[...new Set(content.match(/\b20\d{2}-\d{5}-DR\b/g)||[])];
 if(currency!=='EUR'||total===null||total<=0n||!amounts.length||amounts.some(n=>n!==total)||base===null||rate===null||((base*rate+5000n)/10000n)!==total||refs.length!==1)return null;
 const liquidation=content.match(/Fecha expedici[óo]n\s+(\d{6,})/i)?.[1];
 if(!liquidation)return null;
 const months=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
 const [year,month,day]=date.split('-').map(Number);
 const repeatedDate=new RegExp('\\b'+day+' de '+months[month-1]+' de '+year+'\\b','i');
 if(!repeatedDate.test(content))return null;
 return {date,quarter:invoiceQuarter(date),confidence,total:decimal(total),totalConfidence:f.InvoiceTotal.confidence,
  currency,reference:refs[0],liquidation,vendor:'Ayuntamiento de Mijas',description:'Depósito previo ICIO — liquidación '+liquidation+' — '+refs[0],
  evidence:{kind:'municipal_assessment',base_for_tax_calculation:decimal(base),rate_percent:decimal(rate),amount_basis:'municipal_quota_not_construction_budget',date_corroborated:true,requires_operator_review:true}};
}
