import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildCatalog, matchLines, unitKey, loadCatalog } from '../src/presupuestos/catalog.js';
import { AzureTranslator } from '../src/presupuestos/translate.js';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { PropuestasService } from '../src/presupuestos/propuestas.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
// Lines of a budget PDF matched against the base de partidas (ledens.work_items),
// with annotations and proposed new partidas an admin approves. Fictitious base
// and budgets with the shape of the company's (codes PA-###, Spanish names).

const BASE = [
  ['PA-025', 'CAT-005', 'Fontanería', 'Apertura de rozas y huecos para fontanería y desagües', 'Apertura de rozas en paredes y suelos para alojar tuberías de agua y desagües, con retirada de escombros.', 'ml', '10', 'SI', 'Rozas', 'rozas, regatas, huecos'],
  ['PA-026', 'CAT-005', 'Fontanería', 'Instalación de agua fría', 'Red de distribución de agua fría desde el contador hasta cada punto de consumo, con tubería multicapa y accesorios.', 'ml', '14', 'SI', 'Agua fría', 'agua fria, tuberia, fontaneria'],
  ['PA-158', 'CAT-005', 'Fontanería', 'Suministro e instalación de tubería de agua caliente sanitaria', 'Tubería de agua caliente sanitaria con accesorios, fijaciones y aislamiento.', 'ml', '18', 'SI', 'Agua caliente', 'agua caliente, acs, tuberia'],
  ['PA-187', 'CAT-017', 'Albañilería', 'Apertura de zanja perimetral en zona sin losa junto a fachada', 'Excavación de zanja perimetral junto a la fachada en zona sin losa, hasta dejar vista la cimentación.', 'ml', '30', 'SI', 'Zanjas', 'zanja, excavacion, fachada, perimetral'],
  ['PA-189', 'CAT-017', 'Albañilería', 'Limpieza, imprimación y sellado de losa y cimentación vistas en zanja perimetral', 'Limpieza, imprimación y sellado de losa y cimentación con pasta o membrana.', 'm²', '15', 'SI', 'Impermeabilización', 'sellado, imprimacion, cimentacion, impermeabilizacion'],
  ['PA-200', 'CAT-011', 'Pintura', 'Pintura plástica lisa en paredes', 'Dos manos de pintura plástica lisa en paredes interiores.', 'm²', '8', 'NO', 'Pintura', 'pintar, pintura'],
].map(([code, cat, catName, name, def, unit, price, activa, sub, kw]) => ({ code, cat, catName, name, def, unit, price, activa, sub, kw }));
const rows = BASE.map((b) => ({ id_partida: b.code, id_categoria: b.cat, categoria: b.catName, name: b.name, definicion_partida: b.def, unit_source: b.unit, incl: b.price, excl: String(Number(b.price) / 1.21), activa: b.activa, subcategoria: b.sub, palabrasclave: b.kw }));
const catalog = () => buildCatalog(rows);
// A translator that knows the English of these tests (stands in for Azure).
const EN = {
  'Excavation of perimeter trench beside the facade. Manual excavation beside the house facade without slab.': 'Excavación de zanja perimetral junto a la fachada. Excavación manual junto a la fachada de la vivienda en zona sin losa.',
  'Waterproof membrane on balcony. Liquid waterproofing membrane on the balcony floor.': 'Membrana impermeable en balcón. Membrana líquida de impermeabilización en el suelo del balcón.',
};
const fakeTranslator = { translate: async (texts) => texts.map((t) => (EN[t] ? { text: EN[t], from: 'en' } : { text: t, from: 'es' })) };

test('units in Spanish and English compare as one', () => {
  assert.deepEqual(['ml', 'lin. m', 'm', 'm²', 'm2', 'sq m', 'ud', 'unit', 'PA', 'lump sum', 'm³', 'día', 'day'].map(unitKey), ['ml', 'ml', 'ml', 'm2', 'm2', 'm2', 'ud', 'ud', 'ud', 'ud', 'm3', 'dia', 'dia']);
});

