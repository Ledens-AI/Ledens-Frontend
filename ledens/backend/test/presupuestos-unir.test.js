import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
// «Unir a otra obra»: a second presupuesto of the same work, created as an obra
// of its own, becomes an ampliación of the first one (PUT /:id/obra).
let db, pool, admin, jefe, otroJefe, cliente, otroCliente;
const as = (u) => new PresupuestosService(pool, u);

const budget = (title, qty = '10') => ({
  title, address: 'C/ Ficticia 2', vatRate: '21',
  chapters: [{ name: 'Albañilería', items: [{ code: 'PA-001', name: `Partida de ${title}`, unit: 'm2', quantity: qty, unitPrice: '10' }] }],
});
// Created, sent and approved by the client.
async function approved(title, { client = cliente, jefeId = jefe.id } = {}) {
  const d = await as(admin).create({ ...budget(title), clientId: client.id, jefeId });
  const s = await as(admin).send(d.id);
  return as(client).approve(d.id, { versionId: s.version.id, selected: [] });
}

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, actor_id uuid REFERENCES users(id), actor_label text, action text,
      target_id uuid REFERENCES users(id), target_label text, detail text); CREATE SCHEMA ledens;
    CREATE TABLE ledens.transaction_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, event_type text NOT NULL, status text NOT NULL,
      reason text, document_id uuid, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, lease_token uuid,
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql']) await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  [admin, jefe, otroJefe, cliente, otroCliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@unir.test','Admin','admin'),('jefe@unir.test','Jefe','jefe'),('jefe2@unir.test','Otro Jefe','jefe'),
    ('cliente@unir.test','Cliente','client'),('cliente2@unir.test','Otro Cliente','client') RETURNING id,email,name,role`)).rows;
});
after(() => db?.close());

test('a second obra of the same client joins the first as an ampliación, with its progress, files and invitations', async () => {
  const first = await approved('Reforma de cocina');
  const second = await approved('Reforma de baño', { jefeId: otroJefe.id });
  // Only the second one got its start date: the obra in progress was the wrong one.
  await as(admin).schedule(second.id, { startDate: '2026-10-01', endDate: '2026-12-15' });
  const line = (await as(admin).get(second.id)).obra.chapters[0].items[0];
  await as(admin).declare(second.id, { items: [{ partidaId: line.id, executed: '4' }] });
  const amp = await as(admin).create({ ...budget('Extra del baño', '2'), parentId: second.id });
  await db.query(`INSERT INTO obra_archivos (presupuesto_id, kind, storage_key, mime, size_bytes, sha256, original_name, taken_on)
                  VALUES ($1,'foto','k1','image/jpeg',10,$2,'foto.jpg','2026-10-02')`, [second.id, 'a'.repeat(64)]);
  await db.query(`INSERT INTO invitaciones (presupuesto_id, user_id, email, expires_at) VALUES ($1,$2,'cliente2@unir.test', now() + interval '7 days')`, [second.id, otroCliente.id]);
  await db.query('INSERT INTO obra_clientes (presupuesto_id, user_id) VALUES ($1,$2)', [second.id, otroCliente.id]);
  assert.deepEqual((await as(admin).list()).filter((p) => p.phase === 'en_curso').map((p) => p.id), [second.id]);

  await assert.rejects(as(otroJefe).joinObra(second.id, { obraId: first.id }), { status: 404 }, 'a jefe needs both obras');
  await assert.rejects(as(admin).joinObra(second.id, { obraId: second.id }), { status: 400 });
  await assert.rejects(as(admin).joinObra(second.id, { obraId: amp.id }), { status: 400, message: /principal/ });

  const d = await as(admin).joinObra(second.id, { obraId: first.id });
  assert.equal(d.parent.id, first.id);
  assert.equal(d.jefe.id, jefe.id, 'it takes the jefe of the obra it joins');
  assert.equal(d.can.joinObra, false);

  const obra = await as(admin).get(first.id);
  assert.equal(obra.phase, 'en_curso');
  assert.deepEqual([obra.startDate, obra.endDate], ['2026-10-01', '2026-12-15'], 'the target had no dates: it takes those of the obra that joins');
  assert.equal(obra.can.declare, true);
  assert.deepEqual(obra.ampliaciones.map((a) => a.id).sort(), [second.id, amp.id].sort(), 'the ampliaciones of the joined obra follow it');
  // Its approved line and its progress now add to the obra: 100 + 100 base, 40 executed.
  assert.deepEqual([obra.obra.base, obra.obra.executedAmount], ['200.00', '40.00']);
  assert.deepEqual((await as(admin).list()).filter((p) => p.phase === 'en_curso').map((p) => p.id), [first.id], 'one obra in progress');
  for (const t of ['obra_archivos', 'invitaciones', 'obra_clientes']) {
    assert.deepEqual((await db.query(`SELECT presupuesto_id FROM ${t}`)).rows.map((r) => r.presupuesto_id), [first.id], `${t} moves to the obra`);
  }
  assert.ok((await db.query('SELECT jefe_id FROM presupuestos WHERE parent_id=$1', [first.id])).rows.every((r) => r.jefe_id === jefe.id));
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Obra unida a otra obra'")).rows[0].n, 1);
  await assert.rejects(as(admin).joinObra(second.id, { obraId: first.id }), { status: 400, message: /ya es una ampliación/ });
});

test('never across clients or projects, and only into an approved obra', async () => {
  const a = await approved('Obra A');
  const otra = await approved('Obra de otro cliente', { client: otroCliente });
  await assert.rejects(as(admin).joinObra(a.id, { obraId: otra.id }), { status: 400, message: /mismo cliente/ });
  const draft = await as(admin).create({ ...budget('Borrador'), clientId: cliente.id, jefeId: jefe.id });
  await assert.rejects(as(admin).joinObra(a.id, { obraId: draft.id }), { status: 409 });
  const b = await approved('Obra B');
  await db.query('UPDATE presupuestos SET project_id=gen_random_uuid() WHERE id=ANY($1::uuid[])', [[a.id, b.id]]);
  await assert.rejects(as(admin).joinObra(a.id, { obraId: b.id }), { status: 400, message: /proyectos distintos/ });
});
