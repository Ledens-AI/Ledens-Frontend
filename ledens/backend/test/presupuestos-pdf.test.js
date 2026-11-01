import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readBudgetPdf, pdfDraft, parseNumber, classifyHeader, fromLayout } from '../src/presupuestos/pdf.js';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
// Budget PDFs read into chapters and lines. The PDFs are generated here with
// fictitious data in the two layouts the company uses: the budget PDF
// (chapter column, two-line header, names wrapped above and below the figures,
// VAT-inclusive prices) and the spreadsheet export (chapter rows, «Avance»
// and «Notas» columns, Spanish number format).

async function pdf(draw) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([842, 595]);
  const t = (s, x, y, size = 8) => page.drawText(s, { x, y, size, font });
  draw(t);
  return Buffer.from(await doc.save());
}

const presentado = () => pdf((t) => {
  t('Sociedad Ficticia de Reformas SL', 40, 560, 10);
  t('Cliente:', 40, 530); t('Cliente de Prueba', 110, 530); t('IVA 21 %:', 520, 530); t('437.36', 700, 530);
  t('Dirección:', 40, 518); t('Calle Inventada 1, 29600, Marbella -', 110, 518);
  t('Proyecto:', 40, 506); t('Casa de prueba - Fontanería interior', 110, 506);
  t('Precio unitario', 668, 462);
  t('Capítulo', 30, 450); t('Código', 150, 450); t('Partida', 210, 450); t('Descripción', 380, 450); t('Unidad', 590, 450); t('Cantidad', 625, 450); t('Importe con IVA', 740, 450);
  t('con IVA', 668, 440);
  t('1. Fontanería y saneamiento', 30, 420); t('Fontanería y saneamiento', 210, 420); t('1,670.00 €', 740, 420);
  t('Suministro e instalación de tubería de', 210, 398); t('Montar la red de agua fría a baños y cocina,', 380, 398);
  t('1. Fontanería y saneamiento', 30, 386); t('PA-026', 150, 386); t('ml', 590, 386); t('55.00', 625, 386); t('14.00 €', 668, 386); t('770.00 €', 740, 386);
  t('agua fría', 210, 374); t('dejando la conexión hasta la pared.', 380, 374);
  t('Suministro e instalación de tubería de', 210, 340); t('Tubería de agua caliente con accesorios.', 380, 340);
  t('1. Fontanería y saneamiento', 30, 328); t('PA-158', 150, 328); t('ml', 590, 328); t('50.00', 625, 328); t('18.00 €', 668, 328); t('900.00 €', 740, 328);
  t('agua caliente sanitaria', 210, 316);
  t('Apertura de rozas y huecos', 210, 282); t('Rozas en paredes y suelos.', 380, 282);
  t('3. Partidas condicionadas', 30, 270); t('PA-025', 150, 270); t('ml', 590, 270); t('85.00', 625, 270); t('10.00 €', 668, 270); t('850.00 €', 740, 270);
  t('Exclusiones y advertencias generales', 40, 200, 9);
  t('• No se incluye la red de desagües.', 40, 186);
});

const hojaExportada = () => pdf((t) => {
  t('Obra:', 30, 540); t('Calle Falsa 2, Málaga', 90, 540);
  t('Presupuesto SIN IVA:', 500, 540); t('Total IVA:', 500, 528);
  const cols = [['Codigo', 30], ['Und', 70], ['Partida', 100], ['Definición', 280], ['Cantidad', 470], ['Precio Und', 520], ['Total Partida', 580], ['Avance', 650], ['Ejecutado (€)', 690], ['Notas', 760]];
  cols.forEach(([s, x]) => t(s, x, 500));
  const row = (y, v) => v.forEach((s, i) => s && t(s, cols[i][1], y));
  row(480, ['1', '', 'Demoliciones', '', '', '', '2.230,00', '0,8', '1.784,00', '']);
  row(462, ['1.1', 'ud', 'Demolición de chimenea', 'Demolición manual y controlada.', '2', '200,00', '400,00', '1', '400,00', 'Salón']);
  row(444, ['1.9', 'ud', 'Demolición de losa', 'Losas en armarios y baños.', '5', '250,00', '1.250,00', '0,8', '1.000,00', '']);
  row(426, ['2.14', 'm2', 'Demolición de solado', 'Picado de solado existente.', '4,375', '120,00', '580,00', '', '', '']);
  row(400, ['2', '', 'Tabiquería', '', '', '', '300,00', '', '', '']);
  row(382, ['2.1', 'm2', 'Tabique de pladur', 'Tabique sencillo.', '10', '30,00', '300,00', '', '', '']);
});