test('matching: by the PDF code, by text, translated from English; prices from the PDF with an annotation', async () => {
  const lines = [
    { code: 'PA-026', name: 'Tubería de agua fría', description: 'Red de agua fría a baños y cocina.', unit: 'ml', unitPrice: 14 },
    { code: 'PA-187', name: 'Excavation of perimeter trench beside the facade', description: 'Manual excavation beside the house facade without slab.', unit: 'lin. m', unitPrice: 20 },
    { code: null, name: 'Tubería de agua caliente sanitaria', description: 'Con accesorios y aislamiento.', unit: 'ml', unitPrice: 18 },
    { code: 'PA-158', name: 'Pintura de paredes', description: 'Dos manos de pintura.', unit: 'm²', unitPrice: 9 },
    { code: null, name: 'Waterproof membrane on balcony', description: 'Liquid waterproofing membrane on the balcony floor.', unit: 'm²', unitPrice: 30 },
  ];
  const m = await matchLines(lines, catalog(), { translator: fakeTranslator, pricesIncludeVat: true });
  // 1. Code that fits, same price: no annotation.
  assert.equal(m[0].baseCode, 'PA-026');
  assert.deepEqual(m[0].annotations, []);
  // 2. English, translated; code fits; price differs → PDF price kept, annotated.
  assert.equal(m[1].baseCode, 'PA-187');
  assert.match(m[1].translation, /zanja perimetral/);
  assert.match(m[1].annotations.find((a) => a.type === 'precio').text, /PDF 20,00 € y de la base 30,00 € \(−10,00 €, −33,3 %\).*Se usa el del PDF/);
  // 3. No code: matched by text.
  assert.equal(m[2].baseCode, 'PA-158');
  assert.match(m[2].annotations[0].text, /Casada por texto con PA-158/);
  // 4. The PDF code is another partida with another unit: not forced; nothing else fits (PA-200 is inactive).
  assert.equal(m[3].baseCode, null);
  assert.match(m[3].annotations.find((a) => a.type === 'codigo').text, /PA-158.*unidad ml, distinta/);
  assert.ok(m[3].proposal);
  // 5. Nothing covers it: a proposed new partida with the nearest one discarded, translated.
  assert.equal(m[4].baseCode, null);
  assert.deepEqual([m[4].proposal.unit, m[4].proposal.priceInclVat], ['m²', 30]);
  assert.match(m[4].proposal.name, /Membrana impermeable en balcón/);
  assert.equal(m[4].proposal.nearestCode, 'PA-189');
  assert.equal(m[4].proposal.categoryCode, 'CAT-017');
  assert.match(m[4].annotations.find((a) => a.type === 'nueva').text, /más próxima es PA-189.*pendiente de que la apruebe un administrador/);
});

