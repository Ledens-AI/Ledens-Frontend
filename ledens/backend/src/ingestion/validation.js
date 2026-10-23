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
  if (/\.pdf$/i.test(body.filename) && content.subarray(0,5).toString() === '%PDF-') {
    type = 'application/pdf';
    try {
      const pdf = await PDFDocument.load(content, { updateMetadata: false });
      if (pdf.getPageCount() > 2) reason = 'f0_page_limit';
    } catch { reason = 'unreadable_or_encrypted_pdf'; }
  } else if (/\.png$/i.test(body.filename) && content.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
    type = 'image/png';
  } else if (/\.jpe?g$/i.test(body.filename) && content[0] === 255 && content[1] === 216 && content[2] === 255) {
    type = 'image/jpeg';
  } else throw new IngestError(415, 'supported_formats_pdf_png_jpeg');
  return { ...body, content, type, reason,
    hash: createHash('sha256').update(content).digest('hex'),
    sourceKey: `${config.site}|Shared Documents|${body.item_id}` };
}
