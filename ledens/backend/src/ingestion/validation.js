import {readObramatPdf} from './obramat.js';
import {readRevolutPdf} from './revolut.js';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

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
// A new one-page PDF with the first page of `pdf` (a loaded PDFDocument).
export async function firstPage(pdf) {
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(pdf, [0]);
  out.addPage(page);
  return Buffer.from(await out.save());
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
  let ocrContent=null, pageCount=null;
  if (/\.pdf$/i.test(body.filename) && content.subarray(0,5).toString() === '%PDF-') {
    type = 'application/pdf';
    try {
      const pdf = await PDFDocument.load(content, { updateMetadata: false });
      pageCount=pdf.getPageCount();
      const parsed=await readObramatPdf(content,{businessTaxId:config.businessTaxId||process.env.BRIDGE_BUSINESS_TAX_ID||'B19753805'});
      if(parsed?.data)nativePurchase=parsed.data;
      else if(parsed?.reason)reason=parsed.reason;
      else {const statement=await readRevolutPdf(content);if(statement?.data)nativeStatement=statement.data;else if(statement?.reason)reason=statement.reason;
        // F0 reads two pages at most: a longer PDF sends only its first page, where
        // number, date, base, VAT and total are. The original and its hash stay whole.
        else if(pageCount>2)ocrContent=await firstPage(pdf).catch(()=>{reason='f0_page_limit';return null;});}
    } catch { reason = 'unreadable_or_encrypted_pdf'; }
  } else if (/\.png$/i.test(body.filename) && content.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
    type = 'image/png';
  } else if (/\.jpe?g$/i.test(body.filename) && content[0] === 255 && content[1] === 216 && content[2] === 255) {
    type = 'image/jpeg';
  } else throw new IngestError(415, 'supported_formats_pdf_png_jpeg');
  return { ...body, content, type, reason, nativePurchase,nativeStatement, ocrContent, pageCount,
    hash: createHash('sha256').update(content).digest('hex'),
    sourceKey: `${config.site}|Shared Documents|${body.item_id}` };
}
