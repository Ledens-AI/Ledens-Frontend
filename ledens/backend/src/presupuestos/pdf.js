import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PresupuestoError } from './service.js';
import { loadCatalog, matchLines } from './catalog.js';

// Reads a budget PDF (the one presented to the client) into chapters and
// lines: code, name, description, unit, quantity, unit price and total.
// 1. The PDF's own text layer, rebuilt into a table from the header columns
//    (free and exact for PDFs exported from a spreadsheet).
// 2. If that does not give lines whose quantity × price matches their total,
//    OCR with Azure Document Intelligence (prebuilt-layout: tables), which
//    also reads scanned PDFs.
// Nothing is saved here: the result is a draft the team reviews before sending.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Header text → field, in Spanish or English. Order matters: the first match wins
// («Unit price» is a price, «Unit» alone the unit).
const COLUMNS = [
  ['chapter', /^(capitulo|chapter|section)/],
  ['code', /^(codigo|cod\b|ref\b|referencia|code)/],
  ['description', /^(descripcion|definicion|detalle|description|details)/],
  ['unitPrice', /^(precio|p\.\s*unit|pu\b|unit price|unit cost|price|rate)/],
  ['total', /^(importe|total|amount|subtotal)/],
  ['quantity', /^(cantidad|cant\b|medicion|uds\b|quantity|qty|quant)/],
  ['unit', /^(unidad(es)?|unid\b|und\b|ud\b|u\b|unit|units|uom)$/],
  ['name', /^(partida|concepto|unidad de obra|item|work item|concept)/],
];
export const classifyHeader = (text) => { const t = norm(text).replace(/:/g, ''); return (COLUMNS.find(([, re]) => re.test(t)) || [])[0] || null; };

