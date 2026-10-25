import {readObramatPdf} from './obramat.js';
import {readRevolutPdf} from './revolut.js';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export class IngestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function invoiceQuarter(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return null;
  const year = date.getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return null;
  return `${Math.floor(date.getUTCMonth()/3)+1}T-${year}`;
}
// A new PDF with the given pages (0-based) of `pdf` (a loaded PDFDocument).
export async function pickPages(pdf, indices) {
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(pdf, indices)) out.addPage(page);
  return Buffer.from(await out.save());
}
// Wording of an invoice total (not «Subtotal»): «Total factura», «Importe total», «Total a pagar», «TOTAL: 15,25 €»…
export const TOTAL_TEXT = /(?<![a-z])(importe\s+total|total\s+(?:factura|de\s+la\s+factura|a\s+pagar|general|con\s+iva|iva\s+incluido|eur)|total\s*(?:\(\s*eur\s*\)|€|:))/i;
// Text of the first `n` pages; a page without a text layer (a scan) is ''.
export async function pageTexts(content, n) {
  let pdf;
  try {
    pdf = await getDocument({ data: new Uint8Array(content), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
    const texts = [];
    for (let i = 1; i <= Math.min(n, pdf.numPages); i++) texts.push((await (await pdf.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
    return texts;
  } catch { return []; } finally { await pdf?.destroy(); }
}
// F0 analyses two pages at most. The first page carries number and date; the
// total may be on page 2 or 3, so page 3 replaces page 2 only when the total
// is there and not before. Without a readable total: pages 1 and 2. 0-based.
export async function ocrPages(content) {
  const texts = await pageTexts(content, 3);
  const at = texts.findIndex((t) => TOTAL_TEXT.test(t));
  return at === 2 ? [0, 2] : [0, 1];
}
export async function validateInvoice(body, config) {
  if (!body || body.site_url !== config.site || body.library !== 'Shared Documents' ||
      body.folder !== config.folder) throw new IngestError(400, 'invalid_source');
  for (const key of ['item_id','filename','content_base64']) {
    if (typeof body[key] !== 'string' || !body[key]) throw new IngestError(400, 'invalid_payload');
  }
  if (body.item_id.length > 1024 || body.filename.length > 255 || /[\\/\x00-\x1f]/.test(body.filename)) {
    throw new IngestError(400, 'invalid_filename_or_id');
  }
  const base64 = body.content_base64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new IngestError(400, 'invalid_base64');
  }
  const content = Buffer.from(base64, 'base64');
  if (!content.length || content.length > 4 * 1024 * 1024) throw new IngestError(413, 'file_exceeds_f0_limit');
  let type;
  let reason = null;
  let nativePurchase=null;
  let nativeStatement=null;
  // What the OCR receives when it is not the whole file (null: the file itself).
  let ocrContent=null, pageCount=null, ocrPageNumbers=null;
  if (/\.pdf$/i.test(body.filename) && content.subarray(0,5).toString() === '%PDF-') {
    type = 'application/pdf';
    try {
      const pdf = await PDFDocument.load(content, { updateMetadata: false });
      pageCount=pdf.getPageCount();
      const parsed=await readObramatPdf(content,{businessTaxId:config.businessTaxId||process.env.BRIDGE_BUSINESS_TAX_ID||'B19753805'});
      if(parsed?.data)nativePurchase=parsed.data;
      else if(parsed?.reason)reason=parsed.reason;
      else {const statement=await readRevolutPdf(content);if(statement?.data)nativeStatement=statement.data;else if(statement?.reason)reason=statement.reason;
        // F0 reads two pages at most: a longer PDF sends page 1 and the page of the
        // total among the first three (ocrPages). The original and its hash stay whole.
        else if(pageCount>2){ocrPageNumbers=(await ocrPages(content)).map((i)=>i+1);
          ocrContent=await pickPages(pdf,ocrPageNumbers.map((n)=>n-1)).catch(()=>{reason='f0_page_limit';ocrPageNumbers=null;return null;});}}
    } catch { reason = 'unreadable_or_encrypted_pdf'; }
  } else if (/\.png$/i.test(body.filename) && content.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
    type = 'image/png';
  } else if (/\.jpe?g$/i.test(body.filename) && content[0] === 255 && content[1] === 216 && content[2] === 255) {
    type = 'image/jpeg';
  } else throw new IngestError(415, 'supported_formats_pdf_png_jpeg');
  return { ...body, content, type, reason, nativePurchase,nativeStatement, ocrContent, pageCount, ocrPageNumbers,
    hash: createHash('sha256').update(content).digest('hex'),
    sourceKey: `${config.site}|Shared Documents|${body.item_id}` };
}
