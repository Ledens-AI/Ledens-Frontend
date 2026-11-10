import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { GanttService, calendar, schedule, durationFrom, span } from '../src/presupuestos/gantt.js';
// Planificación (Gantt) of a project (migration 035), on PGlite with synthetic rows.
let db, pool, admin, jefe, otroJefe, cliente, proyecto, vacio, obra;
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
      ('PA-001','Demolición','m2',20),('PA-002','Tabique','m2',8),('PA-003','Pintura','m2',NULL);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '035_gantt_planificacion.sql', '039_gantt_inicio_obra.sql', '040_gantt_duracion_decimal.sql']) await db.exec(await migration(m));
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@g.test','Admin','admin'),('jefe@g.test','Jefe','jefe'),('jefe2@g.test','Otro','jefe'),('cliente@g.test','Cliente','client')
    RETURNING id,email,name,role`)).rows;
  [proyecto, vacio] = (await db.query(`INSERT INTO ledens.projects(project_id,name) VALUES ('P2026-020','Casa Gantt'),('P2026-021','Sin aprobar') RETURNING id`)).rows.map((r) => r.id);
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

test('working-day calendar and the four relations', () => {
  const cal = calendar('2026-11-06');
  assert.deepEqual([cal.date(0), cal.date(1), cal.date(5), cal.date(-1)], ['2026-11-06', '2026-11-09', '2026-11-13', '2026-11-05']);
  assert.equal(cal.index('2026-11-08'), 1, 'a Sunday rolls to Monday');
  const tasks = [{ id: 'a', earliest: 0, duration: 3 }, { id: 'b', earliest: 0, duration: 2 }];
  const run = (type, lag = 0) => schedule(tasks, [{ partida_id: 'b', predecessor_id: 'a', type, lag_days: lag }]).get('b');
  // Positions on the working-day axis, end exclusive (= start + duration).
  assert.deepEqual(run('FS'), { start: 3, end: 5 });
  assert.deepEqual(run('FS', -1), { start: 2, end: 4 });
  assert.deepEqual(run('SS', 1), { start: 1, end: 3 });
  assert.deepEqual(run('FF'), { start: 1, end: 3 });
  assert.deepEqual(run('SF', 3), { start: 1, end: 3 });
  // Tenths: two tasks of 0,5 in a row fill one day; 0,1 + 0,2 never drifts.
  const half = schedule([{ id: 'x', earliest: 0, duration: 0.5 }, { id: 'y', earliest: 0, duration: 0.5 }, { id: 'z', earliest: 0, duration: 0.1 }],
    [{ partida_id: 'y', predecessor_id: 'x', type: 'FS' }, { partida_id: 'z', predecessor_id: 'y', type: 'FS' }]);
  assert.deepEqual([half.get('x'), half.get('y'), half.get('z')], [{ start: 0, end: 0.5 }, { start: 0.5, end: 1 }, { start: 1, end: 1.1 }]);
  assert.deepEqual(span({ start: 0.5, end: 1 }), { first: 0, last: 0, from: 0.5, to: 1 });
  assert.deepEqual(span({ start: 1, end: 1.1 }), { first: 1, last: 1, from: 0, to: 0.1 });
  assert.deepEqual(span({ start: 2, end: 2 }), { first: 2, last: 2, from: 0, to: 0 });
  assert.throws(() => schedule(tasks, [{ partida_id: 'b', predecessor_id: 'a', type: 'FS' }, { partida_id: 'a', predecessor_id: 'b', type: 'FS' }]), { status: 400 });
  assert.equal(durationFrom(50, 20), 2.5);
  assert.equal(durationFrom(1, 20), 0.1);
  assert.equal(durationFrom(21, 20), 1.1);
  assert.equal(durationFrom(4, 2, true), 1);
  assert.equal(durationFrom(10, null), null);
});

test('the Gantt uses the rendimiento of the base and follows the predecessors table', async () => {
  await assert.rejects(G(admin).get(vacio), { status: 409 });
  await assert.rejects(G(cliente).get(proyecto), { status: 403 });
  await assert.rejects(G(otroJefe).get(proyecto), { status: 404 });
  let g = await G(jefe).get(proyecto);
  assert.equal(g.rendimiento.column, 'rendimiento_cuadrilla');
  const [dem, tab, pin] = g.tasks;
  assert.deepEqual([dem.duration, tab.duration, pin.duration], [2.5, 2.5, 1]); // 50/20, 20/8, sin rendimiento
  assert.ok(pin.warning);
  assert.ok(g.tasks.every((t) => t.start === '2026-11-06' && t.canEdit));

  g = await G(jefe).update(proyecto, tab.id, { predecessors: [{ id: dem.id, type: 'FS' }] });
  // Demolición runs Fri + Mon + half of Tue; the tabique starts at midday Tue.
  assert.deepEqual([g.tasks[1].start, g.tasks[1].startAt, g.tasks[1].end, g.tasks[1].endAt], ['2026-11-10', 0.5, '2026-11-12', 1]);
  g = await G(jefe).update(proyecto, pin.id, { duration: 4, predecessors: [{ id: tab.id, type: 'SS', lag: 1 }] });
  assert.deepEqual([g.tasks[2].start, g.tasks[2].end, g.tasks[2].duration, g.tasks[2].warning], ['2026-11-11', '2026-11-17', 4, null]);
  assert.equal(g.end, '2026-11-17');

  // A cycle is refused and nothing changes.
  await assert.rejects(G(jefe).update(proyecto, dem.id, { predecessors: [{ id: pin.id, type: 'FS' }] }), { status: 400 });
  assert.deepEqual((await G(jefe).get(proyecto)).tasks[0].predecessors, []);
  await assert.rejects(G(jefe).update(proyecto, dem.id, { predecessors: [{ id: dem.id }] }), { status: 400 });
  await assert.rejects(G(jefe).update(proyecto, dem.id, { duration: -1 }), { status: 400 });
  await assert.rejects(G(jefe).update(proyecto, dem.id, { duration: 0.25 }), { status: 400 });
  await assert.rejects(G(jefe).update(proyecto, dem.id, { predecessors: [{ id: tab.id, type: 'XX' }] }), { status: 400 });
  await assert.rejects(G(otroJefe).update(proyecto, dem.id, {}), { status: 404 });
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Planificación modificada'")).rows[0].n, 2);

  // Back to the rendimiento.
  g = await G(admin).update(proyecto, pin.id, { duration: null, predecessors: [{ id: tab.id, type: 'SS', lag: 1 }] });
  assert.equal(g.tasks[2].duration, 1);

  // Half days: 0,5 + 0,5 fill one day; 0 is allowed and is not «sin rendimiento».
  g = await G(jefe).updateMany(proyecto, [{ id: dem.id, duration: 0.5 }, { id: tab.id, duration: '0.5', predecessors: [{ id: dem.id }] }, { id: pin.id, duration: 0, predecessors: [{ id: tab.id }] }]);
  assert.deepEqual(g.tasks.map((t) => [t.duration, t.start, t.end, t.startAt, t.endAt]),
    [[0.5, '2026-11-06', '2026-11-06', 0, 0.5], [0.5, '2026-11-06', '2026-11-06', 0.5, 1], [0, '2026-11-09', '2026-11-09', 0, 0]]);
  assert.equal(g.tasks[2].warning, null);
  await G(jefe).updateMany(proyecto, [{ id: dem.id, duration: null }, { id: tab.id, duration: null, predecessors: [{ id: dem.id }] }, { id: pin.id, duration: null, predecessors: [{ id: tab.id, type: 'SS', lag: 1 }] }]);
});

test('«Inicio de obra» is a milestone any task may take as predecessor', async () => {
  let g = await G(jefe).get(proyecto);
  assert.deepEqual(g.hitos.map((h) => [h.id, h.name, h.date]), [[obra, 'Inicio de obra', '2026-11-06']]);
  const dem = g.tasks[0];
  g = await G(jefe).update(proyecto, dem.id, { predecessors: [{ id: obra, type: 'FS', lag: 2 }] });
  assert.deepEqual(g.tasks[0].predecessors, [{ id: obra, type: 'FS', lag: 2 }]);
  assert.equal(g.tasks[0].start, '2026-11-10'); // FS 0 = the start day itself; +2 working days
  g = await G(jefe).update(proyecto, dem.id, { predecessors: [{ id: obra, type: 'FS' }] });
  assert.equal(g.tasks[0].start, '2026-11-06');
  assert.equal((await db.query('SELECT count(*)::int n FROM gantt_inicio_dependencias')).rows[0].n, 1);
  g = await G(jefe).update(proyecto, dem.id, { predecessors: [] });
  assert.deepEqual(g.tasks[0].predecessors, []);
  assert.equal((await db.query('SELECT count(*)::int n FROM gantt_inicio_dependencias')).rows[0].n, 0);
  await assert.rejects(G(jefe).update(proyecto, dem.id, { predecessors: [{ id: vacio }] }), { status: 400 });
});
