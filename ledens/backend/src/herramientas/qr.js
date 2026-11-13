import qrcode from 'qrcode-generator';

// The SVG of an asset's label. The QR only carries <app>/h/<token> (see
// qrUrl in service.js): no name, no code, nothing sensitive, no credential.
// Error correction M (15 %) survives the scratches of a site; a short URL
// keeps the modules large enough to scan from a phone at arm's length.
export function qrSvg(url) {
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, title: 'Etiqueta Ledens Tools' });
}
