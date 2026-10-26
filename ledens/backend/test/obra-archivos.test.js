import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { ObraArchivosService } from '../src/obras/archivos.js';
import { folderStorage, createStorage } from '../src/obras/storage.js';
import { sniff, MAX_PHOTO } from '../src/obras/validation.js';
import { createObrasRouter } from '../src/routes/obras.js';
// Fotos y documentos de obra on PGlite (migrations 020–022) with the files in
// a temporary folder: the jefe assigned uploads, the client of the obra sees
// and downloads, nobody else gets in, and the real bytes decide the format.
let db, pool, dir, storage, admin, jefe, otroJefe, cliente, otroCliente, obraId, borradorId, ampliacionId, server, base;
const ORIGIN = 'https://ledens.test';

const jpeg = (n = 64) => Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(n, 7), Buffer.from('ffd9', 'hex')]);
const png = () => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)]);
const heic = () => Buffer.concat([Buffer.from('00000018', 'hex'), Buffer.from('ftypheic\0\0\0\0mif1heic'), Buffer.alloc(32)]);
let pdf;

const call = (p, who, { method = 'GET', body, headers = {}, as: viewing, origin = ORIGIN } = {}) => fetch(`${base}/${obraId}/archivos${p}`, {
  method, body,
  headers: { origin, ...(who ? { 'x-test-user': who.id } : {}), ...(viewing ? { 'x-ledens-view-as': viewing.id } : {}), ...headers },
});
const upload = (who, content, name, extra = {}) => call('', who, { method: 'POST', body: content,
  headers: { 'content-type': 'application/octet-stream', 'x-archivo-nombre': encodeURIComponent(name), ...extra } });

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql']) {
    await db.exec(await fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8'));
  }
  [admin, jefe, otroJefe, cliente, otroCliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@arc.test','Admin Test','admin'),('jefe@arc.test','Jefe Test','jefe'),('jefe2@arc.test','Otro Jefe','jefe'),
    ('cliente@arc.test','Cliente Test','client'),('cliente2@arc.test','Otro Cliente','client') RETURNING id,email,name,role`)).rows;
  const as = (u) => new PresupuestosService(pool, u);
  const content = { title: 'Reforma de baño', chapters: [{ name: 'Fontanería', items: [{ name: 'Plato de ducha', unit: 'ud', quantity: '1', unitPrice: '300' }] }] };
  let d = await as(admin).create({ ...content, clientId: cliente.id, jefeId: jefe.id });
  obraId = d.id;
  d = await as(admin).send(obraId);
  await as(cliente).approve(obraId, { versionId: d.version.id });
  await as(jefe).schedule(obraId, { startDate: '2026-11-02' });
  borradorId = (await as(admin).create({ ...content, title: 'Cocina (borrador)', clientId: cliente.id, jefeId: jefe.id })).id;
  ampliacionId = (await as(jefe).create({ parentId: obraId, ...content, title: 'Ampliación' })).id;

  const doc = await PDFDocument.create(); doc.addPage(); pdf = Buffer.from(await doc.save());
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'obra-archivos-'));
  storage = folderStorage(dir);
  const users = Object.fromEntries([admin, jefe, otroJefe, cliente, otroCliente].map((u) => [u.id, u]));
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.use('/api/obras', createObrasRouter({ pool, storage, origin: ORIGIN,
    authenticate: (req, res, next) => { const u = users[req.get('x-test-user')]; if (!u) return res.status(401).end(); req.user = { ...u }; next(); },
    findUser: async (id) => users[id] || null }));
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/obras`;
});
after(async () => { server?.close(); await db?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

test('the format comes from the bytes: JPEG, PNG, HEIC, PDF; anything else is refused', async () => {
  assert.equal(sniff(jpeg()), 'image/jpeg');
  assert.equal(sniff(png()), 'image/png');
  assert.equal(sniff(heic()), 'image/heic');
  assert.equal(sniff(pdf), 'application/pdf');
  assert.equal(sniff(Buffer.from('MZ\x90\0 not an image')), null);
  assert.equal((await upload(jefe, Buffer.from('MZ\x90\0 not an image'), 'foto.jpg')).status, 415, 'an executable renamed .jpg');
  assert.equal((await upload(jefe, png(), 'foto.jpg')).status, 415, 'extension and content must agree');
  assert.equal((await upload(jefe, Buffer.from('%PDF-1.7 truncated'), 'acta.pdf')).status, 415, 'a PDF that does not open');
  assert.equal((await upload(jefe, Buffer.alloc(0), 'vacia.jpg')).status, 400);
  assert.equal((await upload(jefe, jpeg(MAX_PHOTO), 'enorme.jpg')).status, 413);
  assert.equal((await upload(jefe, jpeg(), 'foto.jpg', { 'x-archivo-fecha': '2999-01-01' })).status, 400, 'no dates in the future');
  assert.deepEqual(await fs.readdir(dir), [], 'nothing refused was stored');
});

test('the assigned jefe uploads photos and PDFs; the client of the obra lists and downloads them', async () => {
  let r = await upload(jefe, jpeg(), 'IMG_0001.JPG', { 'x-archivo-titulo': encodeURIComponent('Baño: regatas abiertas'), 'x-archivo-fecha': '2026-01-15' });
  assert.equal(r.status, 201);
  const foto = await r.json();
  assert.deepEqual([foto.kind, foto.mime, foto.title, foto.date, foto.uploadedBy], ['foto', 'image/jpeg', 'Baño: regatas abiertas', '2026-01-15', 'Jefe Test']);
  assert.equal((await upload(jefe, heic(), 'IMG_0002.HEIC')).status, 201);
  r = await upload(admin, pdf, 'Acta de replanteo.pdf', { 'x-archivo-descripcion': encodeURIComponent('Firmada por ambas partes') });
  assert.equal(r.status, 201, 'an admin uploads too');

  const list = await (await call('', cliente)).json();
  assert.equal(list.fotos.length, 2);
  assert.deepEqual(list.documentos.map((d) => [d.name, d.description]), [['Acta de replanteo.pdf', 'Firmada por ambas partes']]);
  assert.equal(list.can.upload, false, 'the client only reads');
  assert.equal((await (await call('', jefe)).json()).can.upload, true);

  r = await fetch(base.replace('/api/obras', '') + foto.url, { headers: { 'x-test-user': cliente.id } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.match(r.headers.get('content-disposition'), /^inline/);
  assert.match(r.headers.get('cache-control'), /private/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), jpeg());
  r = await fetch(base.replace('/api/obras', '') + list.documentos[0].downloadUrl, { headers: { 'x-test-user': cliente.id } });
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="Acta de replanteo.pdf"/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf);
});

test('nobody else sees or touches the files; «ver como» reads only; origin checked', async () => {
  assert.equal((await call('', null)).status, 401);
  assert.equal((await call('', otroCliente)).status, 404, 'another client');
  assert.equal((await call('', otroJefe)).status, 404, 'a jefe not assigned');
  assert.equal((await upload(cliente, jpeg(), 'mia.jpg')).status, 403, 'the client cannot upload');
  assert.equal((await upload(otroJefe, jpeg(), 'mia.jpg')).status, 404);
  const fotos = (await (await call('', admin, { as: cliente })).json()).fotos;
  assert.equal(fotos.length, 2, 'admin viewing as the client sees what the client sees');
  assert.equal((await call(`/${fotos[0].id}`, otroCliente)).status, 404, 'a file id alone does not open it');
  assert.equal((await upload(admin, jpeg(), 'x.jpg', { 'x-ledens-view-as': jefe.id })).status, 403, 'viewing as: read-only');
  assert.equal((await call(`/${fotos[0].id}`, admin, { method: 'DELETE', as: jefe })).status, 403);
  assert.equal((await call(`/${fotos[0].id}`, jefe, { method: 'DELETE', origin: 'https://evil.test' })).status, 403);

  const svc = (u, id) => new ObraArchivosService(pool, u, storage).list(id);
  await assert.rejects(svc(cliente, borradorId), { status: 404 }, 'a draft presupuesto is not the client’s yet');
  assert.equal((await svc(jefe, borradorId)).fotos.length, 0);
  await assert.rejects(svc(jefe, ampliacionId), { status: 409, message: /obra principal/ });
  await assert.rejects(new ObraArchivosService(pool, jefe, null).upload(obraId, { content: jpeg(), name: 'a.jpg' }), { status: 503 });
});

test('thumbnails: a small JPEG per photo, from the team only', async () => {
  const [foto] = (await (await call('', jefe)).json()).fotos.filter((f) => f.mime === 'image/jpeg');
  const put = (who, body) => call(`/${foto.id}/miniatura`, who, { method: 'PUT', body, headers: { 'content-type': 'image/jpeg' } });
  assert.equal((await put(cliente, jpeg(8))).status, 403);
  assert.equal((await put(jefe, png())).status, 415);
  assert.equal((await put(jefe, jpeg(8))).status, 200);
  assert.equal((await put(jefe, jpeg(8))).status, 409);
  const again = (await (await call('', cliente)).json()).fotos.find((f) => f.id === foto.id);
  assert.ok(again.thumbUrl);
  const r = await call(`/${foto.id}/miniatura`, cliente);
  assert.deepEqual([r.status, r.headers.get('content-type')], [200, 'image/jpeg']);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), jpeg(8));
});

