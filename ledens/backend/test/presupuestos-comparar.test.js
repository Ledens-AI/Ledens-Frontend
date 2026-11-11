import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
// «Analizar existentes»: an ampliación read from a PDF against what the obra
// already has approved (root + approved ampliaciones), on PGlite.
let db, pool, admin, jefe, otroJefe, cliente, obraId;
const as = (u) => new PresupuestosService(pool, u);
const line = (code, name, unit, quantity, unitPrice, extra = {}) => ({ code, name, unit, quantity, unitPrice, ...extra });

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql']) {
    await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  }
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('a@cmp.test','Admin','admin'),('j@cmp.test','Jefe','jefe'),('j2@cmp.test','Otro Jefe','jefe'),('c@cmp.test','Cliente','client') RETURNING id,email,name,role`)).rows;
  // Obra: tabique 100 m² (PA-001), alicatado 20 m² (PA-039), an unselected option; then an approved ampliación with 10 more m² of alicatado.
  const d = await as(admin).create({ title: 'Casa', clientId: cliente.id, jefeId: jefe.id, vatRate: '21', chapters: [{ name: 'Obra', items: [
    line('PA-001', 'Tabique de ladrillo', 'm2', '100', '40', { baseCode: 'PA-001' }),
    line('X-7', 'Alicatado en pared', 'm²', '20', '30', { baseCode: 'PA-039' }),
    line('OP-1', 'Termo eléctrico', 'ud', '1', '400', { kind: 'opcion' })] }] });
  obraId = d.id;
  await as(admin).approveOnBehalf(obraId, { versionId: d.version.id, reason: 'Firmado en papel' });
  const amp = await as(admin).create({ title: 'Ampliación', parentId: obraId, chapters: [{ name: 'Más', items: [line(null, 'Alicatado en pared', 'm2', '10', '30')] }] });
  await as(admin).approveOnBehalf(amp.id, { versionId: amp.version.id, reason: 'Firmado en papel' });
});
after(() => db?.close());

test('each PDF line is existente, exceso (only the difference is new) or nueva, against the approved lines of the obra', async () => {
  const r = await as(jefe).compareWithObra(obraId, { chapters: [
    { name: 'Obra', items: [
      line('PA-001', 'Tabique ladrillo macizo', 'M2', '100', '40'), // same code: existente
      line(null, 'Alicatado en pared', 'm2', '35', '32', { baseCode: 'PA-039' }), // 20 + 10 approved by base code and name → exceso 5, other price
      line(null, 'Pintura plástica', 'm2', '80', '8'), // nueva
      line(null, 'Termo eléctrico', 'ud', '1', '400') ] }, // option the client did not choose: nueva
    { name: 'Repetida', items: [line('PA-001', 'Tabique', 'm2', '10', '40')] }] }); // tabique already used up by the first line: exceso 10
  assert.deepEqual(r.items.map((x) => [x.chapter, x.item, x.status, x.extraQuantity ?? null]),
    [[0, 0, 'existente', null], [0, 1, 'exceso', '5'], [0, 2, 'nueva', null], [0, 3, 'nueva', null], [1, 0, 'exceso', '10']]);
  assert.deepEqual(r.summary, { nuevas: 2, existentes: 1, excesos: 2 });
  const alicatado = r.items[1];
  assert.equal(alicatado.approvedQuantity, '30');
  assert.equal(alicatado.priceDiffers, true);
  assert.deepEqual(alicatado.matched.map((m) => m.ref).sort(), [...new Set(alicatado.matched.map((m) => m.ref))].sort());
  assert.equal(alicatado.matched.length, 2, 'the obra and its ampliación');
  assert.equal(r.items[0].priceDiffers, false);
  assert.equal(r.items[4].approvedQuantity, '0');
});

test('a different unit is not the same partida; only the team of the obra compares, and only against an approved obra', async () => {
  const r = await as(admin).compareWithObra(obraId, { chapters: [{ name: 'C', items: [line('PA-001', 'Tabique de ladrillo', 'ml', '5', '40')] }] });
  assert.equal(r.items[0].status, 'nueva');
  await assert.rejects(as(otroJefe).compareWithObra(obraId, { chapters: [] }), { status: 404 });
  await assert.rejects(as(cliente).compareWithObra(obraId, { chapters: [] }), { status: 403 });
  const draft = await as(admin).create({ title: 'Sin aprobar', clientId: cliente.id, chapters: [{ name: 'C', items: [line(null, 'Algo', 'ud', '1', '1')] }] });
  await assert.rejects(as(admin).compareWithObra(draft.id, { chapters: [] }), { status: 409 });
});