test('numbers and headers in both formats', () => {
  assert.deepEqual(['1.670,00 €', '1,670.00', '14,00', '55.00', '4,375', '12', 'abc'].map(parseNumber), [1670, 1670, 14, 55, 4.375, 12, null]);
  assert.deepEqual(['Código', 'Und', 'Precio unitario con IVA', 'Importe con IVA', 'Total Partida', 'Cantidad', 'Definición', 'Partida', 'Avance'].map(classifyHeader),
    ['code', 'unit', 'unitPrice', 'total', 'total', 'quantity', 'description', 'name', null]);
});

test('the presented-budget layout: chapters, wrapped names, VAT-inclusive prices, kind from the chapter', async () => {
  const b = await readBudgetPdf(await presentado());
  assert.equal(b.source, 'texto');
  assert.equal(b.pricesIncludeVat, true);
  assert.equal(b.vatRate, 21);
  assert.equal(b.title, 'Casa de prueba - Fontanería interior');
  assert.equal(b.address, 'Calle Inventada 1, 29600, Marbella');
  assert.deepEqual(b.chapters.map((c) => [c.name, c.items.length]), [['Fontanería y saneamiento', 2], ['Partidas condicionadas', 1]]);
  const [fria, caliente] = b.chapters[0].items;
  assert.deepEqual([fria.code, fria.name, fria.unit, fria.quantity, fria.unitPrice, fria.total, fria.kind], ['PA-026', 'Suministro e instalación de tubería de agua fría', 'ml', 55, 14, 770, 'confirmada']);
  assert.equal(fria.description, 'Montar la red de agua fría a baños y cocina, dejando la conexión hasta la pared.');
  assert.equal(caliente.name, 'Suministro e instalación de tubería de agua caliente sanitaria');
  assert.equal(b.chapters[1].items[0].kind, 'condicionada');
  assert.equal(b.totalDocument, 2520);
  assert.deepEqual(b.warnings, []);
  assert.match(b.notes, /No se incluye la red de desagües/);
});

test('the spreadsheet layout: chapter rows, Spanish numbers, extra columns ignored, a mismatch flagged', async () => {
  const b = await readBudgetPdf(await hojaExportada());
  assert.equal(b.pricesIncludeVat, false);
  assert.equal(b.address, null);
  assert.equal(b.title, 'Calle Falsa 2, Málaga');
  assert.deepEqual(b.chapters.map((c) => [c.name, c.items.map((i) => i.code)]), [['Demoliciones', ['1.1', '1.9', '2.14']], ['Tabiquería', ['2.1']]]);
  const losa = b.chapters[0].items[1];
  assert.deepEqual([losa.unit, losa.quantity, losa.unitPrice, losa.total], ['ud', 5, 250, 1250]);
  const solado = b.chapters[0].items[2];
  assert.equal(solado.quantity, 4.375);
  assert.equal(solado.check, true, '4,375 × 120,00 is not 580,00');
  assert.equal(b.warnings.length, 1);
});

