import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { createPresupuestosRouter } from '../src/routes/presupuestos.js';
import { importApproved } from '../src/presupuestos/import.js';
// Presupuestos para clientes on PGlite: the users/audit_log columns this flow
// reads plus migration 020. Synthetic data with the structure of a real
// fontanería budget (chapters, coded lines, units, quantities, net prices, VAT).
let db, pool, admin, jefe, otroJefe, cliente, otroCliente, obraId;
const as = (u) => new PresupuestosService(pool, u);

const fontaneria = (caliente = '50') => ({
  title: 'Fontanería interior: agua fría y caliente', address: 'C/ Ficticia 1, Marbella', vatRate: '21',
  notes: 'No incluye la red de desagües.',
  chapters: [
    { name: 'Fontanería y saneamiento', items: [
      { code: 'PA-026', name: 'Tubería de agua fría', unit: 'ml', quantity: '55', unitPrice: '12' },
      { code: 'PA-158', name: 'Tubería de agua caliente sanitaria', unit: 'ml', quantity: caliente, unitPrice: '15' }] },
    { name: 'Partidas condicionadas', items: [
      { code: 'PA-025', name: 'Apertura de rozas con posterior tapado', unit: 'ml', quantity: '85', unitPrice: '8', kind: 'condicionada' }] },
    { name: 'Opciones', items: [
      { code: 'OP-01', name: 'Termo eléctrico 80 l', unit: 'ud', quantity: '1', unitPrice: '450', kind: 'opcion' }] },
  ],
});
const items = (d) => d.version.chapters.flatMap((c) => c.items);
const obraItemById = (d, id) => d.obra.chapters.flatMap((c) => c.items).find((i) => i.id === id);
const obraItem = (d, code) => d.obra.chapters.flatMap((c) => c.items).find((i) => i.code === code);

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql']) await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  [admin, jefe, otroJefe, cliente, otroCliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@pre.test','Admin Test','admin'),('jefe@pre.test','Jefe Test','jefe'),('jefe2@pre.test','Otro Jefe','jefe'),
    ('cliente@pre.test','Cliente Test','client'),('cliente2@pre.test','Otro Cliente','client') RETURNING id,email,name,role`)).rows;
});
after(() => db?.close());

test('the team creates, for a client; drafts are invisible to the client and to other jefes', async () => {
  await assert.rejects(as(cliente).create({ ...fontaneria(), clientId: cliente.id }), { status: 403 }, 'a client never creates');
  await assert.rejects(as(admin).create({ ...fontaneria(), clientId: jefe.id }), { status: 400, message: /cliente/ });
  await assert.rejects(as(admin).create({ ...fontaneria(), clientId: cliente.id, jefeId: cliente.id }), { status: 400, message: /jefe/ });
  await assert.rejects(as(admin).create({ ...fontaneria('-3'), clientId: cliente.id }), { status: 400, message: /Cantidad/ });
  const d = await as(admin).create({ ...fontaneria(), clientId: cliente.id, jefeId: jefe.id });
  obraId = d.id;
  assert.match(d.ref, /^PRE-\d{4}-\d{3}$/);
  assert.equal(d.phase, 'borrador');
  // 55×12 + 50×15 + 85×8 = 2090 net; the unselected option stays apart.
  assert.deepEqual([d.version.base, d.version.vat, d.version.total, d.version.optionalBase], ['2090.00', '438.90', '2528.90', '450.00']);
  assert.deepEqual(d.version.chapters.map((c) => c.base), ['1410.00', '680.00', '0.00']);
  assert.equal((await as(cliente).list()).length, 0);
  await assert.rejects(as(cliente).get(d.id), { status: 404 });
  await assert.rejects(as(otroJefe).get(d.id), { status: 404 });
  assert.equal((await as(jefe).list()).length, 1);
  await assert.rejects(as(otroJefe).send(d.id), { status: 404 });
});

test('sent → the client asks for changes → a new version supersedes it → the client approves with an option', async () => {
  let d = await as(jefe).send(obraId);
  assert.equal(d.phase, 'pendiente');
  const v1 = (await as(cliente).get(obraId)).version;
  assert.equal(v1.number, 1);
  await assert.rejects(as(otroCliente).approve(obraId, { versionId: v1.id }), { status: 404 });
  await assert.rejects(as(jefe).approve(obraId, { versionId: v1.id }), { status: 403 });
  await assert.rejects(as(cliente).requestChanges(obraId, { versionId: v1.id, body: '  ' }), { status: 400 });
  d = await as(cliente).requestChanges(obraId, { versionId: v1.id, body: 'El agua caliente son 40 metros, no 50.' });
  assert.equal(d.phase, 'cambios');
  assert.equal(d.comments.at(-1).kind, 'cambios');
  await assert.rejects(as(cliente).approve(obraId, { versionId: v1.id }), { status: 409 });

  d = await as(jefe).saveDraft(obraId, fontaneria('40'));
  assert.equal(d.version.number, 2);
  assert.equal(d.version.status, 'draft');
  assert.equal((await as(cliente).get(obraId)).version.number, 1, 'the client keeps seeing v1 while v2 is a draft');
  d = await as(admin).send(obraId);
  assert.deepEqual(d.versions.map((v) => [v.number, v.status]), [[2, 'sent'], [1, 'superseded']]);

  const c = await as(cliente).get(obraId);
  assert.equal(c.can.decide, true);
  await assert.rejects(as(cliente).approve(obraId, { versionId: v1.id }), { status: 409 }, 'an old version cannot be approved');
  const caliente = items(c).find((i) => i.code === 'PA-158');
  await assert.rejects(as(cliente).approve(obraId, { versionId: c.version.id, selected: [caliente.id] }), { status: 400 }, 'only optional lines are selectable');
  const termo = items(c).find((i) => i.code === 'OP-01');
  d = await as(cliente).approve(obraId, { versionId: c.version.id, selected: [termo.id] });
  assert.equal(d.phase, 'aprobado');
  assert.deepEqual([d.version.base, d.version.total], ['2390.00', '2891.90']);
  assert.equal(d.obra.base, '2390.00');
  assert.equal(d.can.decide, false);
  assert.deepEqual((await db.query("SELECT action FROM audit_log ORDER BY id")).rows.map((r) => r.action),
    ['Presupuesto enviado', 'Cambios solicitados en presupuesto', 'Presupuesto enviado', 'Presupuesto aprobado']);
  await assert.rejects(as(jefe).saveDraft(obraId, fontaneria()), { status: 409 }, 'an approved budget is closed');
});

test('a start date turns it into an obra en curso; only the team sets it', async () => {
  await assert.rejects(as(admin).declare(obraId, { items: [] }), { status: 400 });
  const any = obraItem(await as(jefe).get(obraId), 'PA-026');
  await assert.rejects(as(jefe).declare(obraId, { items: [{ partidaId: any.id, executed: '1' }] }), { status: 409, message: /fecha de inicio/ });
  await assert.rejects(as(cliente).schedule(obraId, { startDate: '2026-11-02' }), { status: 403 });
  await assert.rejects(as(jefe).schedule(obraId, { startDate: '2026-11-02', endDate: '2026-11-01' }), { status: 400 });
  const d = await as(jefe).schedule(obraId, { startDate: '2026-11-02', endDate: '2026-11-20' });
  assert.equal(d.phase, 'en_curso');
  assert.deepEqual([d.startDate, d.endDate], ['2026-11-02', '2026-11-20']);
  assert.equal((await as(cliente).list())[0].phase, 'en_curso');
});

test('production: executed × unit price, by chapter and in total; excess shows as consumed, not executed', async () => {
  const d0 = await as(jefe).get(obraId);
  const id = (code) => obraItem(d0, code).id;
  await assert.rejects(as(cliente).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '1' }] }), { status: 403 });
  await assert.rejects(as(otroJefe).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '1' }] }), { status: 404 });
  await assert.rejects(as(jefe).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '-1' }] }), { status: 400 });
  await assert.rejects(as(jefe).declare(obraId, { items: [{ partidaId: id('PA-026'), executed: '551' }] }), { status: 400 });
  const d = await as(jefe).declare(obraId, { items: [
    { partidaId: id('PA-026'), executed: '55' }, { partidaId: id('PA-158'), executed: '20' },
    { partidaId: id('PA-025'), executed: '100', note: 'Recorrido más largo de lo previsto' }, { partidaId: id('OP-01'), executed: '0' }] });
  // executed (capped): 660 + 300 + 680 = 1640; consumed: 660 + 300 + 800 = 1760; of 2390.
  assert.deepEqual([d.obra.executedAmount, d.obra.consumed, d.obra.executionPct, d.obra.consumedPct], ['1640.00', '1760.00', 68.6, 73.6]);
  const [fonta, cond, opc] = d.obra.chapters;
  assert.deepEqual([fonta.base, fonta.consumed, fonta.consumedPct], ['1260.00', '960.00', 76.2]);
  assert.deepEqual([cond.executedAmount, cond.consumed, cond.executionPct, cond.consumedPct], ['680.00', '800.00', 100, 117.6]);
  assert.equal(opc.consumedPct, 0);
  const rozas = obraItem(d, 'PA-025');
  assert.equal(rozas.excess, true);
  assert.equal(rozas.lastDeclared.note, 'Recorrido más largo de lo previsto');
  assert.equal(obraItem(d, 'PA-158').executionPct, 50);
  const seen = (await as(cliente).get(obraId)).obra;
  assert.deepEqual([seen.executionPct, seen.consumedPct], [68.6, 73.6], 'the client sees it at once');
  assert.equal((await db.query('SELECT count(*)::int n FROM presupuesto_produccion')).rows[0].n, 3, 'unchanged lines are not recorded');
});

test('an ampliación is approved separately and then adds to the obra', async () => {
  await assert.rejects(as(otroJefe).create({ parentId: obraId, title: 'Ampliación', chapters: [] }), { status: 404 });
  let a = await as(jefe).create({ parentId: obraId, title: 'Ampliación: llave de corte en cocina', chapters: [
    { name: 'Fontanería y saneamiento', items: [{ code: 'PA-200', name: 'Llave de corte empotrada', unit: 'ud', quantity: '2', unitPrice: '100' }] }] });
  assert.equal(a.parent.id, obraId);
  assert.equal(a.client.id, cliente.id);
  a = await as(jefe).send(a.id);
  assert.equal((await as(admin).get(obraId)).obra.base, '2390.00', 'not counted before approval');
  const list = await as(cliente).list();
  assert.equal(list.find((p) => p.id === a.id).phase, 'pendiente');
  await as(cliente).approve(a.id, { versionId: a.version.id });
  const d = await as(cliente).get(obraId);
  assert.equal(d.obra.base, '2590.00');
  assert.equal(d.ampliaciones.length, 1);
  assert.equal(d.obra.chapters.at(-1).presupuesto.ampliacion, true);
  const llave = obraItem(d, 'PA-200');
  await assert.rejects(as(jefe).declare(a.id, { items: [{ partidaId: llave.id, executed: '1' }] }), { status: 400, message: /obra principal/ });
  const after = await as(jefe).declare(obraId, { items: [{ partidaId: llave.id, executed: '1' }] });
  assert.equal(after.obra.consumed, '1860.00');
});

test('a rejected budget is final', async () => {
  let d = await as(admin).create({ ...fontaneria(), title: 'Baño', clientId: otroCliente.id });
  d = await as(admin).send(d.id);
  await assert.rejects(as(cliente).reject(d.id, { versionId: d.version.id }), { status: 404 });
  const r = await as(otroCliente).reject(d.id, { versionId: d.version.id, body: 'Me quedo con otra oferta.' });
  assert.equal(r.phase, 'rechazado');
  await assert.rejects(as(admin).saveDraft(d.id, fontaneria()), { status: 409 });
  await assert.rejects(as(admin).schedule(d.id, { startDate: '2026-11-02' }), { status: 409 });
});

test('HTTP: every role through the router, «ver como» read-only, origin checked', async () => {
  const users = Object.fromEntries([admin, jefe, cliente].map((u) => [u.id, u]));
  const app = express(); app.use(express.json());
  app.use('/api/presupuestos', createPresupuestosRouter({ pool, origin: 'https://ledens.test',
    authenticate: (req, res, next) => { const u = users[req.get('x-test-user')]; if (!u) return res.status(401).end(); req.user = { ...u }; next(); },
    findUser: async (id) => (await db.query('SELECT id,email,name,role FROM users WHERE id=$1', [id])).rows[0] || null }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}/api/presupuestos`;
  const call = (path, who, { method = 'GET', body, as: viewing, origin = 'https://ledens.test' } = {}) => fetch(base + path, { method,
    headers: { 'content-type': 'application/json', origin, ...(who ? { 'x-test-user': who.id } : {}), ...(viewing ? { 'x-ledens-view-as': viewing.id } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await call('/', null)).status, 401);
    const mine = await (await call('/', cliente)).json();
    assert.deepEqual(mine.presupuestos.map((p) => p.phase).sort(), ['aprobado', 'en_curso']);
    const viewed = await (await call('/', admin, { as: cliente })).json();
    assert.deepEqual(viewed.presupuestos.map((p) => p.id).sort(), mine.presupuestos.map((p) => p.id).sort(), 'admin sees exactly what the client sees');
    assert.equal((await call(`/${obraId}/comentarios`, admin, { method: 'POST', as: cliente, body: { body: 'hola' } })).status, 403, 'read-only');
    assert.equal((await call('/opciones', cliente)).status, 403);
    const opts = await (await call('/opciones', admin)).json();
    assert.deepEqual(opts.clients.map((c) => c.email).sort(), ['cliente2@pre.test', 'cliente@pre.test']);
    assert.equal((await call(`/${obraId}/comentarios`, cliente, { method: 'POST', body: { body: 'Gracias' }, origin: 'https://evil.test' })).status, 403);
    const res = await call(`/${obraId}/comentarios`, cliente, { method: 'POST', body: { body: '¿Cuándo empezáis?' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).comments.at(-1).team, false);
    assert.equal((await call('/no-es-un-id', jefe)).status, 404);
  } finally { s.close(); }
});

