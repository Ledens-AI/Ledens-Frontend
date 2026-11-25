import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { NOTA_LEGAL } from './emisor.js';

// The PDF of one invoice (A4), laid out like the example invoice 4T2026-347:
// issuer top right, client block, one concept line, totals and payment
// details. Built from the invoice row only (facturas, a snapshot), so the same
// invoice always gives the same document. Long client data or concept move
// the next block to a new page (never cut it): the payment details and the
// legal note are always printed whole.
const LOGO = fs.readFileSync(new URL('./logo.png', import.meta.url));
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex('#1F1F1F'), muted: hex('#6B6B68'), brand: hex('#5567AE'), band: hex('#8B96C8'), bandSoft: hex('#DDE3F3'),
  teal: hex('#C5E8E3'), line: hex('#3A3A38'), light: hex('#BDBDBD'), white: rgb(1, 1, 1),
};
const W = 595.28, H = 841.89, L = 40, R = W - 40, BOTTOM = 50;

// 1234.5 → "1.234,50 €" (Spanish format, grouping from the thousands).
export function euros(v) {
  const c = Math.round(Number(v) * 100), neg = c < 0, a = Math.abs(c);
  const int = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${int},${String(a % 100).padStart(2, '0')} €`;
}
const pctText = (v) => `${String(Number(v)).replace('.', ',')} %`;
const dmy = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}/${m}/${y}`; };