test('without a text layer the OCR (layout tables) reads it; without OCR it says so', async () => {
  const scanned = await pdf(() => {});
  await assert.rejects(readBudgetPdf(scanned), { status: 422, message: /OCR no está configurado/ });
  const layout = { content: 'Proyecto: Baño escaneado\nIVA 10 %', tables: [{ cells: [
    ...['Código', 'Partida', 'Unidad', 'Cantidad', 'Precio unitario', 'Importe'].map((content, columnIndex) => ({ rowIndex: 0, columnIndex, content })),
    ...['', '1. Baño', '', '', '', '1.300,00'].map((content, columnIndex) => ({ rowIndex: 1, columnIndex, content })),
    ...['B-01', 'Alicatado porcelánico', 'm2', '20', '40,00', '800,00'].map((content, columnIndex) => ({ rowIndex: 2, columnIndex, content })),
    ...['', 'en paredes del baño', '', '', '', ''].map((content, columnIndex) => ({ rowIndex: 3, columnIndex, content })),
    ...['B-02', 'Plato de ducha', 'ud', '1', '500,00', '500,00'].map((content, columnIndex) => ({ rowIndex: 4, columnIndex, content })),
  ] }] };
  let sent = null;
  const ocr = { analyze: async (content) => { sent = content; return layout; } };
  const b = await readBudgetPdf(scanned, { ocr });
  assert.ok(sent.equals(scanned), 'the PDF goes to the OCR as is');
  assert.equal(b.source, 'ocr');
  assert.equal(b.vatRate, 10);
  assert.equal(b.title, 'Baño escaneado');
  assert.deepEqual(b.chapters.map((c) => [c.name, c.items.map((i) => `${i.code} ${i.name} ${i.quantity}×${i.unitPrice}`)]),
    [['Baño', ['B-01 Alicatado porcelánico en paredes del baño 20×40', 'B-02 Plato de ducha 1×500']]]);
  assert.equal(fromLayout({ tables: [] }), null);
  await assert.rejects(readBudgetPdf(Buffer.from('no soy un pdf')), { status: 400 });
});

test('the draft for the editor: net prices from VAT-inclusive ones, team only', async () => {
  const content = await presentado();
  await assert.rejects(pdfDraft({ role: 'client' }, content), { status: 403 });
  const d = await pdfDraft({ role: 'jefe' }, content);
  assert.equal(d.vatRate, '21');
  assert.equal(d.chapters[0].items[0].unitPrice, '11.570248');
  assert.equal(d.chapters[0].items[0].quantity, '55');
  assert.equal(d.totalDocument, '2520.00');
});

// ---- Through the API, with a database ----
let db, pool, admin, jefe, cliente;
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql']) await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  [admin, jefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES ('a@pdf.test','Admin','admin'),('j@pdf.test','Jefe PDF','jefe'),('c@pdf.test','Cliente PDF','client') RETURNING id,email,name,role`)).rows;
});
after(() => db?.close());

