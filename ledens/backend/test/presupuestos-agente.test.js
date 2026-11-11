import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { agenteDraft } from '../src/presupuestos/agente.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
import { PresupuestosService } from '../src/presupuestos/service.js';
// A draft generated from the loose documentation of a client visit (notes,
// transcribed voice notes, photos, plans), matched against the same
// fictitious base de partidas as presupuestos-dimpartida.test.js. The model
// is replaced by a fake that returns a canned tool_use call, exactly the
// shape Anthropic's SDK gives back — no network, no API key, in these tests.

const BASE = [
  ['PA-026', 'CAT-005', 'Fontanería', 'Instalación de agua fría', 'Red de distribución de agua fría.', 'ml', '14', 'SI', 'Agua fría', 'agua fria, tuberia'],
  ['PA-200', 'CAT-011', 'Pintura', 'Pintura plástica lisa en paredes', 'Dos manos de pintura plástica lisa en paredes interiores.', 'm²', '8', 'SI', 'Pintura', 'pintar, pintura'],
].map(([code, cat, catName, name, def, unit, price, activa, sub, kw]) => ({ code, cat, catName, name, def, unit, price, activa, sub, kw }));

function fakeAnthropic(input) {
  return { messages: { create: async () => ({ content: [{ type: 'tool_use', name: 'registrar_borrador', input }] }) } };
}
// Same rounding agente.js applies when it takes the price straight from the base.
const net = (priceIncl) => String(Math.round((priceIncl / 1.21) * 1e6) / 1e6);

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
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql']) await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  for (const [code, name] of [...new Map(BASE.map((b) => [b.cat, b.catName]))]) await db.query('INSERT INTO ledens.work_categories(id_categoria,name) VALUES ($1,$2)', [code, name]);
  for (const b of BASE) {
    await db.query(`INSERT INTO ledens.work_items(id_partida,category_id,categoria,name,definicion_partida,unit_source,sale_price_including_vat,sale_price_excluding_vat,activa,subcategoria,palabrasclave)
      SELECT $1,id,$3,$4,$5,$6,$7,$7::numeric/1.21,$8,$9,$10 FROM ledens.work_categories WHERE id_categoria=$2`, [b.code, b.cat, b.catName, b.name, b.def, b.unit, b.price, b.activa, b.sub, b.kw]);
  }
  [admin, jefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES ('a@agente.test','Admin','admin'),('j@agente.test','Jefe','jefe'),('c@agente.test','Cliente','client') RETURNING id,email,name,role`)).rows;
});
after(() => db?.close());

test('only admin/jefe reach the agent, and it needs the database and a configured model', async () => {
  await assert.rejects(agenteDraft({ role: 'client' }, { notes: 'x' }, { db: pool, anthropic: fakeAnthropic({ resumen: '', capitulos: [] }) }), { status: 403 });
  await assert.rejects(agenteDraft({ role: 'jefe' }, { notes: 'x' }, { db: pool }), { status: 503 }, 'no ANTHROPIC_API_KEY / injected client');
  await assert.rejects(agenteDraft({ role: 'jefe' }, { notes: 'x' }, { anthropic: fakeAnthropic({}) }), { status: 503 }, 'no db means no catalog to match against');
  await assert.rejects(agenteDraft({ role: 'jefe' }, {}, { db: pool, anthropic: fakeAnthropic({}) }), { status: 400 }, 'nothing to read');
});

test('a confirmed line is matched and priced from the base; a pending one is flagged, never zero-cost silently; an excluded one is dropped', async () => {
  const draft = {
    resumen: 'Reforma de baño: cambio de pintura y nueva instalación de agua fría.',
    titulo: 'Reforma baño cliente de prueba',
    capitulos: [{
      nombre: 'Pintura',
      partidas: [
        { nombre: 'Pintura de paredes del baño', descripcion: 'Dos manos de pintura plástica.', unidad: 'm²', cantidad: 12, estado: 'confirmada', suministra: 'ledens', archivoProcedencia: 'notas.txt' },
        { nombre: 'Pintura del pasillo', descripcion: 'Comentado como posible mejora, sin medir.', unidad: 'm²', cantidad: null, estado: 'pendiente_medicion', motivoPendiente: 'Falta el largo y ancho del pasillo.' },
        { nombre: 'Cambio de bañera por plato de ducha', descripcion: 'El cliente comentó que "quizás" lo haría en el futuro.', unidad: 'ud', cantidad: null, estado: 'no_incluida', archivoProcedencia: 'transcripcion.txt' },
      ],
    }],
    pendientes: ['Confirmar el largo y ancho del pasillo para la partida de pintura.'],
    contradicciones: [], referencias: [], archivosNoLegibles: [],
  };
  const d = await agenteDraft({ role: 'jefe' }, { notes: 'visita al cliente' }, { db: pool, anthropic: fakeAnthropic(draft) });
  assert.equal(d.source, 'agente');
  assert.equal(d.title, 'Reforma baño cliente de prueba');
  assert.equal(d.chapters.length, 1);
  assert.equal(d.chapters[0].items.length, 1, 'neither the no_incluida nor the unmeasured pending line become a billable item — a line always needs quantity > 0');
  const [pintura] = d.chapters[0].items;
  assert.deepEqual([pintura.baseCode, pintura.quantity, pintura.unitPrice], ['PA-200', '12', net(8)]);
  assert.match(d.warnings.find((w) => w.includes('pasillo')), /Falta medición.*largo y ancho del pasillo/);
  assert.match(d.warnings.find((w) => w.includes('Fuera de alcance')), /bañera por plato de ducha/);
  assert.match(d.notes, /Reforma de baño/);
  assert.match(d.notes, /Pendiente: Confirmar el largo y ancho/);
  assert.equal(d.totalDocument, (12 * 8 / 1.21).toFixed(2), 'the pending line contributes nothing to the total');
});

test('nothing in the base covers a line: a proposal, never a guessed price', async () => {
  const draft = { resumen: 'x', capitulos: [{ nombre: 'Varios', partidas: [{ nombre: 'Instalación de suelo radiante', descripcion: 'En todo el piso.', unidad: 'm²', cantidad: 40, estado: 'confirmada' }] }] };
  const d = await agenteDraft({ role: 'jefe' }, { notes: 'x' }, { db: pool, anthropic: fakeAnthropic(draft) });
  const [item] = d.chapters[0].items;
  assert.equal(item.baseCode, null);
  assert.ok(item.proposal, 'queued for an admin to approve, like the PDF-import flow');
  assert.equal(item.proposal.priceInclVat, null, 'never a guessed price');
  assert.equal(item.unitPrice, '0');
});

test('the draft actually saves: presupuesto_partidas never accepts quantity 0, so a pending line must never reach it', async () => {
  const draft = {
    resumen: 'x', titulo: 'Guardable',
    capitulos: [{
      nombre: 'Pintura',
      partidas: [
        { nombre: 'Pintura de paredes del baño', descripcion: 'x', unidad: 'm²', cantidad: 12, estado: 'confirmada' },
        { nombre: 'Pintura del pasillo', descripcion: 'x', unidad: 'm²', cantidad: null, estado: 'pendiente_medicion', motivoPendiente: 'Falta medir.' },
      ],
    }],
  };
  const d = await agenteDraft({ role: 'jefe' }, { notes: 'x' }, { db: pool, anthropic: fakeAnthropic(draft) });
  const saved = await new PresupuestosService(pool, jefe).create({ ...d, clientId: cliente.id });
  assert.equal(saved.version.chapters[0].items.length, 1, 'only the line with a real quantity was saved');
});

test('through the API: a jefe generates a draft from the agent, a client cannot', async () => {
  const users = { [admin.id]: admin, [jefe.id]: jefe, [cliente.id]: cliente };
  const draft = { resumen: 'x', capitulos: [{ nombre: 'Fontanería', partidas: [{ nombre: 'Tubería de agua fría', descripcion: 'x', unidad: 'ml', cantidad: 5, estado: 'confirmada' }] }] };
  const app = express();
  app.use('/api/presupuestos', createPresupuestosRouter({
    pool, ocr: null, origin: 'https://ledens.test', anthropic: fakeAnthropic(draft),
    authenticate: (req, _res, next) => { req.user = { ...users[req.get('x-test-user')] }; next(); }, findUser: async () => null,
  }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}/api/presupuestos`;
  try {
    const post = (who, body) => fetch(base + '/agente', { method: 'POST', headers: { 'x-test-user': who.id, origin: 'https://ledens.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(cliente, { notes: 'x' })).status, 403);
    const r = await post(jefe, { notes: 'visita al cliente de prueba' });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.chapters[0].items[0].baseCode, 'PA-026');
    assert.equal((await post(jefe, {})).status, 400, 'nothing to read');
  } finally { s.close(); }
});
