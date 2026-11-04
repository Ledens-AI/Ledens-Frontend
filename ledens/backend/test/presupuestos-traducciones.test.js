import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
// A presupuesto read by a client in English: chapter names, line names and
// descriptions and the notes come translated (X-Ledens-Lang: en), each text
// sent to the translator only once; the Spanish is never replaced.
let db, pool, admin, cliente, presupuestoId;
const EN = {
  'Fontanería y saneamiento': 'Plumbing and sanitation',
  'Tubería de agua fría': 'Cold water pipe',
  'Red de distribución desde el contador hasta cada punto de consumo.': 'Distribution network from the meter to each point of use.',
  'No incluye la red de desagües.': 'Does not include the drainage network.',
};
const calls = [];
const translator = { translate: async (texts, { to } = {}) => { calls.push({ texts, to }); return texts.map((t) => ({ text: EN[t] || `[en] ${t}`, from: 'es' })); } };

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT true, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz DEFAULT now());
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '032_traducciones_presupuesto.sql', '033_presupuestos_proyecto.sql']) {
    await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  }
  [admin, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES ('admin@tr.test','Admin','admin'),('cliente@tr.test','Client','client') RETURNING id,email,name,role`)).rows;
  const svc = new PresupuestosService(pool, admin);
  const d = await svc.create({ title: 'Fontanería', vatRate: '21', clientId: cliente.id, notes: 'No incluye la red de desagües.',
    chapters: [{ name: 'Fontanería y saneamiento', items: [
      { code: 'PA-026', name: 'Tubería de agua fría', description: 'Red de distribución desde el contador hasta cada punto de consumo.', unit: 'ml', quantity: '55', unitPrice: '12' },
      { code: 'PA-027', name: 'Tubería de agua fría', unit: 'ml', quantity: '5', unitPrice: '12' }] }] });
  await svc.send(d.id);
  presupuestoId = d.id;
});
after(() => db?.close());

async function withRouter(opts, fn) {
  const users = { [admin.id]: admin, [cliente.id]: cliente };
  const app = express(); app.use(express.json());
  app.use('/api/presupuestos', createPresupuestosRouter({ pool, origin: 'https://ledens.test', ...opts,
    authenticate: (req, _res, next) => { req.user = { ...users[req.get('x-test-user')] }; next(); }, findUser: async () => null }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const call = (path, who, lang, { method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${s.address().port}/api/presupuestos${path}`, { method,
    headers: { 'content-type': 'application/json', origin: 'https://ledens.test', 'x-test-user': who.id, ...(lang ? { 'x-ledens-lang': lang } : {}) },
    body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try { await fn(call); } finally { s.close(); }
}

test('in English: chapters, lines, descriptions and notes translated once, the Spanish kept', async () => {
  await withRouter({ translator }, async (call) => {
    const r = await call(`/${presupuestoId}`, cliente, 'en');
    assert.equal(r.status, 200);
    const v = r.body.version;
    const [line, other] = v.chapters[0].items;
    assert.deepEqual([v.chapters[0].nameEn, line.nameEn, line.descriptionEn, v.notesEn],
      ['Plumbing and sanitation', 'Cold water pipe', 'Distribution network from the meter to each point of use.', 'Does not include the drainage network.']);
    assert.equal(line.name, 'Tubería de agua fría', 'the Spanish stays for the team’s editor');
    assert.equal(other.nameEn, 'Cold water pipe');
    assert.equal(other.descriptionEn, undefined, 'no description, nothing to translate');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, 'en');
    assert.equal(calls[0].texts.length, 4, 'a repeated text is sent once');

    const again = await call(`/${presupuestoId}`, cliente, 'en');
    assert.equal(again.body.version.chapters[0].items[0].descriptionEn, 'Distribution network from the meter to each point of use.');
    assert.equal(calls.length, 1, 'the second time comes from presupuesto_traducciones');
    assert.deepEqual(again.body.translation, { lang: 'en', complete: true });

    // An action answers with the presupuesto too, also in English.
    const c = await call(`/${presupuestoId}/comentarios`, cliente, 'en', { method: 'POST', body: { body: 'Thanks' } });
    assert.equal(c.status, 200);
    assert.equal(c.body.version.chapters[0].nameEn, 'Plumbing and sanitation');

    const es = await call(`/${presupuestoId}`, cliente, null);
    assert.equal(es.body.version.chapters[0].items[0].nameEn, undefined, 'in Spanish nothing is added');
    assert.equal(es.body.translation, undefined);
    assert.equal(calls.length, 1);
  });
});

test('a failing or missing translator shows the Spanish, never an error', async () => {
  await db.query('DELETE FROM presupuesto_traducciones');
  const failing = { translate: async () => { throw new Error('traductor 401'); } };
  const errors = console.error; console.error = () => {};
  try {
    await withRouter({ translator: failing }, async (call) => {
      const r = await call(`/${presupuestoId}`, cliente, 'en');
      assert.equal(r.status, 200);
      assert.equal(r.body.version.chapters[0].items[0].nameEn, undefined);
      assert.equal(r.body.version.chapters[0].items[0].name, 'Tubería de agua fría');
      assert.deepEqual(r.body.translation, { lang: 'en', complete: false }, 'the client is not told why');
      const team = await call(`/${presupuestoId}`, admin, 'en');
      assert.equal(team.body.translation.complete, false);
      assert.match(team.body.translation.error, /traductor: traductor 401/, 'the team sees why');
    });
  } finally { console.error = errors; }
  await withRouter({ translator: null }, async (call) => {
    const r = await call(`/${presupuestoId}`, cliente, 'en');
    assert.equal(r.status, 200);
    assert.equal(r.body.version.chapters[0].nameEn, undefined);
    assert.match((await call(`/${presupuestoId}`, admin, 'en')).body.translation.error, /no configurado/);
  });
});

test('the obra: progress notes are translated too', async () => {
  await db.query('DELETE FROM presupuesto_traducciones');
  const svc = new PresupuestosService(pool, admin);
  const sent = await new PresupuestosService(pool, cliente).get(presupuestoId);
  await new PresupuestosService(pool, cliente).approve(presupuestoId, { versionId: sent.version.id, selected: [] });
  await svc.schedule(presupuestoId, { startDate: '2026-11-02' });
  const d = await svc.get(presupuestoId);
  const lineId = d.obra.chapters[0].items[0].id;
  await svc.declare(presupuestoId, { items: [{ partidaId: lineId, executed: '10', note: 'Corregido según el parte de obra' }] });
  await withRouter({ translator }, async (call) => {
    const r = await call(`/${presupuestoId}`, cliente, 'en');
    const item = r.body.obra.chapters[0].items[0];
    assert.equal(item.lastDeclared.noteEn, '[en] Corregido según el parte de obra');
    assert.equal(r.body.obra.chapters[0].nameEn, 'Plumbing and sanitation');
  });
});