export async function facturaPdf(f) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Factura ${f.numero}`);
  doc.setAuthor(f.emisor.nombre);
  doc.setCreator('Ledens');
  doc.setProducer('Ledens');
  doc.setCreationDate(new Date(f.created_at || Date.now()));
  let page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await doc.embedPng(LOGO);

  // Standard fonts only encode WinAnsi: anything else (emoji, other scripts)
  // becomes «?» instead of failing the whole document.
  const ok = new Map();
  const safe = (fnt, s) => [...String(s ?? '').replace(/[\r\n\t]+/g, ' ')].map((ch) => {
    const k = fnt.name + ch;
    if (!ok.has(k)) { try { fnt.encodeText(ch); ok.set(k, true); } catch { ok.set(k, false); } }
    return ok.get(k) ? ch : '?';
  }).join('');
  const width = (fnt, s, size) => fnt.widthOfTextAtSize(s, size);
  const text = (s, x, y, { f: fnt = font, size = 9.5, color = C.ink, align = 'left' } = {}) => {
    const t = safe(fnt, s);
    const w = width(fnt, t, size);
    page.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y, size, font: fnt, color });
  };
  // Lines of at most maxWidth; a word longer than the line is cut.
  const wrap = (s, fnt, size, maxWidth) => {
    const lines = [];
    for (const para of String(s ?? '').split(/\r?\n/)) {
      let line = '';
      for (let word of safe(fnt, para).split(/\s+/).filter(Boolean)) {
        while (width(fnt, word, size) > maxWidth) {
          let n = word.length - 1;
          while (n > 1 && width(fnt, word.slice(0, n), size) > maxWidth) n--;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, n));
          word = word.slice(n);
        }
        const next = line ? `${line} ${word}` : word;
        if (width(fnt, next, size) <= maxWidth) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  };
  const rect = (x, y, w, h, { fill, border, borderWidth = 0.8 } = {}) =>
    page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: border, borderWidth: border ? borderWidth : 0 });
  const vline = (x, y1, y2, color = C.line) => page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.8, color });

  // Header: logo and wordmark on the left, the issuer on the right.
  const top = H - 40;
  page.drawImage(logo, { x: L, y: top - 58, width: 58, height: 58 });
  text('Ledens', L + 66, top - 34, { f: bold, size: 30, color: C.brand });
  text('DESCUBRE  |  ANALIZA  |  RENTABILIZA', L + 68, top - 47, { size: 5.5, color: C.muted });
  const e = f.emisor;
  const issuer = [e.nombre, e.cif ? `CIF: ${e.cif}` : null, e.direccion,
    [e.telefono ? `Teléfono: ${e.telefono}` : null, e.email ? `Email: ${e.email}` : null].filter(Boolean).join(' - ')].filter(Boolean);
  issuer.forEach((s, i) => text(s, R, top - 10 - i * 15, { f: bold, size: 9, align: 'right' }));

  // The invoice and its client.
  let y = top - 100;
  // A block of height h that does not fit above the bottom margin starts a new page.
  const ensure = (h) => {
    if (y - h >= BOTTOM) return;
    page = doc.addPage([W, H]);
    text(`Factura ${f.numero} (continuación)`, L, H - 40, { f: bold, size: 9, color: C.muted });
    y = H - 64;
  };
  const labelX = L, valueX = L + 70, valueW = R - valueX;
  const rows = [['Nº Factura:', f.numero], ['Fecha:', dmy(f.fecha)], ['Cliente:', f.cliente_nombre], ['CIF/NIF:', f.cliente_nif],
    ['Dirección:', f.cliente_direccion], ['Teléfono:', f.cliente_telefono || ''], ['Email:', f.cliente_email || '']];
  for (const [label, value] of rows) {
    const lines = wrap(value, bold, 9.5, valueW);
    ensure(13 * lines.length + 2);
    text(label, labelX, y);
    lines.forEach((l, i) => text(l, valueX, y - i * 13, { f: bold }));
    y -= 13 * Math.max(1, lines.length) + 2;
  }

  // One line: the concept with its net price, VAT and total (header and line together).
  const cols = [L, L + 40, L + 300, L + 375, L + 445, R];
  const concept = wrap(f.concepto, font, 9.5, cols[2] - cols[1] - 12);
  const rowH = Math.max(40, concept.length * 12.5 + 18);
  y -= 18;
  ensure(26 + 8 + rowH);
  const head = ['Nº', 'Concepto', 'Precio (€)', `IVA (${pctText(f.iva_pct)})`, 'Total (€)'];
  rect(L, y - 26, R - L, 26, { fill: C.band });
  head.forEach((h, i) => text(h, (cols[i] + cols[i + 1]) / 2, y - 16.5, { size: 9, align: 'center' }));
  y -= 26 + 8;
  rect(L, y - rowH, R - L, rowH, { border: C.line });
  for (const x of cols.slice(1, -1)) vline(x, y, y - rowH);
  const mid = y - rowH / 2 - 3.5;
  text('1', (cols[0] + cols[1]) / 2, mid, { align: 'center' });
  concept.forEach((l, i) => text(l, cols[1] + 6, y - rowH / 2 + (concept.length - 1) * 6.25 - 3.5 - i * 12.5));
  text(euros(f.base), cols[3] - 6, mid, { align: 'right' });
  text(euros(f.iva), cols[4] - 6, mid, { align: 'right' });
  text(euros(f.total), cols[5] - 6, mid, { align: 'right' });
  y -= rowH + 22;

  // Totals.
  const split = cols[4] - 10, rowT = 22;
  ensure(20 + rowT * 3);
  rect(L, y - 20, R - L, 20, { fill: C.teal });
  text('Resumen', split - 8, y - 13.5, { align: 'right' });
  text('Importe', R - 6, y - 13.5, { align: 'right' });
  vline(split, y, y - 20, C.light);
  y -= 20;
  const totals = [['Base imponible', euros(f.base), bold], [`IVA (${pctText(f.iva_pct)})`, euros(f.iva), font]];
  for (const [label, value, fnt] of totals) {
    rect(L, y - rowT, R - L, rowT, { border: C.light, borderWidth: 0.6 });
    vline(split, y, y - rowT, C.light);
    text(label, split - 8, y - 14.5, { f: fnt, align: 'right' });
    text(value, R - 6, y - 14.5, { f: fnt, align: 'right' });
    y -= rowT;
  }
  rect(L, y - rowT, R - L, rowT, { fill: C.band });
  vline(split, y, y - rowT, C.white);
  text('Total factura', split - 8, y - 14.5, { f: bold, color: C.white, align: 'right' });
  text(euros(f.total), R - 6, y - 14.5, { f: bold, color: C.white, align: 'right' });
  y -= rowT + 26;

  // Payment details and the legal note, kept together.
  const note = wrap(NOTA_LEGAL, italic, 7.5, R - L - 40);
  const noteH = note.length * 10 + 26;
  ensure(28 + 36 + noteH);
  rect(L, y - 28, R - L, 28, { fill: C.band });
  text('Forma de pago', L + 10, y - 18, { f: bold, color: C.white });
  y -= 28;
  rect(L, y - 36, R - L, 36, { fill: C.bandSoft });
  text(`Transferencia bancaria  ·  IBAN: ${e.iban || '—'}`, L + 10, y - 22);
  y -= 36;
  rect(L, y - noteH, R - L, noteH, { border: C.light, borderWidth: 0.6 });
  note.forEach((l, i) => text(l, L + 20, y - 17 - i * 10, { f: italic, size: 7.5 }));

  const pages = doc.getPages();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      page = p;
      text(`Página ${i + 1} de ${pages.length}`, R, 26, { size: 7.5, color: C.muted, align: 'right' });
    });
  }
  return doc.save();
}
