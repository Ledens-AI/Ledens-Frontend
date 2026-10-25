import {municipalAssessment} from './municipal.js';
import {PDFDocument} from 'pdf-lib';
import { invoiceQuarter } from './validation.js';
import {taxId,normalize,INVOICE_MIN_CONFIDENCE} from '../bridge/rules.js';

export function trustedOperation(url, endpoint) {
  const value = new URL(url);
  const base = new URL(endpoint);
  if (value.protocol !== 'https:' || value.origin !== base.origin ||
      !value.pathname.startsWith('/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/')) {
    throw new Error('invalid_operation_location');
  }
  return value.href;
}
export async function prepareOcrInput(content,type){
 if(type!=='application/pdf')return {content,scope:null};
 const pdf=await PDFDocument.load(content,{updateMetadata:false}),count=pdf.getPageCount();
 if(count<=2)return {content,scope:null};
 const first=await PDFDocument.create(),[page]=await first.copyPages(pdf,[0]);first.addPage(page);
 return {content:Buffer.from(await first.save()),scope:{source:'azure-di',original_pages:count,pages:[1],first_page_only:true}};
}
export class InvoiceOcr {
  constructor(endpoint, key, fetcher = fetch) {
    this.endpoint = endpoint?.replace(/\/$/,''); this.key = key; this.fetch = fetcher;
  }
  async request(url, options = {}) {
    const r = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Ocp-Apim-Subscription-Key': this.key, ...options.headers } });
    if (!r.ok) { const e = new Error('ocr_request_failed'); e.transient = r.status === 429 || r.status >= 500; throw e; }
    return r;
  }
  async start(content, type,{prepared=false}={}) {
    if(!prepared)content=(await prepareOcrInput(content,type)).content;
    const r = await this.request(`${this.endpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30&locale=es-ES`, {
      method:'POST', headers:{'Content-Type':type}, body:content });
    return trustedOperation(r.headers.get('operation-location'), this.endpoint);
  }
  async poll(url) {
    return (await this.request(trustedOperation(url, this.endpoint))).json();
  }
}
export function partyNameEvidence(result,party){
 const f=result.analyzeResult?.documents?.[0]?.fields||{},field=f[party+'Name'],name=field?.valueString,nif=f[party+'TaxId'];
 const valid=n=>typeof n==='number'&&n>=INVOICE_MIN_CONFIDENCE&&n<=1;
 if(!name||!valid(nif?.confidence)||taxId(nif.valueString).length<8)return null;
 const opposite=f[party==='Vendor'?'CustomerName':'VendorName']?.valueString;
 if(opposite&&normalize(opposite)===normalize(name))return null;
 const spans=field.spans||[];
 const words=(result.analyzeResult.pages||[]).flatMap(p=>p.words||[]).filter(w=>w.span&&spans.some(s=>w.span.offset>=s.offset&&w.span.offset+w.span.length<=s.offset+s.length));
 if(!words.length||words.some(w=>!valid(w.confidence))||normalize(words.map(w=>w.content).join(' '))!==normalize(name))return null;
 return {rule:'party_name_span_and_tax_id',name:normalize(name),tax_id:taxId(nif.valueString),name_field_confidence:field.confidence,word_confidence:Math.min(...words.map(w=>w.confidence)),tax_id_confidence:nif.confidence,source:'azure-di'};
}
export function extractInvoice(result, {businessTaxId=process.env.BRIDGE_BUSINESS_TAX_ID||'B19753805'}={}) {
  if(municipalAssessment(result))return {reason:'municipal_assessment_requires_review'};
  const docs = result.analyzeResult?.documents;
  if (!Array.isArray(docs) || docs.length !== 1) return { reason:'invoice_count_requires_review' };
  const f = docs[0].fields || {};
  if(f.InvoiceTotal?.valueCurrency?.amount===0&&/YA PAGADO DEL PEDIDO/i.test(result.analyzeResult?.content||''))return {reason:'purchase_zero_requires_native_or_review'};
  const date = f.InvoiceDate?.valueDate;
  const confidence = f.InvoiceDate?.confidence || 0;
  const quarter = invoiceQuarter(date);
  if (!quarter || confidence < INVOICE_MIN_CONFIDENCE || confidence > 1) return {reason:'invoice_date_requires_review'};
  const text = name => typeof f[name]?.valueString === 'string' ? f[name].valueString.slice(0,1000) : null;
  const money = name => Number.isFinite(f[name]?.valueCurrency?.amount) ? f[name].valueCurrency.amount : null;
  const own=taxId(businessTaxId);
  const sellerOwn=taxId(text('VendorTaxId'))===own;
  const buyerOwn=taxId(text('CustomerTaxId'))===own;
  const direction=sellerOwn===buyerOwn?null:sellerOwn?'Cobrar':'Pagar';
  const party=direction==='Cobrar'?'Customer':'Vendor';
  const multiplier=direction==='Pagar'?-1:1;
  const signed=name=>money(name)==null?null:multiplier*money(name);
  return { date, confidence, quarter, number:text('InvoiceId'), vendor:text(party+'Name'),
    taxId:text(party+'TaxId'), subtotal:signed('SubTotal'), tax:signed('TotalTax'), total:signed('InvoiceTotal'),
    direction,currency:f.InvoiceTotal?.valueCurrency?.currencyCode||null,
    totalConfidence:f.InvoiceTotal?.confidence||0,numberConfidence:f.InvoiceId?.confidence||0,
    partyConfidence:f[party+'Name']?.confidence||0,taxIdConfidence:f[party+'TaxId']?.confidence||0,partyEvidence:partyNameEvidence(result,party),
    directionConfidence:direction&&money('InvoiceTotal')>0?(f[sellerOwn?'VendorTaxId':'CustomerTaxId']?.confidence||0):0 };
}