test('import: an approved spreadsheet budget with VAT-inclusive prices becomes an obra en curso with its progress', async () => {
  const data = { clientEmail: 'CLIENTE2@pre.test', jefeEmail: 'admin@pre.test', title: 'Reforma importada', address: 'C/ Ficticia 9', vatRate: 21,
    pricesIncludeVat: true, offeredOn: '2026-09-01', startDate: '2026-09-01', source: 'hoja de prueba',
    chapters: [{ name: 'Demoliciones', items: [
      { code: '1.1', unit: 'ud', name: 'Demolición de chimenea', quantity: 2, unitPrice: 200, progress: 1, progressNote: 'Salón 1 y 2' },
      { code: '1.9', unit: 'ud', name: 'Demolición de losa', quantity: 5, unitPrice: 250, progress: 0.8 },
      { code: '2.14', unit: 'm2', name: 'Demolición de losa de piso', quantity: 100.03, unitPrice: 65, progress: 0.18 },
      { code: '2.16', unit: 'ud', name: 'Reconocimiento de drenajes', quantity: 1, unitPrice: 380 }] }] };
  await assert.rejects(importApproved(pool, { ...data, clientEmail: 'nadie@pre.test' }), { status: 400, message: /No existe/ });
  await assert.rejects(importApproved(pool, { ...data, jefeEmail: 'cliente@pre.test' }), { status: 400, message: /jefe/ });
  const r = await importApproved(pool, data);
  assert.deepEqual([r.lines, r.declared], [4, 3]);
  await assert.rejects(importApproved(pool, data), { status: 409 }, 'never imported twice');
  const d = await as(otroCliente).get(r.id);
  assert.equal(d.phase, 'en_curso');
  assert.equal(d.jefe.name, 'Admin Test');
  // 400 + 1250 + 6501,95 + 380 = 8531,95 with VAT; net prices at 4 decimals add back up to it.
  assert.deepEqual([d.version.base, d.version.total], ['7051.20', '8531.95']);
  assert.equal(d.obra.chapters[0].items[0].unitPrice, '165.289256');
  // Executed: 400 + 1000 + 1170,35 with VAT → 2570,35 of 8531,95 = 30,1 %.
  assert.equal(d.obra.consumedPct, 30.1);
  assert.equal(d.obra.chapters[0].items[2].executed, '18.0054');
  assert.equal(d.obra.chapters[0].items[0].lastDeclared.by, null);
  assert.equal(d.obra.chapters[0].items[0].lastDeclared.note, 'Avance importado de hoja de prueba · Salón 1 y 2');
  assert.match((await db.query("SELECT detail FROM audit_log WHERE action='Presupuesto importado'")).rows[0].detail, /4 partidas, 3 con avance · hoja de prueba/);
  assert.equal((await as(admin).get(r.id)).can.declare, true);
});

