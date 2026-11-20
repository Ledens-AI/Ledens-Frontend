import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
// Removing a line of a presupuesto from its page (migration 048): deleted in a
// draft, a new draft version without it when the client has it, and marked
// removed (no longer counting) in an approved obra. On PGlite.
let db, pool, admin, jefe, otroJefe, cliente;
const as = (u) => new PresupuestosService(pool, u);
const line = (name, quantity, unitPrice, extra = {}) => ({ name, unit: 'ud', quantity, unitPrice, ...extra });
const body = () => ({ title: 'Baño', clientId: cliente.id, jefeId: jefe.id, vatRate: '21', chapters: [{ name: 'C', items: [line('Plato de ducha', '1', '300'), line('Mampara', '1', '200'), line('Termo', '1', '400', { kind: 'opcion' })] }] });
const items = (d) => d.version.chapters.flatMap((c) => c.items);

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '048_partidas_eliminadas.sql']) {
    await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  }
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('a@del.test','Admin','admin'),('j@del.test','Jefe','jefe'),('j2@del.test','Otro Jefe','jefe'),('c@del.test','Cliente','client') RETURNING id,email,name,role`)).rows;
});
after(() => db?.close());

test('draft: the line is deleted; only the team of the obra may', async () => {
  const d = await as(jefe).create(body());
  assert.equal(d.can.removeLine, true);
  const mampara = items(d).find((i) => i.name === 'Mampara');
  await assert.rejects(as(otroJefe).removeLine(d.id, mampara.id), { status: 404 });
  await assert.rejects(as(cliente).removeLine(d.id, mampara.id), { status: 404 });
  const r = await as(jefe).removeLine(d.id, mampara.id);
  assert.equal(r.removal, 'borrada');
  assert.deepEqual(items(r).map((i) => i.name), ['Plato de ducha', 'Termo']);
  assert.equal(r.version.base, '300.00');
  await assert.rejects(as(jefe).removeLine(d.id, mampara.id), { status: 404 });
});

test('sent: a new draft version without the line; the client keeps the sent one until it is sent', async () => {
  let d = await as(jefe).create(body());
  d = await as(jefe).send(d.id);
  const plato = items(d).find((i) => i.name === 'Plato de ducha');
  await assert.rejects(as(jefe).removeLine(d.id, plato.id, {}), { status: 400, message: /motivo/ });
  const r = await as(jefe).removeLine(d.id, plato.id, { reason: 'Lo pone el cliente' });
  assert.equal(r.removal, 'nueva_version');
  assert.deepEqual([r.version.number, r.version.status], [2, 'draft']);
  assert.deepEqual(items(r).map((i) => i.name), ['Mampara', 'Termo']);
  assert.equal((await as(cliente).get(d.id)).version.number, 1, 'the client still sees version 1');
  // The old version's line can no longer be removed: it is not the latest one.
  await assert.rejects(as(jefe).removeLine(d.id, plato.id, { reason: 'otra vez' }), { status: 409 });
});

test('approved: the line stays, marked removed, and stops counting in totals and in the obra; the client is told', async () => {
  let d = await as(jefe).create(body());
  d = await as(admin).approveOnBehalf(d.id, { versionId: d.version.id, reason: 'Firmado en papel' });
  d = await as(jefe).schedule(d.id, { startDate: '2026-11-02' });
  const [plato, mampara] = items(d);
  d = await as(jefe).declare(d.id, { items: [{ partidaId: mampara.id, executed: '0.5' }] });
  assert.equal(d.obra.base, '500.00');
  assert.equal(d.obra.executedAmount, '100.00');
  await assert.rejects(as(jefe).removeLine(d.id, mampara.id, { reason: 'no' }), { status: 400 });
  const r = await as(jefe).removeLine(d.id, mampara.id, { reason: 'El cliente compra la mampara por su cuenta' });
  assert.equal(r.removal, 'retirada');
  const m = items(r).find((i) => i.id === mampara.id);
  assert.equal(m.counted, false);
  assert.equal(m.removed.reason, 'El cliente compra la mampara por su cuenta');
  assert.equal(r.version.base, '300.00');
  assert.equal(r.version.optionalBase, '400.00', 'a removed line is not an option either');
  assert.equal(r.obra.base, '300.00');
  assert.deepEqual(r.obra.chapters.flatMap((c) => c.items).map((i) => i.name), ['Plato de ducha']);
  assert.equal((await as(jefe).list()).find((x) => x.id === d.id).base, '300.00');
  const seen = await as(cliente).get(d.id);
  const ms = items(seen).find((i) => i.id === mampara.id);
  assert.ok(ms.removed && !('reason' in ms.removed), 'the client sees it struck, without the internal reason');
  assert.match(seen.comments.at(-1).body, /Se ha retirado del presupuesto la partida «Mampara»/);
  await assert.rejects(as(jefe).removeLine(d.id, mampara.id, { reason: 'otra vez' }), { status: 409 });
  const a = (await db.query("SELECT detail FROM audit_log WHERE action='Partida eliminada del presupuesto' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.match(a.detail, /«Mampara».*tenía avance declarado \(0\.5000 ud\).*El cliente compra la mampara/);
  assert.equal(r.obra.executedAmount, '0.00', 'its progress no longer counts either');
  assert.ok(plato);
});
