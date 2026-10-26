import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

// What an uploaded obra file really is, from its bytes (the declared
// Content-Type and the extension are not trusted on their own), as
// src/ingestion/validation.js does for invoices. Photos: JPEG, PNG, HEIC/HEIF
// (iPhone); documents: PDF that pdf-lib can open.
export const MAX_PHOTO = 15 * 1024 * 1024;
export const MAX_PDF = 20 * 1024 * 1024;
export const MAX_THUMB = 400 * 1024;

export class FileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
// ISO-BMFF major brands of HEIC (HEVC-coded) and generic HEIF images.
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'];
const HEIF_BRANDS = ['mif1', 'msf1'];

export const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function sniff(content) {
  if (isJpeg(content)) return 'image/jpeg';
  if (content.subarray(0, 8).equals(PNG)) return 'image/png';
  if (content.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = content.subarray(8, 12).toString('latin1');
    if (HEIC_BRANDS.includes(brand)) return 'image/heic';
    if (HEIF_BRANDS.includes(brand)) return 'image/heif';
  }
  if (content.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const EXT = {
  'image/jpeg': /\.(jpe?g|jfif)$/i,
  'image/png': /\.png$/i,
  'image/heic': /\.(heic|heif)$/i,
  'image/heif': /\.(heic|heif)$/i,
  'application/pdf': /\.pdf$/i,
};

export async function validateUpload(content, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\\/\x00-\x1f]/.test(name)) throw new FileError(400, 'Nombre de archivo no válido');
  if (!Buffer.isBuffer(content) || !content.length) throw new FileError(400, 'El archivo está vacío');
  const mime = sniff(content);
  if (!mime) throw new FileError(415, 'Formato no admitido: sube fotos JPG, PNG o HEIC, o documentos PDF');
  if (!EXT[mime].test(name)) throw new FileError(415, 'La extensión del archivo no coincide con su contenido');
  const kind = mime === 'application/pdf' ? 'documento' : 'foto';
  if (content.length > (kind === 'foto' ? MAX_PHOTO : MAX_PDF)) {
    throw new FileError(413, kind === 'foto' ? 'La foto supera los 15 MB' : 'El PDF supera los 20 MB');
  }
  if (kind === 'documento') {
    // A complete file (end-of-file marker) whose structure opens with at least
    // one page — also when password-protected: the client may hold the
    // password. pdf-lib alone is lenient enough to accept a truncated header.
    let pages = 0;
    if (content.subarray(-1024).includes('%%EOF')) {
      try { pages = (await PDFDocument.load(content, { updateMetadata: false, ignoreEncryption: true })).getPageCount(); } catch { pages = 0; }
    }
    if (!pages) throw new FileError(415, 'El PDF está dañado o no se puede leer');
  }
  return { kind, mime, name: name.trim(), size: content.length, sha256: createHash('sha256').update(content).digest('hex') };
}

export function validateThumb(content) {
  if (!Buffer.isBuffer(content) || !isJpeg(content)) throw new FileError(415, 'La miniatura debe ser JPEG');
  if (content.length > MAX_THUMB) throw new FileError(413, 'Miniatura demasiado grande');
}