test('without a translator: an English line is matched by its code and says the text was not checked', async () => {
  const [m] = await matchLines([{ code: 'PA-187', name: 'Excavation of perimeter trench beside the facade', description: 'Manual excavation beside the house facade without slab.', unit: 'lin. m', unitPrice: 30 }], catalog(), { pricesIncludeVat: true });
  assert.equal(m.baseCode, 'PA-187');
  assert.deepEqual(m.annotations.map((a) => a.type), ['traduccion', 'codigo']);
  assert.match(m.annotations[1].text, /sin poder comprobar el texto/);
  // No code and untranslated: no partida is cited as the nearest one, and no category is borrowed.
  const [x] = await matchLines([{ code: null, name: 'Waterproof membrane on balcony', description: 'Liquid membrane on the balcony floor with the primer.', unit: 'm²', unitPrice: 30 }], catalog(), { pricesIncludeVat: true });
  assert.deepEqual([x.baseCode, x.proposal.nearestCode, x.proposal.categoryCode], [null, null, null]);
  assert.match(x.annotations.find((a) => a.type === 'nueva').text, /Ninguna partida de la base se parece a esta línea \(sin traducir/);
});

test('the Azure translator: one request, Spanish detected lines kept', async () => {
  let call;
  const t = new AzureTranslator({ key: 'k', region: 'westeurope', endpoint: 'https://example.test', fetcher: async (url, opts) => {
    call = { url, opts };
    return { ok: true, json: async () => JSON.parse(opts.body).map((x) => ({ detectedLanguage: { language: /trench/.test(x.Text) ? 'en' : 'es' }, translations: [{ text: /trench/.test(x.Text) ? 'zanja' : x.Text, to: 'es' }] })) };
  } });
  const out = await t.translate(['trench', 'zanja ya en español', '']);
  assert.match(call.url, /^https:\/\/example\.test\/translate\?api-version=3\.0&to=es$/);
  assert.equal(call.opts.headers['Ocp-Apim-Subscription-Region'], 'westeurope');
  assert.deepEqual(out, [{ text: 'zanja', from: 'en' }, { text: 'zanja ya en español', from: 'es' }, { text: '', from: 'es' }]);
  const failing = new AzureTranslator({ key: 'k', fetcher: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(failing.translate(['x']), /traductor 401/);
});

// ---- With a database: the draft, saving the presupuesto and the admin tray ----
let db, pool, admin, jefe, cliente;
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL, email_verified boolean NOT NULL DEFAULT true, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz DEFAULT now());
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text, target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.work_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text, raw_id uuid, id_categoria text, name text);
    CREATE TABLE ledens.work_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text, raw_id uuid, id_partida text, category_id uuid REFERENCES ledens.work_categories(id), categoria text, name text,
      definicion_partida text, unit_source text, sale_price_including_vat numeric, sale_price_excluding_vat numeric, incluye_materiales text, activa text, subcategoria text, palabrasclave text,
      observacionesagente text, rendimientovalidado text, observacionesplanificacion text, unit_id uuid);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql']) await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  for (const [code, name] of [...new Map(BASE.map((b) => [b.cat, b.catName]))]) await db.query('INSERT INTO ledens.work_categories(id_categoria,name) VALUES ($1,$2)', [code, name]);
  const unitM2 = '11111111-1111-4111-8111-111111111111';
  for (const b of BASE) {
    await db.query(`INSERT INTO ledens.work_items(id_partida,category_id,categoria,name,definicion_partida,unit_source,sale_price_including_vat,sale_price_excluding_vat,activa,subcategoria,palabrasclave,unit_id)
      SELECT $1,id,$3,$4,$5,$6,$7,$7::numeric/1.21,$8,$9,$10,$11 FROM ledens.work_categories WHERE id_categoria=$2`, [b.code, b.cat, b.catName, b.name, b.def, b.unit, b.price, b.activa, b.sub, b.kw, b.unit === 'm²' ? unitM2 : null]);
  }
  [admin, jefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES ('a@dim.test','Admin Dim','admin'),('j@dim.test','Jefe Dim','jefe'),('c@dim.test','Cliente Dim','client') RETURNING id,email,name,role`)).rows;
});
after(() => db?.close());

test('the base is read from ledens.work_items with its categories', async () => {
  const c = await loadCatalog(pool);
  assert.equal(c.items.length, 6);
  const pa187 = c.byCode.get('PA-187');
  assert.deepEqual([pa187.unitKey, pa187.priceIncl, pa187.active, pa187.category], ['ml', 30, true, 'CAT-017']);
  assert.equal(c.byCode.get('PA-200').active, false);
});

async function englishPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([842, 595]);
  const t = (s, x, y) => page.drawText(s, { x, y, size: 8, font });
  t('Unit price incl.', 620, 512); [['Code', 30], ['Unit', 90], ['Item', 140], ['Description', 320], ['Quantity', 560], ['Amount incl. VAT', 720]].forEach(([s, x]) => t(s, x, 500)); t('VAT', 620, 490);
  t('PA-187', 30, 470); t('lin. m', 90, 470); t('Excavation of perimeter trench beside the facade', 140, 470); t('Manual excavation beside the house facade without slab.', 320, 470); t('30,00', 560, 470); t('20,00 €', 620, 470); t('600,00 €', 720, 470);
  t('WP-1', 30, 430); t('m²', 90, 430); t('Waterproof membrane on balcony', 140, 430); t('Liquid waterproofing membrane on the balcony floor.', 320, 430); t('12,00', 560, 430); t('30,00 €', 620, 430); t('360,00 €', 720, 430);
  return Buffer.from(await doc.save());
}

test('PDF draft → saved presupuesto: base codes and annotations for the team only, one proposal per uncovered line', async () => {
  const users = Object.fromEntries([admin, jefe, cliente].map((u) => [u.id, u]));
  const app = express();
  app.use('/api/presupuestos', createPresupuestosRouter({ pool, ocr: null, translator: fakeTranslator, origin: 'https://ledens.test',
    authenticate: (req, _res, next) => { req.user = { ...users[req.get('x-test-user')] }; next(); }, findUser: async () => null }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  let draft;
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/presupuestos/pdf`, { method: 'POST', headers: { 'x-test-user': jefe.id, origin: 'https://ledens.test', 'content-type': 'application/pdf' }, body: await englishPdf() });
    assert.equal(r.status, 200);
    draft = await r.json();
  } finally { s.close(); }
  const [trench, membrane] = draft.chapters[0].items;
  assert.equal(trench.baseCode, 'PA-187');
  assert.ok(trench.annotations.some((a) => a.type === 'precio'));
  assert.equal(trench.name, 'Excavation of perimeter trench beside the facade', 'the client keeps the PDF text');
  assert.equal(membrane.baseCode, null);
  assert.equal(membrane.proposal.nearestCode, 'PA-189');

  const svc = new PresupuestosService(pool, jefe);
  let p = await svc.create({ ...draft, title: 'Impermeabilización', clientId: cliente.id, sourceFile: 'waterproofing.pdf' });
  const items = p.version.chapters[0].items;
  assert.equal(items[0].baseCode, 'PA-187');
  assert.ok(items[0].annotations.some((a) => /Se usa el del PDF/.test(a.text)));
  assert.equal(items[1].proposal.status, 'pending');
  const prop = (await db.query('SELECT * FROM partida_propuestas')).rows;
  assert.equal(prop.length, 1);
  assert.match(prop[0].origin, /a partir de «waterproofing\.pdf» para la obra PRE-\d{4}-\d{3} «Impermeabilización»\. Partida más próxima descartada: PA-189\./);
  assert.match(prop[0].price_source, /Precio de venta del presupuesto PRE-.*presentado al cliente/);
  assert.equal(Number(prop[0].price_incl_vat), 30);
  // Saving the draft again replaces, does not duplicate, its pending proposal.
  p = await svc.saveDraft(p.id, { ...draft, title: 'Impermeabilización', chapters: p.version.chapters.map((c) => ({ name: c.name, items: c.items })) });
  assert.equal((await db.query("SELECT count(*)::int n FROM partida_propuestas WHERE status='pending'")).rows[0].n, 1);
  p = await svc.send(p.id);
  const seen = await new PresupuestosService(pool, cliente).get(p.id);
  assert.equal(seen.version.chapters[0].items[0].baseCode, undefined, 'the client never sees the base or the annotations');
  assert.equal(seen.version.chapters[0].items[0].annotations, undefined);
});

