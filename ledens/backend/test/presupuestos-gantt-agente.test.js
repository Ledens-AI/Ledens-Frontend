import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { GanttService } from '../src/presupuestos/gantt.js';
import { ganttAgenteDraft } from '../src/presupuestos/ganttAgente.js';
// The planning agent only suggests predecessors (src/presupuestos/ganttAgente.js);
// it never writes gantt_tareas/gantt_dependencias — GanttService.updateMany()
// (the «guardar en bloque» the jefe triggers after reviewing) does that, in
// one transaction. The model is replaced by a fake tool_use call, same shape
// as presupuestos-agente.test.js, no network/API key here.

function fakeAnthropic(dependencias) {
  return { messages: { create: async () => ({ content: [{ type: 'tool_use', name: 'proponer_dependencias', input: { dependencias } }] }) } };
}

let db, pool, admin, jefe, otroJefe, cliente, proyecto, obra;
const migration = (m) => fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8');
const P = (u) => new PresupuestosService(pool, u);
const G = (u) => new GanttService(pool, u);

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
      provincia text, customer_id uuid, status_id uuid REFERENCES ledens.project_statuses (id), end_date date);
    CREATE TABLE ledens.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL);
    CREATE TABLE ledens.finance_project_permissions (user_id uuid NOT NULL, project_id uuid NOT NULL, PRIMARY KEY (user_id, project_id));
    CREATE TABLE ledens.work_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_partida text, name text, unit_source text,
      rendimiento_cuadrilla numeric, rendimientovalidado text);
    INSERT INTO ledens.work_items (id_partida, name, unit_source, rendimiento_cuadrilla) VALUES
      ('PA-001','Demolición','m2',20),('PA-002','Tabique','m2',8),('PA-003','Pintura','m2',10);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '035_gantt_planificacion.sql', '039_gantt_inicio_obra.sql', '040_gantt_duracion_decimal.sql', '042_gantt_cuadrillas.sql', '043_gantt_cuadrilla_miembros.sql']) await db.exec(await migration(m));
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@g.test','Admin','admin'),('jefe@g.test','Jefe','jefe'),('jefe2@g.test','Otro','jefe'),('cliente@g.test','Cliente','client')
    RETURNING id,email,name,role`)).rows;
  [proyecto] = (await db.query(`INSERT INTO ledens.projects(project_id,name) VALUES ('P2026-030','Casa Agente') RETURNING id`)).rows.map((r) => r.id);
  const d = await P(admin).create({ title: 'Reforma', vatRate: '21', clientId: cliente.id, jefeId: jefe.id, projectId: proyecto,
    chapters: [{ name: 'Obra', items: [
      { code: 'PA-001', name: 'Demolición', unit: 'm2', quantity: '50', unitPrice: '10' },
      { code: 'PA-002', name: 'Tabique', unit: 'm2', quantity: '20', unitPrice: '30' },
      { code: 'PA-003', name: 'Pintura', unit: 'm2', quantity: '100', unitPrice: '5' },
    ] }] });
  obra = d.id;
  await P(admin).approveOnBehalf(obra, { versionId: d.version.id, reason: 'Firmado' });
  await P(jefe).schedule(obra, { startDate: '2026-11-06' }); // a Friday
});
after(() => db?.close());

test('needs a configured client, at least two tasks, and permission to edit every one', async () => {
  await assert.rejects(ganttAgenteDraft(jefe, proyecto, { db: pool }), { status: 503 }, 'no anthropic client');
  await assert.rejects(ganttAgenteDraft(cliente, proyecto, { db: pool, anthropic: fakeAnthropic([]) }), { status: 403 }, 'a client cannot see the project at all');
  await assert.rejects(ganttAgenteDraft(otroJefe, proyecto, { db: pool, anthropic: fakeAnthropic([]) }), { status: 404 }, 'a jefe not assigned to this obra cannot see it either');
});

test('proposes predecessors only for tasks without one, discards cycles and nonsense, never saves anything itself', async () => {
  // 1 → Demolición, 2 → Tabique, 3 → Pintura (order of g.get()'s tasks).
  const proposal = await ganttAgenteDraft(jefe, proyecto, { db: pool, anthropic: fakeAnthropic([
    { tarea: 2, predecesora: 1, tipo: 'FS', desfaseDias: 0, motivo: 'La tabiquería va después de la demolición' },
    { tarea: 3, predecesora: 2, tipo: 'FS', desfaseDias: 0, motivo: 'Se pinta tras el tabique' },
    { tarea: 1, predecesora: 3, tipo: 'FS', motivo: 'ciclo' }, // would close a loop with the two above — must be dropped
    { tarea: 2, predecesora: 2, motivo: 'a sí misma' }, // self — dropped
    { tarea: 9, predecesora: 1, motivo: 'no existe' }, // out of range — dropped
  ]) });
  assert.equal(proposal.tasks.length, 2, 'two tasks got a usable suggestion');
  assert.equal(proposal.accepted, 2);
  assert.ok(proposal.warnings.some((w) => /ciclo/.test(w)));
  assert.ok(proposal.warnings.some((w) => /su propia predecesora|propia predecesora/.test(w)) || proposal.warnings.some((w) => /no existe|número de tarea/.test(w)));

  // Nothing was written to the database by the agent itself.
  let g = await G(jefe).get(proyecto);
  // (only the default «Inicio de obra» each task gets until it is planned)
  assert.ok(g.tasks.every((t) => t.predecessors.length === 1 && t.predecessors[0].porDefecto && t.predecessors[0].id === obra));

  // The jefe reviews and saves in bulk — one request, one transaction.
  g = await G(jefe).updateMany(proyecto, proposal.tasks.map((t) => ({ id: t.id, predecessors: t.predecessors })));
  const byId = new Map(g.tasks.map((t) => [t.id, t]));
  const [dem, tab, pin] = g.tasks;
  assert.deepEqual(byId.get(tab.id).predecessors.map((p) => p.id), [dem.id]);
  assert.deepEqual(byId.get(pin.id).predecessors.map((p) => p.id), [tab.id]);
  // pushed by the chain: demolición 2,5 días (50/20) from Fri 6, tabique from midday Tue 10 (2,5 días), pintura Fri 13
  assert.deepEqual([tab.start, tab.startAt, pin.start], ['2026-11-10', 0.5, '2026-11-13']);
});

test('a task that already has a predecessor is left alone even if the model proposes something for it again', async () => {
  // dem (1) is still the only one without a predecessor after the previous
  // test's chain (2←1←nothing, 3←2) — a model offering more for 2 and 3 gets ignored.
  const proposal = await ganttAgenteDraft(jefe, proyecto, { db: pool, anthropic: fakeAnthropic([
    { tarea: 2, predecesora: 3, motivo: 'tarde pero por si acaso' },
    { tarea: 3, predecesora: 1, motivo: 'otra vez' },
  ]) });
  assert.deepEqual(proposal.tasks, []);
  assert.ok(proposal.warnings.length);
});

test('a model that calls no tool, or proposes nothing usable, fails loud instead of silently saving nothing', async () => {
  const noTool = { messages: { create: async () => ({ content: [{ type: 'text', text: 'no sé' }] }) } };
  await assert.rejects(ganttAgenteDraft(jefe, proyecto, { db: pool, anthropic: noTool }), { status: 502 });
});