test('references keep every digit past 999', async () => {
  await db.query("SELECT setval('presupuesto_ref_seq', 998)");
  const refs = [];
  for (let n = 0; n < 2; n++) refs.push((await as(admin).create({ title: 'Ref ' + n, clientId: cliente.id })).ref);
  assert.deepEqual(refs.map((r) => r.split('-')[2]), ['999', '1000']);
});

test('an admin reassigns the jefe de obra; the new one (admin or jefe) takes over, ampliaciones included', async () => {
  await assert.rejects(as(jefe).assignJefe(obraId, { jefeId: otroJefe.id }), { status: 403 });
  await assert.rejects(as(admin).assignJefe(obraId, { jefeId: cliente.id }), { status: 400 });
  const d = await as(admin).assignJefe(obraId, { jefeId: otroJefe.id });
  assert.equal(d.jefe.name, 'Otro Jefe');
  assert.ok(d.ampliaciones.length);
  assert.equal((await db.query('SELECT count(*)::int n FROM presupuestos WHERE parent_id=$1 AND jefe_id<>$2', [obraId, otroJefe.id])).rows[0].n, 0);
  await assert.rejects(as(jefe).get(obraId), { status: 404 }, 'the previous jefe no longer sees it');
  const item = d.obra.chapters[0].items[0];
  const after = await as(otroJefe).declare(obraId, { items: [{ partidaId: item.id, executed: '27.5' }] });
  assert.equal(obraItemById(after, item.id).executed, '27.5000');
  await as(admin).assignJefe(obraId, { jefeId: jefe.id });
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Jefe de obra asignado'")).rows[0].n, 2);
});
