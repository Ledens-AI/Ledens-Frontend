import {municipalAssessment} from './municipal.js';
import { invoiceQuarter, TOTAL_TEXT } from './validation.js';
import {taxId,normalize,INVOICE_MIN_CONFIDENCE} from '../bridge/rules.js';

// Confidence given to a value the PDF's own text layer confirms.
export const TEXT_CONFIDENCE = 0.9;
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2})(?![\d])/g;
const toCents = (s) => { const [w, d] = (s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s).split('.'); return Number(w) * 100 + Number(d); };
// Invoice totals printed in the text: after each total label, the amounts that
// follow (up to 6, within 90 characters). One repeated amount is the total; with
// several, the one that is the sum of two others (base + VAT). Returns cents.
export function textTotals(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(new RegExp(TOTAL_TEXT.source, 'gi'))) {
    // Up to the next total label: its amounts belong to that label.
    let tail = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const next = tail.search(new RegExp(TOTAL_TEXT.source, 'i'));
    if (next >= 0) tail = tail.slice(0, next);
    const amounts = [...tail.matchAll(AMOUNT)].slice(0, 6).map((a) => toCents(a[1]));
    const distinct = [...new Set(amounts)];
    if (distinct.length === 1) out.add(distinct[0]);
    else {
      const sums = distinct.filter((t) => amounts.some((a, i) => amounts.some((b, j) => i !== j && a + b === t && a !== t && b !== t)));
      if (sums.length === 1) out.add(sums[0]);
    }
  }
  return [...out];
}
// The text without separators, to look a tax id up in it («B-84406289» → B84406289).
const compact = (text) => normalize(text).replace(/\s/g, '');

export function trustedOperation(url, endpoint) {
  const value = new URL(url);
  const base = new URL(endpoint);
  if (value.protocol !== 'https:' || value.origin !== base.origin ||
      !value.pathname.startsWith('/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/')) {
    throw new Error('invalid_operation_location');
  }
  return value.href;
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
  async start(content, type) {
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
// pdfText: text layer of the pages sent to the OCR (empty for scans and images).
// It never decides on its own: it confirms the OCR's total and the tax id that
// set the direction, or supplies the total when the OCR found none and the text
// shows exactly one.
export function extractInvoice(result, {businessTaxId=process.env.BRIDGE_BUSINESS_TAX_ID||'B19753805',pdfText=''}={}) {
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
  // Our tax id as seller → Cobrar; as buyer → Pagar. A supplier invoice where the
  // OCR does not find ours (utilities, telecoms…) is still Pagar when the seller
  // has a valid tax id that is not ours; its confidence is the direction's.
  // Ours on both sides stays ambiguous.
  const vendorTax=taxId(text('VendorTaxId'));
  const supplier=!sellerOwn&&!buyerOwn&&vendorTax.length>=8&&vendorTax!==own;
  const direction=supplier?'Pagar':sellerOwn===buyerOwn?null:sellerOwn?'Cobrar':'Pagar';
  const directionField=sellerOwn||supplier?'VendorTaxId':'CustomerTaxId';
  const party=direction==='Cobrar'?'Customer':'Vendor';
  const multiplier=direction==='Pagar'?-1:1;
  const signed=name=>money(name)==null?null:multiplier*money(name);
  // Total: the OCR's, confirmed by the text; or the text's when the OCR has none.
  const textTotal=pdfText?textTotals(pdfText):[];
  let total=money('InvoiceTotal'),totalConfidence=f.InvoiceTotal?.confidence||0,currency=f.InvoiceTotal?.valueCurrency?.currencyCode||null;
  const corroborated={};
  if(total!==null&&textTotal.includes(Math.round(Math.abs(total)*100))){if(totalConfidence<TEXT_CONFIDENCE){totalConfidence=TEXT_CONFIDENCE;corroborated.total='ocr_total_in_text';}}
  else if(total===null&&textTotal.length===1){total=textTotal[0]/100;totalConfidence=TEXT_CONFIDENCE;corroborated.total='text_total';
    if(!currency&&/€|\bEUR\b/i.test(pdfText))currency='EUR';}
  // Direction: the confidence of the tax id that set it, confirmed when that id is printed in the text.
  let directionConfidence=direction&&total>0?(f[directionField]?.confidence||0):0;
  const directionId=taxId(text(directionField));
  if(direction&&total>0&&directionConfidence<INVOICE_MIN_CONFIDENCE&&directionId.length>=8&&pdfText&&compact(pdfText).includes(directionId)){
    directionConfidence=TEXT_CONFIDENCE;corroborated.direction=directionField;}
  return { date, confidence, quarter, number:text('InvoiceId'), vendor:text(party+'Name'),
    taxId:text(party+'TaxId'), subtotal:signed('SubTotal'), tax:signed('TotalTax'), total:total===null?null:multiplier*total,
    direction,currency,totalConfidence,numberConfidence:f.InvoiceId?.confidence||0,
    partyConfidence:f[party+'Name']?.confidence||0,taxIdConfidence:f[party+'TaxId']?.confidence||0,partyEvidence:partyNameEvidence(result,party),
    directionConfidence,...(Object.keys(corroborated).length?{corroborated}:{}) };
}
