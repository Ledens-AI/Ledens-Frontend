import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { InformesService } from '../src/presupuestos/informes.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
// The PDFs a client prints or forwards (presupuestos/informes.js): the budget
// in force of an obra (original + approved ampliaciones), the version on
// screen of a presupuesto not approved yet, and the progress of every partida.
// On PGlite, read back with pdf.js.
let db, pool, admin, jefe, cliente, otroCliente, obraId, ampId, pendienteId, removedName;
const as = (u) => new PresupuestosService(pool, u);
const informes = (u, opts = {}) => new InformesService(as(u), { now: () => new Date('2026-11-27T10:00:00Z'), ...opts });
const LONG = Array.from({ length: 120 }, (_, n) => `Paso ${n + 1}: preparación del soporte, replanteo y limpieza.`).join(' ').slice(0, 4000);

// Every text of the PDF with its page and height, plus the whole text per page.
async function read(bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
  const items = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    for (const it of (await (await pdf.getPage(n)).getTextContent()).items) if (it.str.trim()) items.push({ page: n, x: it.transform[4], y: it.transform[5], str: it.str });
  }
  return { pages: pdf.numPages, items, text: items.map((i) => i.str).join('\n') };
}

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT true, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz DEFAULT now());
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql',
    '032_traducciones_presupuesto.sql', '033_presupuestos_proyecto.sql', '045_traducciones_presupuesto_es.sql', '048_partidas_eliminadas.sql']) {
    await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  }
  [admin, jefe, cliente, otroCliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@inf.test','Admin Test','admin'),('jefe@inf.test','Jefe Test','jefe'),('cliente@inf.test','Cliente Test','client'),('otro@inf.test','Otro Cliente','client')
    RETURNING id,email,name,role`)).rows;
  const d = await as(admin).create({ title: 'Reforma de baño', address: 'C/ Ficticia 1, Málaga', clientId: cliente.id, jefeId: jefe.id, vatRate: '21',
    notes: 'No incluye sanitarios.',
    chapters: [
      { name: 'Demoliciones', items: [
        { code: 'PA-001', name: 'Demolición de alicatado', description: 'Con retirada de escombros a contenedor.', unit: 'm2', quantity: '20', unitPrice: '15',
          annotations: [{ type: 'precio', text: 'NOTA INTERNA DEL EQUIPO' }] },
        { code: 'PA-002', name: 'Retirada de bañera', unit: 'ud', quantity: '1', unitPrice: '120' },
        { code: 'PA-003', name: 'Desmontaje de mampara antigua', unit: 'ud', quantity: '1', unitPrice: '60' }] },
      { name: 'Fontanería', items: [
        { code: 'PA-010', name: 'Plato de ducha', description: LONG, unit: 'ud', quantity: '1', unitPrice: '450' },
        { code: 'PA-011', name: 'Apertura de rozas', unit: 'ml', quantity: '12.5', unitPrice: '8', kind: 'condicionada' },
        { code: 'OP-01', name: 'Termo eléctrico 80 l', unit: 'ud', quantity: '1', unitPrice: '380', kind: 'opcion' }] }] });
  obraId = d.id;
  await as(admin).send(obraId);
});
after(() => db?.close());

test('a presupuesto not approved yet: the version on screen, optional lines apart, only to who may see it', async () => {
  const { filename, bytes } = await informes(cliente).presupuesto(obraId);
  assert.match(filename, /^Presupuesto_PRE-\d{4}-\d{3}_v1_Reforma_de_bano\.pdf$/);
  const pdf = await read(bytes);
  for (const s of ['Presupuesto', 'Reforma de baño', 'Cliente Test', 'Jefe Test', 'Demolición de alicatado', 'Con retirada de escombros a contenedor.',
    'Partida condicionada', 'Opcional · no incluida en el total', 'No incluye sanitarios.', 'Condiciones y exclusiones']) assert.ok(pdf.text.includes(s), s);
  assert.match(pdf.text, /Versión 1 · enviada el \d{2}\/\d{2}\/\d{4}/);
  // 300 + 120 + 60 + 450 + 100 = 1030 net; the 380 € option stays apart.
  for (const s of ['1.030,00 €', '216,30 €', '1.246,30 €', 'Opciones no incluidas (sin IVA)', '380,00 €']) assert.ok(pdf.text.includes(s), s);
  assert.ok(!pdf.text.includes('NOTA INTERNA'), 'team annotations are never printed');
  // The 4000-character description runs over the page: nothing drawn outside it, every page numbered.
  assert.ok(pdf.pages >= 2);
  assert.ok(pdf.items.every((i) => i.y >= 20 && i.y <= 842 && i.x >= 30 && i.x <= 570), 'everything inside the page');
  assert.ok(pdf.text.includes(`Página ${pdf.pages} de ${pdf.pages}`));
  assert.ok(pdf.text.includes('Paso 1:') && pdf.text.includes('Paso 60:'), 'the long description is printed whole, not cut');
  await assert.rejects(informes(otroCliente).presupuesto(obraId), { status: 404 });
});

test('an approved obra: the original quote and every approved ampliación, pending ones listed apart', async () => {
  const c = await as(cliente).get(obraId);
  await as(cliente).approve(obraId, { versionId: c.version.id });
  await as(jefe).schedule(obraId, { startDate: '2026-11-02', endDate: '2026-12-18' });
  // A line removed once approved no longer counts and is not printed.
  const mampara = (await as(jefe).get(obraId)).version.chapters[0].items.find((i) => i.code === 'PA-003');
  removedName = mampara.name;
  await as(jefe).removeLine(obraId, mampara.id, { reason: 'La desmonta el cliente' });
  let a = await as(jefe).create({ parentId: obraId, title: 'Ampliación: ventana del baño', notes: 'Cristal según muestra elegida.',
    chapters: [{ name: 'Carpintería', items: [{ code: 'PA-050', name: 'Ventana de aluminio', unit: 'ud', quantity: '1', unitPrice: '500' }] }] });
  a = await as(jefe).send(a.id);
  await as(cliente).approve(a.id, { versionId: a.version.id });
  ampId = a.id;
  let p = await as(jefe).create({ parentId: obraId, title: 'Ampliación: toallero', chapters: [{ name: 'Accesorios', items: [{ name: 'Toallero eléctrico', unit: 'ud', quantity: '1', unitPrice: '200' }] }] });
  p = await as(jefe).send(p.id);
  pendienteId = p.id;

  const doc = await as(cliente).get(obraId);
  const { filename, bytes } = await informes(cliente).presupuesto(obraId);
  assert.match(filename, /^Presupuesto_PRE-\d{4}-\d{3}_Reforma_de_bano\.pdf$/, 'no version: it is the whole obra');
  const pdf = await read(bytes);
  for (const s of ['Presupuesto de la obra', 'Presupuesto vigente: el inicial y la ampliación aprobada', `Presupuesto inicial · ${doc.ref}`,
    `Ampliación ${(await as(cliente).get(ampId)).ref} · Ampliación: ventana del baño`, 'Ventana de aluminio', 'Total de la ampliación (sin IVA)',
    'Ampliaciones pendientes de aprobación', 'Ampliación: toallero', 'No incluye sanitarios.', 'Cristal según muestra elegida.', 'Resumen']) assert.ok(pdf.text.includes(s), s);
  // 970 (1030 − the removed 60) + 500 = 1470 net, 21 % VAT: the obra's figures.
  assert.equal(doc.obra.base, '1470.00');
  for (const s of ['1.470,00 €', '308,70 €', '1.778,70 €', 'IVA (21 %)']) assert.ok(pdf.text.includes(s), s);
  assert.ok(!pdf.text.includes(removedName), 'a removed line is not in the budget in force');
  assert.ok(!pdf.text.includes('Toallero eléctrico'), 'a pending ampliación is listed, never detailed or added');
  assert.ok(!pdf.text.includes('Termo eléctrico'), 'an option not chosen is not part of the obra');

  // The version on screen can still be printed on its own.
  const v1 = await read((await informes(cliente).presupuesto(obraId, { versionId: doc.version.id })).bytes);
  assert.ok(v1.text.includes('Opciones no elegidas (sin IVA)'));
  assert.ok(!v1.text.includes('Ventana de aluminio'));
});

test('the progress report: every partida with its %, by chapter and overall', async () => {
  await assert.rejects(informes(cliente).avance(ampId), { status: 400 }, 'from the main obra');
  const d0 = await as(jefe).get(obraId);
  const line = (code) => d0.obra.chapters.flatMap((c) => c.items).find((i) => i.code === code);
  const d = await as(jefe).declare(obraId, { items: [
    { partidaId: line('PA-001').id, executed: '20' }, { partidaId: line('PA-010').id, executed: '0.5' },
    { partidaId: line('PA-011').id, executed: '15' }, { partidaId: line('PA-050').id, executed: '0' }] });
  const { filename, bytes } = await informes(cliente).avance(obraId);
  assert.match(filename, /^Avance_PRE-\d{4}-\d{3}_2026-11-27\.pdf$/);
  const pdf = await read(bytes);
  const pct = (v) => `${String(v).replace('.', ',')} %`;
  for (const s of ['Informe de avance de obra', 'Situación de cada partida a 27/11/2026', 'Avance general de la obra', pct(d.obra.executionPct),
    'Avance por capítulo', 'Avance por partida', 'Demolición de alicatado', '100 %', '50 %', 'Ventana de aluminio', '0 %', 'Inicio de la obra', '02/11/2026', '18/12/2026',
    'Se ha ejecutado más de lo presupuestado', 'Cómo leer este informe']) assert.ok(pdf.text.includes(s), s);
  assert.match(pdf.text, /Actualizado el \d{2}\/\d{2}\/\d{4}/);
  assert.match(pdf.text, /Incluye las ampliaciones aprobadas: PRE-\d{4}-\d{3}\./);
  assert.ok(pdf.text.includes('20 m2') && pdf.text.includes('12,5 ml') && pdf.text.includes('15 ml'));
  assert.ok(!pdf.text.includes(removedName) && !pdf.text.includes('Toallero'), 'only what counts in the obra');
  assert.ok(pdf.items.every((i) => i.y >= 20 && i.y <= 842));
  await assert.rejects(informes(otroCliente).avance(obraId), { status: 404 });
});

test('no progress report before the obra is approved and started', async () => {
  const d = await as(admin).create({ title: 'Cocina', clientId: cliente.id, chapters: [{ name: 'C', items: [{ name: 'Encimera', unit: 'ud', quantity: '1', unitPrice: '900' }] }] });
  await assert.rejects(informes(admin).avance(d.id), { status: 409 });
  await assert.rejects(informes(cliente).presupuesto(d.id), { status: 404 }, 'a draft is the team’s');
  const v = (await as(admin).send(d.id)).version;
  await as(cliente).approve(d.id, { versionId: v.id });
  await assert.rejects(informes(cliente).avance(d.id), { status: 409, message: /fecha de inicio/ });
});

test('HTTP: a download in the screen’s language; budget texts translated, the team’s notes never', async () => {
  const EN = { 'Reforma de baño': 'Bathroom renovation', 'Demolición de alicatado': 'Tile demolition', 'Demoliciones': 'Demolition', 'No incluye sanitarios.': 'Sanitary ware not included.' };
  const translator = { translate: async (texts) => texts.map((t) => ({ text: EN[t] || `[en] ${t}`, from: 'es' })) };
  const app = express(); app.use(express.json());
  app.use('/api/presupuestos', createPresupuestosRouter({ pool, origin: 'https://ledens.test', translator, ocr: null, anthropic: null, storage: {},
    authenticate: (req, _res, next) => { req.user = { ...cliente }; next(); }, findUser: async () => null }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}/api/presupuestos`;
  try {
    const r = await fetch(`${base}/${obraId}/pdf/presupuesto`, { headers: { 'x-ledens-lang': 'en' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="Quote_PRE-\d{4}-\d{3}_Reforma_de_bano\.pdf"/);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    const pdf = await read(await r.arrayBuffer());
    for (const t of ['Works budget', 'Original quote', 'Tile demolition', 'Demolition', 'Sanitary ware not included.', '€1,470.00', '€1,778.70', 'Total incl. VAT', 'Page 1 of'])
      assert.ok(pdf.text.includes(t), t);
    assert.ok(!pdf.text.includes('NOTA INTERNA'));
    const avance = await fetch(`${base}/${obraId}/pdf/avance`, { headers: { 'x-ledens-lang': 'en' } });
    assert.equal(avance.status, 200);
    assert.match(avance.headers.get('content-disposition'), /filename="Progress_PRE-/);
    const progress = await read(await avance.arrayBuffer());
    assert.ok(progress.text.includes('Works progress report') && progress.text.includes('Tile demolition') && progress.text.includes('100%'));
    // Spanish without the header; an error is JSON.
    assert.match((await fetch(`${base}/${obraId}/pdf/avance`)).headers.get('content-disposition'), /filename="Avance_PRE-/);
    const bad = await fetch(`${base}/${pendienteId}/pdf/avance`);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /obra principal/);
    assert.equal((await fetch(`${base}/00000000-0000-0000-0000-000000000000/pdf/presupuesto`)).status, 404);
  } finally { s.close(); }
});