test('admin tray: approving appends PA-### at the end of the base (never touching others); a new category gets CAT-###; rejecting is noted', async () => {
  const before = (await db.query('SELECT id_partida, name, sale_price_including_vat::text FROM ledens.work_items ORDER BY id_partida')).rows;
  await assert.rejects(new PropuestasService(pool, jefe).list(), { status: 403 });
  const tray = new PropuestasService(pool, admin);
  const { propuestas, categories } = await tray.list();
  assert.equal(propuestas.length, 1);
  assert.ok(categories.some((c) => c.code === 'CAT-017'));
  const [prop] = propuestas;
  assert.equal(prop.line.name, 'Waterproof membrane on balcony');

  const r = await tray.approve(prop.id, { newCategoryName: 'Impermeabilización', incluyeMateriales: 'SI', palabrasClave: 'membrana, balcon, impermeabilizacion' });
  assert.deepEqual(r, { code: 'PA-201', category: 'CAT-018', active: true });
  const wi = (await db.query("SELECT w.*, c.id_categoria FROM ledens.work_items w JOIN ledens.work_categories c ON c.id=w.category_id WHERE id_partida='PA-201'")).rows[0];
  assert.deepEqual([wi.name, wi.unit_source, Number(wi.sale_price_including_vat), Math.round(Number(wi.sale_price_excluding_vat) * 100) / 100, wi.activa, wi.incluye_materiales, wi.rendimientovalidado, wi.id_categoria],
    ['Membrana impermeable en balcón', 'm²', 30, 24.79, 'SI', 'SI', 'NO', 'CAT-018']);
  assert.equal(wi.unit_id, '11111111-1111-4111-8111-111111111111', 'unit taken from the base');
  assert.match(wi.observacionesagente, /Partida propuesta el .* Partida más próxima descartada: PA-189\..*PENDIENTE DE VALIDACIÓN COMO PRECIO ESTÁNDAR/);
  assert.deepEqual((await db.query("SELECT id_partida, name, sale_price_including_vat::text FROM ledens.work_items WHERE id_partida <> 'PA-201' ORDER BY id_partida")).rows, before, 'existing partidas unchanged');
  const line = (await db.query('SELECT base_code, annotations FROM presupuesto_partidas WHERE id=(SELECT partida_id FROM partida_propuestas WHERE id=$1)', [prop.id])).rows[0];
  assert.equal(line.base_code, 'PA-201');
  assert.match(line.annotations.at(-1).text, /Partida creada en la base como PA-201 \(activa\)/);
  await assert.rejects(tray.approve(prop.id), { status: 409 });

  // Another one, approved without price: inactive, pending valuation, existing category.
  const svc = new PresupuestosService(pool, jefe);
  const p2 = await svc.create({ title: 'Otra', clientId: cliente.id, chapters: [{ name: 'C', items: [
    { name: 'Partida rara', unit: 'ud', quantity: '1', unitPrice: '0', proposal: { name: 'Partida rara', unit: 'ud', priceInclVat: null, categoryCode: 'CAT-017', nearestCode: 'PA-187' } },
    { name: 'Otra rara', unit: 'ud', quantity: '1', unitPrice: '0', proposal: { name: 'Otra rara', unit: 'ud', categoryCode: 'CAT-017' } }] }] });
  const [x, y] = (await tray.list()).propuestas.sort((a, b) => a.name.localeCompare(b.name));
  assert.equal((await tray.approve(y.id, { priceInclVat: '' })).active, false);
  const inactive = (await db.query("SELECT activa, sale_price_including_vat, observacionesagente FROM ledens.work_items WHERE id_partida='PA-202'")).rows[0];
  assert.deepEqual([inactive.activa, inactive.sale_price_including_vat], ['NO', null]);
  assert.match(inactive.observacionesagente, /PRECIO PENDIENTE DE VALORACIÓN/);
  await assert.rejects(tray.reject(x.id, {}), { status: 400 });
  await tray.reject(x.id, { note: 'Ya existe como PA-187 adaptada' });
  const notes = (await new PresupuestosService(pool, jefe).get(p2.id)).version.chapters[0].items.map((i) => i.annotations.map((a) => a.text).join(' '));
  assert.match(notes.join(' | '), /Partida propuesta rechazada: Ya existe como PA-187 adaptada/);
  assert.deepEqual((await db.query("SELECT action FROM audit_log WHERE action LIKE 'Partida%' ORDER BY id")).rows.map((r) => r.action), ['Partida creada en la base', 'Partida creada en la base', 'Partida propuesta rechazada']);
});