// «1.670,00 €», «1,670.00», «14,00», «55.00», «4,375» → number, or null.
export function parseNumber(s) {
  let t = String(s ?? '').replace(/[€\s ]/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const c = t.lastIndexOf(','), d = t.lastIndexOf('.');
  if (c >= 0 && d >= 0) { const dec = c > d ? ',' : '.'; t = t.split(dec === ',' ? '.' : ',').join('').replace(dec, '.'); }
  else if (c >= 0) t = t.split(',').length > 2 ? t.split(',').join('') : t.replace(',', '.');
  else if (t.split('.').length > 2) t = t.split('.').join('');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
// «con IVA» / «incl. VAT» in the price headers.
const VAT_INCLUDED = (t) => /con iva|iva incl|incl\.? ?vat|including vat|vat incl/.test(t) && !/sin iva|excl\.? ?vat|excluding vat/.test(t);
const matches = (q, p, total) => Math.abs(q * p - total) <= Math.max(0.02, Math.abs(total) * 0.005);

const KIND = (chapter) => { const t = norm(chapter); return /condicionad|conditional/.test(t) ? 'condicionada' : /opcion|option/.test(t) ? 'opcion' : /decision/.test(t) ? 'decision' : 'confirmada'; };
const chapterName = (s) => String(s || '').replace(/^\s*\d+(\.\d+)*\.?\s+/, '').trim();

// Rows of { field: text } (already grouped per line item) → chapters.
export function buildBudget(records, { includesVat, vatRate, notes, title, address, source }) {
  const chapters = [];
  const warnings = [];
  let current = null;
  for (const r of records) {
    if (r.chapterHeader) { current = { name: chapterName(r.chapterHeader) || r.chapterHeader, items: [] }; chapters.push(current); continue; }
    const chName = r.chapter ? chapterName(r.chapter) : null;
    if (chName && (!current || norm(current.name) !== norm(chName))) { current = chapters.find((c) => norm(c.name) === norm(chName)) || null; if (!current) { current = { name: chName, items: [] }; chapters.push(current); } }
    if (!current) { current = { name: 'Presupuesto', items: [] }; chapters.push(current); }
    const quantity = r.quantity, total = r.total;
    const unitPrice = r.unitPrice ?? (total != null && quantity ? Math.round(total / quantity * 1e6) / 1e6 : null);
    let name = (r.name || '').trim(), description = (r.description || '').trim();
    if (!name) { const first = description.split(/(?<=\.)\s/)[0]; name = first.slice(0, 300); description = description === first ? '' : description; }
    const item = { code: (r.code || '').trim() || null, name: name || 'Partida sin nombre', description: description || null, unit: (r.unit || '').trim().slice(0, 20) || 'ud',
      quantity, unitPrice, total: total ?? (unitPrice != null ? Math.round(quantity * unitPrice * 100) / 100 : null), kind: KIND(current.name) };
    if (total != null && r.unitPrice != null && !matches(quantity, r.unitPrice, total)) {
      item.check = true; warnings.push(`«${item.name}»: ${quantity} × ${r.unitPrice} no da ${total}. Revisa la cantidad o el precio.`);
    }
    current.items.push(item);
  }
  const lines = chapters.flatMap((c) => c.items);
  return { source, title: title || null, address: address || null, vatRate, pricesIncludeVat: !!includesVat, notes: notes || null,
    chapters: chapters.filter((c) => c.items.length), warnings,
    totalDocument: Math.round(lines.reduce((a, i) => a + (i.total || 0), 0) * 100) / 100 };
}

// ---- 1. Text layer ---------------------------------------------------------

export const MAX_PAGES = 200;

async function textLines(content) {
  let pdf;
  try {
    pdf = await getDocument({ data: new Uint8Array(content), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
  } catch { fail(400, 'El fichero no es un PDF válido'); }
  // Every page is read: dropping some would leave whole chapters out unnoticed.
  if (pdf.numPages > MAX_PAGES) fail(400, `El PDF tiene ${pdf.numPages} páginas; el máximo es ${MAX_PAGES}. Divídelo en varios presupuestos.`);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const items = (await (await pdf.getPage(n)).getTextContent()).items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
    // Lines: items whose baselines are within 2.5 pt, left to right; neighbours
    // closer than a space are one cell («Precio» «unitario»).
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= 2.5);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const it of l.items) {
        const last = cells[cells.length - 1];
        if (last && it.x - (last.x + last.w) < 4) { last.str += (it.x - (last.x + last.w) > 0.5 ? ' ' : '') + it.str; last.w = it.x + it.w - last.x; }
        else cells.push({ ...it });
      }
      l.cells = cells.map((c) => ({ ...c, str: c.str.replace(/\s+/g, ' ').trim(), cx: c.x + c.w / 2 })).filter((c) => c.str);
    }
    pages.push(lines.sort((a, b) => b.y - a.y));
  }
  return pages;
}

// Columns from the header line: its classified cells plus classified cells of
// the lines just above/below (two-line headers such as «Precio unitario / con IVA»).
function headerOf(lines) {
  for (let i = 0; i < lines.length; i++) {
    const keys = lines[i].cells.map((c) => classifyHeader(c.str));
    if (keys.filter(Boolean).length < 3 || !keys.includes('quantity') || !(keys.includes('unitPrice') || keys.includes('total'))) continue;
    const cols = [];
    const near = lines.filter((l) => Math.abs(l.y - lines[i].y) <= 14);
    for (const l of near) for (const c of l.cells) { const k = classifyHeader(c.str); if (k && !cols.some((x) => x.key === k)) cols.push({ key: k, cx: c.cx, text: c.str }); }
    // Other header cells («Avance», «Notas»…) keep their own column, so their
    // values are not taken for the nearest known one.
    lines[i].cells.forEach((c, n) => { if (!keys[n] && !cols.some((x) => Math.abs(x.cx - c.cx) < 8)) cols.push({ key: `_${n}`, cx: c.cx, text: c.str }); });
    const extra = near.flatMap((l) => l.cells).map((c) => norm(c.str)).join(' ');
    const priceText = norm(near.flatMap((l) => l.cells).filter((c) => /precio|importe|total|iva|price|amount|vat/.test(norm(c.str))).map((c) => c.str).join(' '));
    cols.sort((a, b) => a.cx - b.cx);
    return { cols, y: Math.min(...near.map((l) => l.y)), top: Math.max(...near.map((l) => l.y)), includesVat: VAT_INCLUDED(priceText), extra };
  }
  return null;
}
// Page footers («Página 1 de 3», «Page 2 of 3») are never part of the table.
const FOOTER = /p[aá]gina\s+\d+\s+de\s+\d+|page\s+\d+\s+of\s+\d+/i;
// A chapter row's title: its longest text that is not just a number, whatever
// column it falls in.
const chapterTitle = (f) => Object.entries(f).filter(([k, v]) => !['quantity', 'unitPrice', 'total'].includes(k) && v && !/^[\d.,\s€%]+$/.test(v))
  .map(([, v]) => v.trim()).sort((a, b) => b.length - a.length)[0] || '';
