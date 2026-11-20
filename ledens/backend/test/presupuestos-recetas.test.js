import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { RecetasService, runRecetasInicialesOnce } from '../src/presupuestos/recetas.js';
import { recetaInicial, unitFamily, seedRecetaNueva } from '../src/presupuestos/recetasIniciales.js';

// Recetas de las partidas (migration 046): herramientas obligatorias and
// materiales per unit, their first values by rule, and what a presupuesto needs.
let db, pool, admin, jefe, otroJefe, cliente, obra;
const migration = (m) => fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8');
const R = (u) => new RecetasService(pool, u);

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id text, name text);
    CREATE TABLE ledens.work_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_categoria text, name text);
    CREATE TABLE ledens.work_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_partida text, category_id uuid, categoria text, name text,
      definicion_partida text, unit_source text, activa text);
    INSERT INTO ledens.work_items(id_partida, categoria, name, unit_source, activa) VALUES
      ('PA-001','Pintura','Pintura plástica en fachada','m²','SI'),
      ('PA-002','Fontanería','Instalación de agua fría con multicapa','ml','SI'),
      ('PA-003','Varios','Partida sin regla conocida','ud','SI'),
      ('PA-004','Pintura','Pintura plástica en paredes','m2','SI');`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '041_mantenimientos.sql', '044_herramientas.sql', '046_partida_recetas.sql', '048_partidas_eliminadas.sql']) await db.exec(await migration(m));
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES ('a@r.test','Admin','admin'),('j@r.test','Jefe','jefe'),('j2@r.test','Otro','jefe'),('c@r.test','Cliente','client')
    RETURNING id,email,name,role`)).rows;
  // A tool already in the inventory is reused, never duplicated.
  await db.query("INSERT INTO inventory.tool_types(name, category, tracking) VALUES ('Escalera de tijera','Acceso','individual')");
});
after(() => db?.close());

test('rules: the name says the work, the unit the recipe', () => {
  assert.equal(unitFamily('m²'), 'm2'); assert.equal(unitFamily('M2'), 'm2'); assert.equal(unitFamily('m.l.'), 'ml'); assert.equal(unitFamily('Ud'), 'ud'); assert.equal(unitFamily('PA'), 'pa');
  const fachada = recetaInicial({ name: 'Pintura en fachada', unit: 'm²' });
  assert.ok(fachada.tools.includes('Rodillo de pintura') && fachada.tools.includes('Escalera extensible') && fachada.tools.includes('Andamio'));
  assert.match(fachada.materials[0].name, /exterior/);
  assert.equal(recetaInicial({ name: 'Retirada de azulejos', unit: 'm²' }).rule, 'demolicion');
  assert.equal(recetaInicial({ name: 'Ventana de PVC', unit: 'ud' }).rule, 'carpinteria');
  assert.equal(recetaInicial({ name: 'Suelo radiante', unit: 'm²' }).rule, 'climatizacion');
  assert.deepEqual(recetaInicial({ name: 'Pintura de paredes', unit: 'PA' }).materials, [], 'partida alzada: tools only');
  assert.equal(recetaInicial({ name: 'Partida rara', categoria: 'Fontanería', unit: 'ml' }).rule, 'fontaneria', 'falls back to the category');
  assert.equal(recetaInicial({ name: 'Partida rara', unit: 'ud' }), null);
});

test('startup job: first recetas for every partida, once; tool types created or reused', async () => {
  const r = await runRecetasInicialesOnce(pool, { log: () => {} });
  assert.equal(r.partidas, 4);
  assert.equal(r.conReceta, 3);
  assert.deepEqual(r.sinRegla, ['PA-003']);
  assert.ok(!r.tiposCreados.includes('Escalera de tijera'));
  assert.equal((await db.query("SELECT count(*)::int n FROM inventory.tool_types WHERE lower(name)='escalera de tijera'")).rows[0].n, 1);
  const pa1 = (await R(admin).get('PA-001'));
  assert.ok(pa1.herramientas.some((h) => h.name === 'Rodillo de pintura' && h.origin === 'inicial'));
  assert.ok(pa1.materiales.some((m) => m.name === 'Pintura de exterior (fachada)' && m.quantity === '0.3' && m.wastePct === '5'));
  assert.equal(await runRecetasInicialesOnce(pool, { log: () => {} }), null, 'runs once');
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Recetas iniciales de partidas'")).rows[0].n, 1);
});

