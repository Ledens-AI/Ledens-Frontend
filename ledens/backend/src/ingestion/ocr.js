import { invoiceQuarter } from './validation.js';

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
export function extractInvoice(result) {
  const docs = result.analyzeResult?.documents;
  if (!Array.isArray(docs) || docs.length !== 1) return { reason:'invoice_count_requires_review' };
  const f = docs[0].fields || {};
  const date = f.InvoiceDate?.valueDate;
  const confidence = f.InvoiceDate?.confidence || 0;
  const quarter = invoiceQuarter(date);
  if (!quarter || confidence < 0.9) return {reason:'invoice_date_requires_review'};
  const text = name => typeof f[name]?.valueString === 'string' ? f[name].valueString.slice(0,1000) : null;
  const money = name => Number.isFinite(f[name]?.valueCurrency?.amount) ? f[name].valueCurrency.amount : null;
  return { date, confidence, quarter, number:text('InvoiceId'), vendor:text('VendorName'),
    taxId:text('VendorTaxId'), subtotal:money('SubTotal'), tax:money('TotalTax'), total:money('InvoiceTotal') };
}
