import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { folderStorage } from '../src/obras/storage.js';
import { repararNombresDesdePdf, runRepararNombresOnce, restores } from '../src/presupuestos/repararNombres.js';
import { capituloEnDosLineas } from './fixtures/pdf-capitulo-en-dos-lineas.js';
// Partida names the old PDF reader cut, restored from the PDF kept in the obra
// (migration 041), on PGlite with a fictitious PDF.
let db, pool, admin, cliente, obra, dir, storage;
const migration = (m) => fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8');

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.project_statuses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
    CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
      project_id text, name text, customer_name_source text, salesman text, address text, start_date date, municipio text,
      provincia text, customer_id uuid, status_id uuid REFERENCES ledens.project_statuses (id), end_date date);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '041_mantenimientos.sql']) await db.exec(await migration(m));
  [admin, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES ('admin@r.test','Admin','admin'),('cliente@r.test','Cliente','client') RETURNING id,email,name,role`)).rows;
  // As the old reader saved it: first lines of the name and of the chapter lost.
  const d = await new PresupuestosService(pool, admin).create({ title: 'Local', vatRate: '21', clientId: cliente.id, jefeId: admin.id,
    chapters: [{ name: 'desmontajes', items: [
      { name: '(aseo pequeño y entrada)', unit: 'm²', quantity: '6.42', unitPrice: '9.917355' },
      { name: 'Desmontaje inodoro en baño', unit: 'ud', quantity: '2', unitPrice: '53.719008' },
    ] }, { name: 'Albañilería', items: [{ name: 'paredes', unit: 'm²', quantity: '99', unitPrice: '1' }] }] });
  obra = d.id;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reparar-'));
  storage = folderStorage(dir);
  const id = '00000000-0000-4000-8000-000000000001', key = `${obra}/${id}`;
  await storage.put(key, await capituloEnDosLineas(), 'application/pdf');
  await db.query(`INSERT INTO obra_archivos (id, presupuesto_id, kind, storage_key, mime, size_bytes, sha256, original_name, taken_on, uploaded_by)
                  VALUES ($1,$2,'documento',$3,'application/pdf',1,$4,'Presupuesto.pdf','2026-11-01',$5)`, [id, obra, key, 'a'.repeat(64), admin.id]);
});
after(async () => { await db?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

test('only a stored text whose words appear in order in the PDF is restored', () => {
  assert.equal(restores('(aseo pequeño y entrada)', 'Retirada de tela existente en techo (aseo pequeño y entrada)'), true);
  assert.equal(restores('Desmontaje inodoro, válvulas, retirada', 'Desmontaje inodoro, latiguillos, válvulas, desagües, retirada'), true);
  assert.equal(restores('Desmontaje inodoro en baño', 'Desmontaje inodoro en baño'), false, 'same text: nothing to do');
  assert.equal(restores('paredes', 'Regularización de suelos'), false);
});

test('names and chapters are restored from the obra PDF, once, and audited', async () => {
  const sim = await repararNombresDesdePdf(pool, { storage, simulate: true, log: () => {} });
  assert.equal(sim.cambios.length, 1);
  assert.equal((await db.query("SELECT count(*)::int n FROM presupuesto_partidas WHERE name = '(aseo pequeño y entrada)'")).rows[0].n, 1, 'simulating changes nothing');

  await runRepararNombresOnce(pool, { storage, log: () => {} });
  const names = (await db.query('SELECT pp.name, c.name capitulo FROM presupuesto_partidas pp JOIN presupuesto_capitulos c ON c.id = pp.capitulo_id ORDER BY c.position, pp.position')).rows;
  assert.deepEqual(names.map((r) => [r.capitulo, r.name]), [
    ['Demoliciones y desmontajes', 'Retirada de tela existente en techo (aseo pequeño y entrada)'],
    ['Demoliciones y desmontajes', 'Desmontaje inodoro en baño'],
    ['Albañilería', 'paredes'], // different quantity: never touched
  ]);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action IN ('Partida corregida desde el PDF', 'Capítulo corregido desde el PDF')")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int n FROM mantenimientos")).rows[0].n, 1);
  await db.query("UPDATE presupuesto_partidas SET name = '(aseo pequeño y entrada)' WHERE name LIKE 'Retirada%'");
  await runRepararNombresOnce(pool, { storage, log: () => {} });
  assert.equal((await db.query("SELECT count(*)::int n FROM presupuesto_partidas WHERE name = '(aseo pequeño y entrada)'")).rows[0].n, 1, 'runs only once');
});
