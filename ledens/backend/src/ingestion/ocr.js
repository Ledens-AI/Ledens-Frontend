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
// Spanish tax ids printed in normalized text (one optional space between parts:
// «B 19753805», «12345678 Z», «X 1234567 L»).
const SPANISH_TAX_ID = /\b(?:([A-HJNPQRSUVW]) ?(\d{7}) ?([0-9A-J])|(\d{8}) ?([A-Z])|([XYZ]) ?(\d{7}) ?([A-Z]))\b/g;
const BUYER_LABEL = /\b(?:CLIENTE|DATOS DEL CLIENTE|FACTURAR A|FACTURADO A|BILL TO|BILLED TO|CUSTOMER|DESTINATARIO)\b/g;
// When the OCR placed no tax id on either side: our tax id printed shortly
// (≤160 characters) after a buyer label («CLIENTE», «Facturar a», «Bill to»…)
// means we are the buyer. One other Spanish tax id in the text is the
// supplier's. Our own issued invoices print our id as issuer, before the label.
export function buyerFromText(pdfText, own) {
  const text = normalize(pdfText);
  const ids = [...text.matchAll(SPANISH_TAX_ID)].map((m) => ({ at: m.index, id: m.slice(1).filter(Boolean).join('') }));
  const ours = ids.filter((x) => x.id === own);
  const labels = [...text.matchAll(BUYER_LABEL)].map((m) => m.index + m[0].length);
  if (!ours.some((o) => labels.some((l) => l <= o.at && o.at - l <= 160))) return null;
  const others = [...new Set(ids.filter((x) => x.id !== own).map((x) => x.id))];
  return others.length ? { supplierTaxId: others.length === 1 ? others[0] : null } : null;
}
// Control character of a Spanish tax id (DNI «12345678Z», NIE «X1234567L», CIF
// «B19753805»), so a stray code printed on a ticket is not taken for one.
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
export function validSpanishTaxId(id) {
  let m = /^(\d{8})([A-Z])$/.exec(id);
  if (m) return DNI_LETTERS[Number(m[1]) % 23] === m[2];
  m = /^([XYZ])(\d{7})([A-Z])$/.exec(id);
  if (m) return DNI_LETTERS[Number('XYZ'.indexOf(m[1]) + m[2]) % 23] === m[3];
  m = /^[A-HJNPQRSUVW](\d{7})([0-9A-J])$/.exec(id);
  if (!m) return false;
  const sum = [...m[1]].reduce((s, d, i) => s + (i % 2 ? Number(d) : [...String(d * 2)].reduce((a, b) => a + Number(b), 0)), 0);
  const c = (10 - (sum % 10)) % 10;
  return m[2] === String(c) || m[2] === 'JABCDEFGHI'[c];
}
// Tickets (factura simplificada) and photos: no customer, and the OCR placed no tax
// id although the seller's is printed («Nif: 44582380P»). Exactly one valid Spanish
// tax id in the OCR's own text, not ours, is the seller's; its confidence is the
// lowest of the OCR words that read it. Ours anywhere in the text: null (ambiguous).
export function sellerFromContent(result, own) {
  const content = String(result.analyzeResult?.content || '').toUpperCase();
  const ids = [...content.matchAll(SPANISH_TAX_ID)]
    .map((m) => ({ at: m.index, length: m[0].length, id: m.slice(1).filter(Boolean).join('') }))
    .filter((x) => validSpanishTaxId(x.id));
  if (compact(content).includes(own)) return null;
  const others = [...new Set(ids.map((x) => x.id))];
  if (others.length !== 1) return null;
  const words = (result.analyzeResult.pages || []).flatMap((p) => p.words || [])
    .filter((w) => w.span && ids.some((x) => w.span.offset < x.at + x.length && w.span.offset + w.span.length > x.at));
  return words.length ? { taxId: others[0], confidence: Math.min(...words.map((w) => w.confidence)) } : null;
}
// Nóminas (recibo individual de salarios): the OCR's InvoiceDate is whatever date it
// picks (antigüedad, alta…). A payslip belongs to the last day of its «periodo de
// liquidación», printed shortly (≤250 characters) after that label as a day range
// («1/31-10-2026»), two dates («01/10/2026 a 31/10/2026») or in words («del 1 al 31
// de octubre de 2026»). It is a payslip only when it also shows what a payslip must
// (devengos or líquido a percibir). Returns 'YYYY-MM-DD' or null.
const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
export function payslipPeriodEnd(text) {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const label = /PERIODO\s+(?:DE\s+)?LIQUIDACION/.exec(t);
  if (!label || !/LIQUIDO\s+A\s+PERCIBIR|DEVENGOS/.test(t)) return null;
  const tail = t.slice(label.index + label[0].length, label.index + label[0].length + 250);
  const iso = (d, m, y) => { const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    const v = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return invoiceQuarter(v) ? v : null; };
  const found = [
    ...[...tail.matchAll(/\b\d{1,2}\s*[/-]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\b/g)].map((m) => iso(m[1], m[2], m[3])),
    ...[...tail.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)].map((m) => iso(m[1], m[2], m[3])),
    ...[...tail.matchAll(/\b(\d{1,2})\s+(?:DE\s+)?([A-Z]{3})[A-Z]*\.?\s+(?:DE\s+)?(\d{4})\b/g)]
      .map((m) => MONTHS.includes(m[2]) ? iso(m[1], MONTHS.indexOf(m[2]) + 1, m[3]) : null),
  ].filter(Boolean);
  return found.length ? found.sort().at(-1) : null;
}
// The «líquido a percibir» of a payslip, in cents: an amount printed after that label
// (≤250 characters; the OCR reads the boxes in any order) that is exactly a pair of
// totals printed after «TOTALES»/«TOTAL DEVENGADO»/«TOTAL A DEDUCIR» (devengos −
// deducciones). Without that arithmetic proof it is null and the payslip goes to review.
export function payslipNet(text) {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const amountsAfter = (re, n) => [...t.matchAll(re)].flatMap((m) =>
    [...t.slice(m.index + m[0].length, m.index + m[0].length + n).matchAll(AMOUNT)].map((a) => toCents(a[1])));
  const net = amountsAfter(/LIQUIDO\s+(?:TOTAL\s+)?A\s+PERCIBIR/g, 250);
  const totals = amountsAfter(/\bTOTALES\b|TOTAL\s+DEVENGADO|TOTAL\s+(?:A\s+)?DEDUCIR|TOTAL\s+DEDUCCIONES/g, 40);
  const proven = [...new Set(net)].filter((x) => x > 0 && totals.some((a) => totals.some((b) => a - b === x && b > 0)));
  return proven.length === 1 ? proven[0] : null;
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
  const periodEnd = payslipPeriodEnd(`${result.analyzeResult?.content || ''}\n${pdfText}`);
  const date = periodEnd || f.InvoiceDate?.valueDate;
  const confidence = periodEnd ? TEXT_CONFIDENCE : f.InvoiceDate?.confidence || 0;
  const quarter = invoiceQuarter(date);
  if (!quarter || confidence < INVOICE_MIN_CONFIDENCE || confidence > 1) return {reason:'invoice_date_requires_review'};
  const text = name => typeof f[name]?.valueString === 'string' ? f[name].valueString.slice(0,1000) : null;
  const money = name => Number.isFinite(f[name]?.valueCurrency?.amount) ? f[name].valueCurrency.amount : null;
  const own=taxId(businessTaxId);
  // A payslip of ours (our tax id printed on it as the employer's) is a cost to pay:
  // its líquido a percibir, in euros, to the worker (whom the OCR reads as customer).
  // Without a proven líquido it goes on as any document and stays in review.
  if(periodEnd){
    const content=result.analyzeResult?.content||'';
    const net=payslipNet(content)??payslipNet(pdfText);
    if(net&&compact(`${content}\n${pdfText}`).includes(own))return {date,confidence,quarter,number:text('InvoiceId'),
      vendor:text('CustomerName'),taxId:text('CustomerTaxId'),subtotal:null,tax:null,total:-net/100,direction:'Pagar',currency:'EUR',
      totalConfidence:TEXT_CONFIDENCE,numberConfidence:f.InvoiceId?.confidence||0,partyConfidence:f.CustomerName?.confidence||0,
      taxIdConfidence:f.CustomerTaxId?.confidence||0,directionConfidence:TEXT_CONFIDENCE,
      corroborated:{date:'payslip_period_end',total:'payslip_net',direction:'payslip_employer_tax_id'}};
  }
  const sellerOwn=taxId(text('VendorTaxId'))===own;
  const buyerOwn=taxId(text('CustomerTaxId'))===own;
  // Our tax id as seller → Cobrar; as buyer → Pagar. A supplier invoice where the
  // OCR does not find ours (utilities, telecoms…) is still Pagar when the seller
  // has a valid tax id that is not ours; its confidence is the direction's.
  // Ours on both sides stays ambiguous.
  const vendorTax=taxId(text('VendorTaxId'));
  const supplier=!sellerOwn&&!buyerOwn&&vendorTax.length>=8&&vendorTax!==own;
  let direction=supplier?'Pagar':sellerOwn===buyerOwn?null:sellerOwn?'Cobrar':'Pagar';
  // The OCR placed no tax id at all (neither side): the PDF text may still show
  // ours as the customer's, after a buyer label (buyerFromText).
  const textBuyer=!direction&&!sellerOwn&&!buyerOwn&&pdfText?buyerFromText(pdfText,own):null;
  if(textBuyer)direction='Pagar';
  // Nor in the PDF text: a document with no customer may print the seller's id where the OCR read it (sellerFromContent).
  const textSeller=!direction&&!sellerOwn&&!buyerOwn&&!f.CustomerName&&!f.CustomerTaxId?sellerFromContent(result,own):null;
  if(textSeller)direction='Pagar';
  const directionField=sellerOwn||supplier?'VendorTaxId':'CustomerTaxId';
  const party=direction==='Cobrar'?'Customer':'Vendor';
  const multiplier=direction==='Pagar'?-1:1;
  const signed=name=>money(name)==null?null:multiplier*money(name);
  // Total: the OCR's, confirmed by the text; or the text's when the OCR has none.
  const textTotal=pdfText?textTotals(pdfText):[];
  let total=money('InvoiceTotal'),totalConfidence=f.InvoiceTotal?.confidence||0,currency=f.InvoiceTotal?.valueCurrency?.currencyCode||null;
  const corroborated=periodEnd?{date:'payslip_period_end'}:{};
  if(total!==null&&textTotal.includes(Math.round(Math.abs(total)*100))){if(totalConfidence<TEXT_CONFIDENCE){totalConfidence=TEXT_CONFIDENCE;corroborated.total='ocr_total_in_text';}}
  else if(total===null&&textTotal.length===1){total=textTotal[0]/100;totalConfidence=TEXT_CONFIDENCE;corroborated.total='text_total';
    if(!currency&&/€|\bEUR\b/i.test(pdfText))currency='EUR';}
  // A supplier's credit note (factura rectificativa, abono: a negative total on a
  // document we pay) is money back: Cobrar, positive, from the same supplier.
  const refund=direction==='Pagar'&&total<0;
  const positive=total>0||refund;
  // Direction: the confidence of the tax id that set it, confirmed when that id is printed in the text.
  let directionConfidence=direction&&positive?(f[directionField]?.confidence||0):0;
  const directionId=taxId(text(directionField));
  if(textBuyer){directionConfidence=positive?TEXT_CONFIDENCE:0;corroborated.direction='customer_label_in_text';}
  else if(textSeller){directionConfidence=positive?textSeller.confidence:0;corroborated.direction='seller_tax_id_in_ocr_text';}
  else if(direction&&positive&&directionConfidence<INVOICE_MIN_CONFIDENCE&&directionId.length>=8&&pdfText&&compact(pdfText).includes(directionId)){
    directionConfidence=TEXT_CONFIDENCE;corroborated.direction=directionField;}
  return { date, confidence, quarter, number:text('InvoiceId'), vendor:text(party+'Name'),
    taxId:text(party+'TaxId')||textBuyer?.supplierTaxId||textSeller?.taxId||null, subtotal:signed('SubTotal'), tax:signed('TotalTax'), total:total===null?null:multiplier*total,
    direction:refund?'Cobrar':direction,currency,totalConfidence,numberConfidence:f.InvoiceId?.confidence||0,
    partyConfidence:f[party+'Name']?.confidence||0,taxIdConfidence:f[party+'TaxId']?.confidence||0,partyEvidence:partyNameEvidence(result,party),
    directionConfidence,...(Object.keys(corroborated).length?{corroborated}:{}) };
}
