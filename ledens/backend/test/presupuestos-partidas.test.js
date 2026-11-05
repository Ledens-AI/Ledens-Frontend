import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PartidasService } from '../src/presupuestos/partidas.js';
// «Partidas» (admins): the base de partidas (ledens.work_items) read and corrected
// from the platform. Fictitious base with the shape of the company's.

let db, pool, admin, jefe;
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text, target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.work_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_categoria text, name text);
    CREATE TABLE ledens.work_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text, id_partida text, category_id uuid REFERENCES ledens.work_categories(id), categoria text, name text,
      definicion_partida text, unit_source text, sale_price_including_vat numeric, sale_price_excluding_vat numeric, incluye_materiales text, activa text,
      rendimiento_cuadrilla numeric, rendimientovalidado text, palabrasclave text, unit_id uuid);
    INSERT INTO ledens.work_categories(id_categoria,name) VALUES ('CAT-005','Fontanería'),('CAT-011','Pintura');
    INSERT INTO ledens.work_items(id_partida,category_id,categoria,name,definicion_partida,unit_source,sale_price_including_vat,sale_price_excluding_vat,activa,rendimiento_cuadrilla,unit_id)
      SELECT 'PA-026',id,name,'Instalación de agua fría','Red de agua fría con tubería multicapa.','ml',14,14/1.21,'SI',12.5,'11111111-1111-4111-8111-111111111111' FROM ledens.work_categories WHERE id_categoria='CAT-005';
    INSERT INTO ledens.work_items(id_partida,category_id,categoria,name,unit_source,sale_price_including_vat,activa)
      SELECT 'PA-200',id,name,'Pintura plástica lisa en paredes','m²',8,'NO' FROM ledens.work_categories WHERE id_categoria='CAT-011';
    INSERT INTO ledens.work_items(id_partida,name,unit_source,activa) VALUES ('PA-9','Partida nueve','ud','SI');`);
  [admin, jefe] = (await db.query("INSERT INTO users(email,name,role) VALUES ('a@p.test','Admin P','admin'),('j@p.test','Jefe P','jefe') RETURNING id,email,name,role")).rows;
});
after(() => db?.close());

test('only an admin reads or changes the base', async () => {
  await assert.rejects(new PartidasService(pool, jefe).list(), { status: 403 });
  await assert.rejects(new PartidasService(pool, jefe).update('00000000-0000-4000-8000-000000000000', { changes: { name: { from: '', to: 'x' } } }), { status: 403 });
});

test('the list shows the important columns first, ordered by code, filtered', async () => {
  const svc = new PartidasService(pool, admin);
  const d = await svc.list();
  assert.deepEqual(d.columns.slice(0, 8).map((c) => c.key), ['id_partida', 'name', 'categoria', 'definicion_partida', 'unit_source', 'sale_price_including_vat', 'sale_price_excluding_vat', 'rendimiento_cuadrilla']);
  assert.ok(!d.columns.some((c) => ['id', 'source_id', 'category_id', 'unit_id'].includes(c.key)), 'keys hidden');
  assert.equal(d.columns.find((c) => c.key === 'id_partida').editable, false);
  assert.equal(d.columns.find((c) => c.key === 'activa').kind, 'yesno');
  assert.equal(d.columns.find((c) => c.key === 'palabrasclave').main, false);
  assert.deepEqual(d.partidas.map((p) => p.values.id_partida), ['PA-9', 'PA-026', 'PA-200']);
  assert.equal(d.partidas[1].categoryCode, 'CAT-005');
  assert.deepEqual([...d.units].sort(), ['ml', 'm²', 'ud'].sort());
  assert.deepEqual((await svc.list({ q: 'multicapa' })).partidas.map((p) => p.values.id_partida), ['PA-026']);
  assert.deepEqual((await svc.list({ activa: 'no' })).partidas.map((p) => p.values.id_partida), ['PA-200']);
  assert.deepEqual((await svc.list({ categoria: 'CAT-011' })).partidas.map((p) => p.values.id_partida), ['PA-200']);
  assert.equal((await svc.list({ q: '100%' })).total, 0, 'LIKE wildcards are literal');
});

test('an admin edits values; prices follow each other; every change is audited', async () => {
  const svc = new PartidasService(pool, admin);
  const p = (await svc.list({ q: 'PA-026' })).partidas[0];
  const r = await svc.update(p.id, { changes: {
    name: { from: p.values.name, to: 'Instalación de agua fría multicapa' },
    rendimiento_cuadrilla: { from: p.values.rendimiento_cuadrilla, to: '15,25' },
    sale_price_including_vat: { from: p.values.sale_price_including_vat, to: '24,2' },
    unit_source: { from: 'ml', to: 'm²' },
    categoria: { from: 'CAT-005', to: 'CAT-011' },
    activa: { from: 'SI', to: 'no' },
  } });
  assert.equal(r.changed, true);
  const v = r.partida.values;
  assert.equal(v.name, 'Instalación de agua fría multicapa');
  assert.equal(Number(v.rendimiento_cuadrilla), 15.25);
  assert.equal(Number(v.sale_price_including_vat), 24.2);
  assert.equal(Number(v.sale_price_excluding_vat), 20);
  assert.equal(v.categoria, 'Pintura');
  assert.equal(r.partida.categoryCode, 'CAT-011');
  assert.equal(v.activa, 'NO');
  assert.equal(v.id_partida, 'PA-026');
  assert.equal((await db.query("SELECT unit_id FROM ledens.work_items WHERE id_partida='PA-026'")).rows[0].unit_id, null, 'unit link follows the unit text');
  const a = (await db.query("SELECT * FROM audit_log WHERE action='Partida modificada'")).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].target_label, 'PA-026');
  assert.match(a[0].detail, /Rendimiento cuadrilla: «12.5» → «15.25»/);
  assert.match(a[0].detail, /calculado, IVA 21 %/);
});

test('stale values, read-only fields and bad values are refused; nothing changes', async () => {
  const svc = new PartidasService(pool, admin);
  const p = (await svc.list({ q: 'PA-200' })).partidas[0];
  await assert.rejects(svc.update(p.id, { changes: { name: { from: 'Otro nombre', to: 'x' } } }), { status: 409 });
  await assert.rejects(svc.update(p.id, { changes: { id_partida: { from: 'PA-200', to: 'PA-201' } } }), { status: 400 });
  await assert.rejects(svc.update(p.id, { changes: { source_id: { from: '', to: 'x' } } }), { status: 400 });
  await assert.rejects(svc.update(p.id, { changes: { sale_price_including_vat: { from: '8', to: 'abc' } } }), { status: 400 });
  await assert.rejects(svc.update(p.id, { changes: { rendimiento_cuadrilla: { from: '', to: '-1' } } }), { status: 400 });
  await assert.rejects(svc.update(p.id, { changes: { activa: { from: 'NO', to: 'quizá' } } }), { status: 400 });
  await assert.rejects(svc.update(p.id, { changes: { name: { from: p.values.name, to: ' ' } } }), { status: 400 });
  await assert.rejects(svc.update(p.id, { changes: { categoria: { from: 'CAT-011', to: 'CAT-999' } } }), { status: 400 });
  assert.deepEqual((await svc.list({ q: 'PA-200' })).partidas[0], p);
  const same = await svc.update(p.id, { changes: { sale_price_including_vat: { from: '8', to: '8,00' } } });
  assert.equal(same.changed, false);
});