const columnOf = (cols, cx) => cols.reduce((best, c) => (Math.abs(c.cx - cx) < Math.abs(best.cx - cx) ? c : best), cols[0]).key;

function fromText(pages, fullText) {
  let header = null;
  const records = [];
  const notes = [];
  for (const lines of pages) {
    const h = headerOf(lines);
    if (h) header = h;
    if (!header) continue;
    const body = lines.filter((l) => !h || l.y < h.y - 1);
    // Each line → { field: text } by nearest header column.
    const rows = body.map((l) => {
      const f = {};
      for (const c of l.cells) { const k = columnOf(header.cols, c.cx); f[k] = f[k] ? `${f[k]} ${c.str}` : c.str; }
      return { y: l.y, f, text: l.cells.map((c) => c.str).join(' ') };
    });
    const anchors = [];
    for (const r of rows) {
      const q = parseNumber(r.f.quantity), p = parseNumber(r.f.unitPrice), t = parseNumber(r.f.total);
      // A line with figures is kept even if they do not add up: buildBudget flags it for review.
      if (q != null && q > 0 && (p != null || t != null)) {
        r.anchor = { quantity: q, unitPrice: p, total: t, parts: {} };
        anchors.push(r);
      } else if (q == null && p == null && (t != null || /^\s*\d+(\.\d+)*\.?\s+\S/.test(r.f.chapter || r.f.code || r.f.name || '')) && !FOOTER.test(r.text) && chapterTitle(r.f)) {
        r.chapterHeader = chapterTitle(r.f);
      }
    }
    if (!anchors.length) continue;
    // Text lines: a name or description belongs to the line item whose figures
    // are nearest, however long it is (cells are centred on their figures).
    // Below the last figures of the page it continues only while the lines run
    // on without a gap; after that come the notes (exclusions, conditions).
    const lastY = anchors[anchors.length - 1].y;
    // Below the last figures, a numbered line without an amount is a note
    // («1 Buried services…»), not a chapter.
    for (const r of rows) if (r.chapterHeader && r.y < lastY && parseNumber(r.f.total) == null) delete r.chapterHeader;
    let tail = lastY, inTail = true;
    for (const r of rows) {
      if (r.anchor || FOOTER.test(r.text)) continue;
      if (r.chapterHeader) { if (r.y < lastY) inTail = false; continue; }
      if (r.y < lastY) {
        if (inTail && tail - r.y <= 16) { tail = r.y; (anchors[anchors.length - 1].anchor.extra ||= []).push(r); continue; }
        inTail = false; notes.push(r.text); continue;
      }
      const a = anchors.reduce((best, x) => (Math.abs(x.y - r.y) < Math.abs(best.y - r.y) ? x : best), anchors[0]);
      if (Math.abs(a.y - r.y) > 150) continue;
      (a.anchor.extra ||= []).push(r);
    }
    for (const r of rows) {
      if (r.chapterHeader) { records.push({ y: r.y, chapterHeader: r.chapterHeader }); continue; }
      if (!r.anchor) continue;
      const parts = [r, ...(r.anchor.extra || [])].sort((x, y) => y.y - x.y);
      const join = (k) => parts.map((x) => x.f[k]).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      records.push({ y: r.y, chapter: join('chapter'), code: r.f.code, name: join('name'), description: join('description'), unit: r.f.unit,
        quantity: r.anchor.quantity, unitPrice: r.anchor.unitPrice, total: r.anchor.total });
    }
  }
  if (!header) return null;
  return buildBudget(records, { includesVat: header.includesVat, ...docFacts(fullText, notes), source: 'texto' });
}