test('withdrawing a file hides it at once, deletes the bytes and keeps who and when', async () => {
  const { fotos } = await (await call('', jefe)).json();
  const foto = fotos.find((f) => f.thumbUrl);
  assert.equal((await call(`/${foto.id}`, cliente, { method: 'DELETE' })).status, 403);
  assert.equal((await call(`/${foto.id}`, jefe, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/${foto.id}`, cliente)).status, 404);
  assert.equal((await call(`/${foto.id}`, jefe, { method: 'DELETE' })).status, 404);
  assert.equal((await (await call('', cliente)).json()).fotos.length, 1);
  const row = (await db.query('SELECT deleted_by, deleted_at, storage_key, thumb_key FROM obra_archivos WHERE id=$1', [foto.id])).rows[0];
  assert.equal(row.deleted_by, jefe.id);
  assert.ok(row.deleted_at);
  for (const key of [row.storage_key, row.thumb_key]) await assert.rejects(fs.stat(path.join(dir, ...key.split('/'))), { code: 'ENOENT' });
});

test('storage choice: Blob when configured, a local folder in development, nothing implicit in production', () => {
  assert.equal(createStorage({ OBRA_ARCHIVOS_BLOB_URL: 'https://cuenta.blob.core.windows.net' }).kind, 'blob');
  assert.equal(createStorage({ NODE_ENV: 'development', DATA_DIR: dir }).kind, 'folder');
  assert.equal(createStorage({ NODE_ENV: 'production', DATA_DIR: '/data' }), null, 'never fills the leads share by accident');
});