test('an admin adds, changes and removes tools and materials; others cannot', async () => {
  await assert.rejects(R(jefe).addTool('PA-003', { name: 'Taladro' }), { status: 403 });
  await assert.rejects(R(cliente).get('PA-003'), { status: 403 });
  await assert.rejects(R(admin).addTool('PA-999', { name: 'Taladro' }), { status: 404 });
  let r = await R(admin).addTool('PA-003', { name: 'Martillo de carpintero', category: 'Carpintería', quantity: '2' });
  assert.equal(r.herramientas[0].name, 'Martillo de carpintero');
  assert.equal(r.herramientas[0].quantity, 2);
  assert.equal((await db.query("SELECT category FROM inventory.tool_types WHERE name='Martillo de carpintero'")).rows[0].category, 'Carpintería', 'new type in Ledens Tools');
  await assert.rejects(R(admin).addTool('PA-003', { toolTypeId: r.herramientas[0].toolTypeId }), { status: 409 });
  const consumible = (await db.query("INSERT INTO inventory.tool_types(name, category, tracking) VALUES ('Discos de corte','Corte','consumible') RETURNING id")).rows[0].id;
  await assert.rejects(R(admin).addTool('PA-003', { toolTypeId: consumible }), { status: 400 });
  r = await R(admin).updateTool('PA-003', r.herramientas[0].id, { quantity: 3 });
  assert.equal(r.herramientas[0].quantity, 3);
  r = await R(admin).addMaterial('PA-003', { name: 'Tornillos', unit: 'ud', quantity: '4,5', wastePct: '10' });
  assert.deepEqual(r.materiales.map((m) => [m.name, m.quantity, m.wastePct]), [['Tornillos', '4.5', '10']]);
  await assert.rejects(R(admin).addMaterial('PA-003', { name: 'tornillos ', unit: 'ud', quantity: 1 }), { status: 409 });
  await assert.rejects(R(admin).addMaterial('PA-003', { name: 'Cola', unit: 'kg', quantity: 0 }), { status: 400 });
  await assert.rejects(R(admin).addMaterial('PA-003', { name: 'Cola', unit: 'kg', quantity: 1, wastePct: 150 }), { status: 400 });
  r = await R(admin).updateMaterial('PA-003', r.materiales[0].id, { quantity: '6' });
  assert.equal(r.materiales[0].quantity, '6');
  r = await R(admin).removeMaterial('PA-003', r.materiales[0].id);
  assert.equal(r.materiales.length, 0);
  r = await R(admin).removeTool('PA-003', r.herramientas[0].id);
  assert.equal(r.herramientas.length, 0);
  assert.ok((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Receta de partida modificada' AND target_label='PA-003'")).rows[0].n >= 6);
  assert.ok((await R(jefe).toolTypes()).types.every((t) => t.tracking !== 'consumible'));
});

test('a presupuesto needs quantity × receta; an obra adds its approved ampliaciones; team only', async () => {
  const svc = new PresupuestosService(pool, admin);
  const content = { title: 'Reforma', clientId: cliente.id, jefeId: jefe.id, chapters: [{ name: 'Obra', items: [
    { code: 'PA-001', name: 'Pintura plástica en fachada', unit: 'm²', quantity: '100', unitPrice: '10' },
    { code: 'PA-004', name: 'Pintura de paredes interiores', unit: 'm2', quantity: '20', unitPrice: '8' },
    { code: 'PA-002', name: 'Agua fría', unit: 'ud', quantity: '3', unitPrice: '50' },
    { name: 'Algo sin código', unit: 'ud', quantity: '1', unitPrice: '50' },
    { code: 'PA-001', name: 'Opcional', unit: 'm²', quantity: '50', unitPrice: '10', kind: 'opcion' },
  ] }] };
  obra = await svc.create(content);
  const n = await R(jefe).necesidades(obra.id);
  assert.equal(n.lineas, 4);
  assert.equal(n.opcionalesExcluidas, 1);
  const ext = n.materiales.find((m) => m.name === 'Pintura de exterior (fachada)');
  assert.equal(ext.quantity, '31.5', '100 m² × 0,3 l × 1,05');
  const plastica = n.materiales.find((m) => m.name === 'Pintura plástica');
  assert.equal(plastica.quantity, '5.25', '20 m² × 0,25 l × 1,05');
  const imp = n.materiales.find((m) => m.name === 'Imprimación o fijador');
  assert.equal(imp.quantity, '17.4', 'same material of two partidas is summed: 100 × 0,15 + 20 × 0,12');
  assert.ok(n.herramientas.some((h) => h.name === 'Rodillo de pintura' && h.partidas.join() === 'PA-001,PA-004'));
  assert.ok(n.herramientas.some((h) => h.name === 'Cortatubos'), 'tools are needed whatever the unit');
  assert.deepEqual(n.sinReceta.map((s) => s.reason).sort(), ['Sin partida de la base', 'Unidad distinta: la línea va en ud y la receta por ml']);
  await assert.rejects(R(otroJefe).necesidades(obra.id), { status: 404 });
  await assert.rejects(R(cliente).necesidades(obra.id), { status: 404 });
  assert.equal((await R(admin).necesidades(obra.id, { ambito: 'obra' })).lineas, 0, 'nothing approved yet');
  await svc.send(obra.id);
  await new PresupuestosService(pool, cliente).approve(obra.id, { versionId: n.version.id });
  const o = await R(admin).necesidades(obra.id, { ambito: 'obra' });
  assert.equal(o.ambito, 'obra');
  assert.equal(o.lineas, 4);
  assert.equal(o.materiales.find((m) => m.name === 'Pintura de exterior (fachada)').quantity, '31.5');
});

test('a partida created in the base gets its first receta', async () => {
  await db.query("INSERT INTO ledens.work_items(id_partida, name, unit_source) VALUES ('PA-010','Alicatado de baño','m²')");
  const r = await seedRecetaNueva(pool, 'PA-010');
  assert.equal(r.conReceta, 1);
  const g = await R(admin).get('PA-010');
  assert.ok(g.materiales.some((m) => m.name === 'Azulejo o revestimiento cerámico' && m.wastePct === '10'));
  assert.equal((await seedRecetaNueva(pool, 'PA-010')).partidas, 0, 'a receta that exists is never touched');
});