test('a jefe uploads the PDF, reviews it and sends it: the client finds it pending, with the PDF figures', async () => {
  const users = Object.fromEntries([admin, jefe, cliente].map((u) => [u.id, u]));
  const app = express();
  app.use('/api/presupuestos', createPresupuestosRouter({ pool, ocr: null, origin: 'https://ledens.test',
    authenticate: (req, _res, next) => { req.user = { ...users[req.get('x-test-user')] }; next(); }, findUser: async () => null }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}/api/presupuestos`;
  try {
    const content = await presentado();
    const post = (who, body) => fetch(base + '/pdf', { method: 'POST', headers: { 'x-test-user': who.id, origin: 'https://ledens.test', 'content-type': 'application/pdf' }, body });
    assert.equal((await post(cliente, content)).status, 403);
    const r = await post(jefe, content);
    assert.equal(r.status, 200);
    const draft = await r.json();
    assert.equal(draft.chapters.length, 2);
    // What the editor sends back after the review.
    const svc = new PresupuestosService(pool, jefe);
    assert.deepEqual((await svc.options()).jefes.map((j) => j.id), [jefe.id], 'a jefe only assigns themselves');
    let p = await svc.create({ ...draft, clientId: cliente.id, jefeId: admin.id });
    assert.equal(p.jefe.id, jefe.id, 'the jefe who uploads runs it');
    assert.equal(p.version.total, '2520.00');
    p = await svc.send(p.id);
    const seen = await new PresupuestosService(pool, cliente).get(p.id);
    assert.equal(seen.phase, 'pendiente');
    assert.equal(seen.can.decide, true);
    assert.deepEqual(seen.version.chapters.map((c) => c.items.map((i) => i.kind)), [['confirmada', 'confirmada'], ['condicionada']]);
  } finally { s.close(); }
});

test('every page is read, and a line without unit whose figures do not add up is kept and flagged', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = (draw) => { const p = doc.addPage([842, 595]); draw((s, x, y) => p.drawText(s, { x, y, size: 8, font })); };
  const header = (t) => [['Código', 30], ['Partida', 100], ['Cantidad', 470], ['Precio', 540], ['Importe', 620]].forEach(([s, x]) => t(s, x, 500));
  page((t) => { header(t); t('A-1', 30, 470); t('Partida que cuadra', 100, 470); t('2', 470, 470); t('10,00', 540, 470); t('20,00', 620, 470);
    t('A-2', 30, 440); t('Partida que no cuadra', 100, 440); t('2', 470, 440); t('10,00', 540, 440); t('25,00', 620, 440); });
  for (let n = 0; n < 33; n++) page((t) => t('Anexo ' + n, 30, 500));
  page((t) => { header(t); t('Z-1', 30, 470); t('Partida de la última página', 100, 470); t('1', 470, 470); t('5,00', 540, 470); t('5,00', 620, 470); });
  const b = await readBudgetPdf(Buffer.from(await doc.save()));
  const items = b.chapters.flatMap((c) => c.items);
  assert.deepEqual(items.map((i) => i.code), ['A-1', 'A-2', 'Z-1'], 'page 35 is read too');
  assert.deepEqual([items[1].unit, items[1].check, items[1].total], ['ud', true, 25]);
  assert.equal(b.totalDocument, 50);
});

// An English quote in the company's layout: «Unit price incl. / VAT» in two
// lines, chapter rows, descriptions far longer than the figures' line, two pages.
const englishQuote = async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = (draw) => { const p = doc.addPage([842, 595]); draw((s, x, y) => p.drawText(s, { x, y, size: 8, font })); };
  const header = (t) => { t('Unit price incl.', 620, 512); [['Code', 30], ['Unit', 90], ['Item', 140], ['Description', 320], ['Quantity', 560], ['Amount incl. VAT', 720]].forEach(([s, x]) => t(s, x, 500)); t('VAT', 620, 490); };
  const long = (t, y0, n, text) => { for (let i = 0; i < n; i++) t(`${text} line ${i + 1}`, 320, y0 - i * 10); };
  page((t) => {
    t('Project:', 30, 560); t('VAT 21%:', 500, 560); t('989,26 €', 620, 560);
    header(t);
    t('1', 30, 470); t('Demolition and dismantling', 140, 470); t('600,00 €', 720, 470);
    long(t, 440, 13, 'Cutting a trench through the slab');
    t('Cutting a 30 cm trench through the', 140, 386); t('PA-188', 30, 380); t('lin. m', 90, 380); t('15,00', 560, 380); t('40,00 €', 620, 380); t('600,00 €', 720, 380); t('concrete slab', 140, 372);
    t('2', 30, 300); t('Masonry', 140, 300); t('1.275,00 €', 720, 300);
    t('Ledens · Page 1 of 2', 380, 30);
  });
  page((t) => {
    header(t);
    long(t, 470, 8, 'Excavation beside the facade');
    t('PA-187', 30, 435); t('lin. m', 90, 435); t('30,00', 560, 435); t('20,00 €', 620, 435); t('600,00 €', 720, 435); t('Excavation of perimeter trench', 140, 435);
    long(t, 380, 9, 'Cleaning and sealing the slab');
    t('PA-189', 30, 340); t('m²', 90, 340); t('45,00', 560, 340); t('15,00 €', 620, 340); t('675,00 €', 720, 340); t('Cleaning, priming and sealing', 140, 340);
    t('1 Buried services along the trench route are not included.', 30, 200);
    t('Ledens · Page 2 of 2', 380, 30);
  });
  return Buffer.from(await doc.save());
};

test('an English quote: English headers, incl. VAT, long descriptions over two pages, chapter rows', async () => {
  const b = await readBudgetPdf(await englishQuote());
  assert.equal(b.source, 'texto');
  assert.equal(b.pricesIncludeVat, true);
  assert.equal(b.vatRate, 21);
  assert.equal(b.title, null, 'a label with nothing after it on its line gives no title');
  assert.deepEqual(b.chapters.map((c) => [c.name, c.items.map((i) => i.code)]), [['Demolition and dismantling', ['PA-188']], ['Masonry', ['PA-187', 'PA-189']]]);
  const [cut] = b.chapters[0].items;
  assert.deepEqual([cut.unit, cut.quantity, cut.unitPrice, cut.total], ['lin. m', 15, 40, 600]);
  assert.equal(cut.name, 'Cutting a 30 cm trench through the concrete slab');
  assert.match(cut.description, /^Cutting a trench through the slab line 1 .* line 13$/, 'all 13 description lines');
  const seal = b.chapters[1].items[1];
  assert.match(seal.description, /^Cleaning and sealing the slab line 1 .* line 9$/);
  assert.doesNotMatch(seal.description, /Buried|Page/, 'notes and footers stay out');
  assert.match(b.notes, /Buried services/);
  assert.equal(b.totalDocument, 1875);
});

test('a PDF budget can join an existing obra of the client: one more presupuesto, approved separately', async () => {
  const jefeSvc = new PresupuestosService(pool, jefe);
  // The client's obra, approved, run by this jefe; and a pending one that is not an obra yet.
  let obra = await jefeSvc.create({ title: 'Casa de prueba', clientId: cliente.id, chapters: [{ name: 'Obra', items: [{ name: 'Partida', unit: 'ud', quantity: '1', unitPrice: '100' }] }] });
  obra = await jefeSvc.send(obra.id);
  await new PresupuestosService(pool, cliente).approve(obra.id, { versionId: obra.version.id });
  const pending = await jefeSvc.send((await jefeSvc.create({ title: 'Otra pendiente', clientId: cliente.id, chapters: [{ name: 'C', items: [{ name: 'P', unit: 'ud', quantity: '1', unitPrice: '1' }] }] })).id);
  const opts = await jefeSvc.options();
  assert.ok(opts.obras.some((o) => o.id === obra.id && o.clientId === cliente.id && o.ref === obra.ref));
  assert.ok(!opts.obras.some((o) => o.id === pending.id), 'only approved obras');
  const otherJefe = (await db.query("INSERT INTO users(email,name,role) VALUES('j2@pdf.test','Otro jefe','jefe') RETURNING id,email,name,role")).rows[0];
  assert.deepEqual((await new PresupuestosService(pool, otherJefe).options()).obras, [], 'a jefe lists only the obras they run');
  // What the editor sends for «Obra: <that obra>».
  const draft = await pdfDraft(jefe, await presentado());
  let p = await jefeSvc.create({ ...draft, title: 'Solución aislamiento', parentId: obra.id });
  assert.equal(p.parent.id, obra.id);
  assert.equal(p.client.id, cliente.id);
  p = await jefeSvc.send(p.id);
  const mine = await new PresupuestosService(pool, cliente).list();
  assert.equal(mine.find((x) => x.id === p.id).phase, 'pendiente');
  assert.equal(mine.find((x) => x.id === p.id).parent.id, obra.id);
  assert.equal((await new PresupuestosService(pool, cliente).get(obra.id)).obra.base, '100.00', 'it adds to the obra only once approved');
});