// Title, address, VAT rate and notes found around the table.
function docFacts(fullText, notes = []) {
  const text = String(fullText || '');
  // The value is the next cell after the label (cells are joined with 3+ spaces).
  const after = (label) => { const m = text.match(new RegExp(`${label}[ \\t]*:[ \\t]*([^\\n]{3,200})`, 'i')); const v = m ? m[1].split(/\s{3,}/)[0].replace(/\s*-\s*$/, '').trim() : ''; return v && !/:$/.test(v) ? v : null; };
  const vat = text.match(/(?:IVA|VAT)\s*\(?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
  return {
    title: after('Proyecto') || after('Obra') || after('Project'),
    address: after('Direcci[oó]n') || after('Address'),
    vatRate: vat ? Number(vat[1].replace(',', '.')) : 21,
    notes: notes.join('\n').slice(0, 5000) || null,
  };
}

// ---- 2. OCR (Azure Document Intelligence, prebuilt-layout) -----------------

export class LayoutOcr {
  constructor(endpoint, key, fetcher = fetch) { this.endpoint = endpoint?.replace(/\/$/, ''); this.key = key; this.fetch = fetcher; }
  async request(url, options = {}) {
    const r = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Ocp-Apim-Subscription-Key': this.key, ...options.headers } });
    if (!r.ok) fail(502, 'El servicio de OCR no ha respondido. Inténtalo de nuevo en un momento.');
    return r;
  }
  trusted(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.origin !== new URL(this.endpoint).origin || !u.pathname.startsWith('/documentintelligence/documentModels/prebuilt-layout/analyzeResults/')) fail(502, 'Respuesta de OCR no válida');
    return u.href;
  }
  async analyze(content, { wait = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 30 } = {}) {
    const r = await this.request(`${this.endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30&locale=es-ES`, {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: content });
    const op = this.trusted(r.headers.get('operation-location'));
    for (let i = 0; i < tries; i++) {
      await wait(i ? 1500 : 1000);
      const res = await (await this.request(op)).json();
      if (res.status === 'succeeded') return res.analyzeResult;
      if (res.status === 'failed') fail(422, 'El OCR no ha podido leer el PDF');
    }
    fail(504, 'El OCR está tardando demasiado. Inténtalo de nuevo.');
  }
}

export function fromLayout(result) {
  const records = [];
  let header = null;
  for (const table of result?.tables || []) {
    const grid = [];
    for (const c of table.cells || []) { (grid[c.rowIndex] ||= [])[c.columnIndex] = String(c.content || '').replace(/\s+/g, ' ').trim(); }
    let start = 0;
    const hi = grid.findIndex((row) => { const keys = (row || []).map(classifyHeader); return keys.filter(Boolean).length >= 3 && keys.includes('quantity'); });
    if (hi >= 0) {
      const row = grid[hi];
      header = { keys: row.map(classifyHeader), text: norm(row.join(' ')) };
      start = hi + 1;
    }
    if (!header) continue;
    let last = null;
    for (let i = start; i < grid.length; i++) {
      const f = {};
      (grid[i] || []).forEach((v, j) => { const k = header.keys[j]; if (k && v) f[k] = f[k] ? `${f[k]} ${v}` : v; });
      const q = parseNumber(f.quantity), p = parseNumber(f.unitPrice), t = parseNumber(f.total);
      if (q != null && q > 0 && (p != null || t != null)) {
        last = { chapter: f.chapter, code: f.code, name: f.name, description: f.description, unit: f.unit, quantity: q, unitPrice: p, total: t };
        records.push(last);
      } else if (q == null && p == null && (t != null || /^\s*\d+(\.\d+)*\.?\s+\S/.test(f.chapter || f.code || f.name || '')) && chapterTitle(f)) {
        records.push({ chapterHeader: chapterTitle(f) }); last = null;
      } else if (last) {
        for (const k of ['name', 'description']) if (f[k]) last[k] = `${last[k] || ''} ${f[k]}`.trim();
      }
    }
  }
  if (!header) return null;
  const priceText = header.text;
  return buildBudget(records, { includesVat: VAT_INCLUDED(priceText), ...docFacts(result.content), source: 'ocr' });
}

// ---- Entry point -------------------------------------------------------------

const good = (b) => b && b.chapters.length && b.chapters.flatMap((c) => c.items).filter((i) => !i.check).length / b.chapters.flatMap((c) => c.items).length >= 0.8;

export async function readBudgetPdf(content, { ocr } = {}) {
  if (!Buffer.isBuffer(content) || content.subarray(0, 5).toString('latin1') !== '%PDF-') fail(400, 'Sube el presupuesto en PDF');
  const pages = await textLines(content);
  const fullText = pages.map((lines) => lines.map((l) => l.cells.map((c) => c.str).join('   ')).join('\n')).join('\n');
  const fromLayer = fromText(pages, fullText);
  if (good(fromLayer)) return fromLayer;
  if (ocr) {
    const viaOcr = fromLayout(await ocr.analyze(content));
    if (viaOcr && viaOcr.chapters.length) return viaOcr;
  }
  if (fromLayer && fromLayer.chapters.length) return fromLayer;
  fail(422, ocr ? 'No se han encontrado partidas en el PDF (tabla con cantidad y precio).' : 'No se han encontrado partidas en el texto del PDF y el OCR no está configurado.');
}

// What the editor receives: net unit prices (6 decimals, like imports), the
// figures as read, and the warnings to review. Only the team may read PDFs.
// With `db`, each line is matched against the base de partidas (catalog.js):
// baseCode, annotations and, when no partida covers it, a proposed new one.
export async function pdfDraft(user, content, { ocr, db, translator } = {}) {
  if (!['admin', 'jefe'].includes(user?.role)) fail(403, 'Solo el equipo puede subir presupuestos');
  const b = await readBudgetPdf(content, { ocr });
  const vat = Number(b.vatRate) >= 0 && Number(b.vatRate) < 100 ? Number(b.vatRate) : 21;
  const lines = b.chapters.flatMap((c) => c.items);
  let matches = lines.map(() => null);
  const warnings = [...b.warnings];
  if (db) {
    try {
      matches = await matchLines(lines, await loadCatalog(db), { translator, pricesIncludeVat: b.pricesIncludeVat, vatRate: vat });
    } catch (e) {
      console.error('[presupuestos] base de partidas no disponible', e.message);
      warnings.push('No se ha podido consultar la base de partidas: las líneas no se han casado con ella.');
    }
  }
  let n = 0;
  const net = (p) => (p == null ? null : b.pricesIncludeVat ? (p / (1 + vat / 100)).toFixed(6) : String(Math.round(p * 1e6) / 1e6));
  return {
    source: b.source, title: b.title, address: b.address, vatRate: String(vat), pricesIncludeVat: b.pricesIncludeVat, notes: b.notes,
    totalDocument: b.totalDocument.toFixed(2), warnings,
    chapters: b.chapters.map((c) => ({ name: c.name.slice(0, 200), items: c.items.map((i) => ({
      code: i.code ? i.code.slice(0, 40) : '', name: i.name.slice(0, 300), description: (i.description || '').slice(0, 4000), unit: i.unit,
      quantity: String(Math.round(i.quantity * 1000) / 1000), unitPrice: net(i.unitPrice) ?? '0', kind: i.kind, check: !!i.check,
      ...matchFields(matches[n++]),
    })) })),
  };
}

const matchFields = (m) => (m ? { baseCode: m.baseCode, baseName: m.baseName, annotations: m.annotations, translation: m.translation, proposal: m.proposal } : {});
