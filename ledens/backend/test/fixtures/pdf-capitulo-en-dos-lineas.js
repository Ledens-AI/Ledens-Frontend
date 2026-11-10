import { PDFDocument, StandardFonts } from 'pdf-lib';
// Fictitious budget PDF in the company's layout where the chapter column wraps
// beside each partida, on the same line as the first line of its name
// (presupuestos-pdf.test.js, presupuestos-reparar-nombres.test.js).
async function pdf(draw) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([842, 595]);
  draw((s, x, y, size = 8) => page.drawText(s, { x, y, size, font }));
  return Buffer.from(await doc.save());
}

export const capituloEnDosLineas = () => pdf((t) => {
  t('Precio unitario', 668, 462);
  t('Capítulo', 30, 450); t('Partida', 150, 450); t('Descripción', 380, 450); t('Unidad', 590, 450); t('Cantidad', 625, 450); t('Importe con IVA', 740, 450);
  t('con IVA', 668, 440);
  t('2. Demoliciones y desmontajes', 30, 420); t('Subtotal de partidas CONFIRMADAS', 380, 420); t('207,04 €', 740, 420);
  t('2. Demoliciones y', 30, 398); t('Retirada de tela existente en techo', 150, 398); t('Retirada de la tela que cubre el techo,', 380, 398);
  t('m²', 590, 390); t('6,42', 625, 390); t('12', 668, 390); t('77,04 €', 740, 390);
  t('desmontajes', 30, 382); t('(aseo pequeño y entrada)', 150, 382); t('con limpieza del soporte.', 380, 382);
  t('2. Demoliciones y', 30, 340); t('Desmontaje inodoro en baño', 150, 340); t('Desmontaje del inodoro.', 380, 340);
  t('ud', 590, 332); t('2', 625, 332); t('65,00 €', 668, 332); t('130,00 €', 740, 332);
  t('desmontajes', 30, 324);
  t('3. Albañilería', 30, 290);
  t('3. Albañilería', 30, 270); t('Regularización de paredes', 150, 270); t('m²', 590, 270); t('35,00', 625, 270); t('8,00 €', 668, 270); t('280,00 €', 740, 270);
});

