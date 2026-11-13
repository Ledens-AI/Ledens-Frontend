import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { GanttService, calendar, schedule, durationFrom, span, orderByDependencies } from '../src/presupuestos/gantt.js';
import { RecursosService, rolDePuesto } from '../src/presupuestos/recursos.js';
import { sobreasignaciones } from '../src/presupuestos/ganttLimitaciones.js';
// Planificación (Gantt) of a project (migration 035), on PGlite with synthetic rows.
let db, pool, admin, jefe, otroJefe, cliente, proyecto, vacio, obra, w;
const migration = (m) => fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8');
const P = (u) => new PresupuestosService(pool, u);
// The scheduling tests put tasks in parallel on purpose (SS, FF…) with one
// cuadrilla, so they run without the limitaciones; GL is the real service
// (what the routes use), tested at the end.
const G = (u) => new GanttService(pool, u, { enforceLimitaciones: false });
const GL = (u) => new GanttService(pool, u);

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
      ('PA-001','Demolición','m2',20),('PA-002','Tabique','m2',8),('PA-003','Pintura','m2',NULL);
    CREATE TABLE ledens.positions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, activo boolean);
    CREATE TABLE ledens.employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, primary_position_id uuid, daily_pay numeric, activo boolean);
    INSERT INTO ledens.positions (name) VALUES ('Oficial de 1ª'),('Peón');
    INSERT INTO ledens.employees (name, primary_position_id, daily_pay, activo)
      SELECT x.n, (SELECT id FROM ledens.positions WHERE name = x.p), 100, x.a
      FROM (VALUES ('Juan','Oficial de 1ª',true),('Pedro','Peón',true),('Luis','Oficial de 1ª',true),('Mario','Peón',true),('Baja','Peón',false)) x(n,p,a);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '035_gantt_planificacion.sql', '039_gantt_inicio_obra.sql', '040_gantt_duracion_decimal.sql', '042_gantt_cuadrillas.sql', '043_gantt_cuadrilla_miembros.sql']) await db.exec(await migration(m));
  w = Object.fromEntries((await db.query('SELECT id, name FROM ledens.employees')).rows.map((r) => [r.name, r.id]));
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
  assert.deepEqual((await G(jefe).get(proyecto)).tasks[0].predecessors, [{ id: obra, type: 'FS', lag: 0, porDefecto: true }]); // untouched: «Inicio de obra» by default
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

test('cuadrillas divide the computed duration; «Inicio de obra» is the default predecessor until removed', async () => {
  let g = await G(jefe).get(proyecto);
  assert.deepEqual(g.obras.map((o) => [o.cuadrillas, o.canEdit]), [[1, true]]);
  const [dem, tab, pin] = g.tasks;
  // Fresh state for dem: no stored choice → «Inicio de obra» by default.
  await db.query('DELETE FROM gantt_tareas WHERE partida_id = $1', [dem.id]);
  await db.query('DELETE FROM gantt_dependencias WHERE partida_id = $1', [dem.id]);
  g = await G(jefe).get(proyecto);
  assert.deepEqual(g.tasks[0].predecessors, [{ id: obra, type: 'FS', lag: 0, porDefecto: true }]);
  assert.equal(g.tasks[0].start, '2026-11-06');

  // 2 cuadrillas: 50/20 = 2,5 días → 1,3; 20/8 = 2,5 → 1,3. A typed duration stays.
  await G(jefe).update(proyecto, pin.id, { duration: 4, predecessors: [{ id: tab.id, type: 'SS', lag: 1 }] });
  const dos = { cuadrillas: 2, equipos: [{ oficial: w.Juan, peon: w.Pedro }, { oficial: w.Luis, peon: w.Mario }] };
  await assert.rejects(G(otroJefe).setCuadrillas(proyecto, obra, dos), { status: 404 });
  await assert.rejects(G(jefe).setCuadrillas(proyecto, obra, { ...dos, cuadrillas: 0 }), { status: 400 });
  await assert.rejects(G(jefe).setCuadrillas(proyecto, cliente.id, dos), { status: 404 });
  g = await G(jefe).setCuadrillas(proyecto, obra, dos);
  assert.deepEqual(g.tasks.map((t) => [t.computedDuration, t.duration, t.cuadrillas]), [[1.3, 1.3, 2], [1.3, 1.3, 2], [null, 4, 2]]);
  assert.equal(g.obras[0].cuadrillas, 2);

  // Saving only predecessors (the agent's bulk save) keeps the typed duration.
  g = await G(jefe).updateMany(proyecto, [{ id: pin.id, predecessors: [{ id: dem.id }] }]);
  assert.equal(g.tasks[2].duration, 4);
  // Removing every predecessor on purpose leaves it without one (no default).
  g = await G(jefe).update(proyecto, dem.id, { predecessors: [] });
  assert.deepEqual(g.tasks[0].predecessors, []);
  g = await G(jefe).update(proyecto, dem.id, { predecessors: [{ id: obra, type: 'FS' }] });
  assert.deepEqual(g.tasks[0].predecessors, [{ id: obra, type: 'FS', lag: 0 }]);
  await G(admin).setCuadrillas(proyecto, obra, { cuadrillas: 1, equipos: [{ oficial: w.Juan, peon: w.Pedro }] });
});

test('every cuadrilla needs its oficial and peón from the active workers', async () => {
  assert.deepEqual(['Oficial de 1ª', 'Peón', 'Ayudante', 'Encargado', 'Administración', null].map(rolDePuesto), ['oficial', 'peon', 'peon', 'oficial', null, null]);
  await db.query('DELETE FROM gantt_cuadrilla_miembros');
  let g = await G(jefe).get(proyecto);
  // Nothing chosen yet: the cuadrilla is there, incomplete.
  assert.deepEqual(g.obras[0].equipos, [{ cuadrilla: 1, oficial: null, peon: null }]);
  assert.equal(g.obras[0].equiposCompletos, false);
  // The list to choose from: active workers only, with the role their puesto suggests; no pay.
  assert.deepEqual(g.trabajadores.map((t) => [t.name, t.rol]).sort(), [['Juan', 'oficial'], ['Luis', 'oficial'], ['Mario', 'peon'], ['Pedro', 'peon']]);
  assert.ok(!('daily_pay' in g.trabajadores[0]));

  const set = (body) => G(jefe).setCuadrillas(proyecto, obra, body);
  await assert.rejects(set({ cuadrillas: 2 }), { status: 400, message: /oficial y el peón de las 2 cuadrillas/ });
  await assert.rejects(set({ cuadrillas: 2, equipos: [{ oficial: w.Juan, peon: w.Pedro }] }), { status: 400 });
  await assert.rejects(set({ cuadrillas: 1, equipos: [{ oficial: w.Juan }] }), { status: 400, message: /Cuadrilla 1: elige el peón/ });
  await assert.rejects(set({ cuadrillas: 2, equipos: [{ oficial: w.Juan, peon: w.Pedro }, { oficial: w.Juan, peon: w.Mario }] }), { status: 400, message: /solo puede estar en una cuadrilla/ });
  await assert.rejects(set({ cuadrillas: 1, equipos: [{ oficial: w.Juan, peon: w.Baja }] }), { status: 400, message: /trabajadores activos/ });
  await assert.rejects(set({ cuadrillas: 1, equipos: [{ oficial: w.Juan, peon: cliente.id }] }), { status: 400 });
  // Nothing of a refused save was kept.
  assert.equal((await db.query('SELECT count(*)::int n FROM gantt_cuadrilla_miembros')).rows[0].n, 0);

  g = await set({ cuadrillas: 2, equipos: [{ oficial: w.Juan, peon: w.Pedro }, { oficial: w.Luis, peon: w.Mario }] });
  assert.deepEqual(g.obras[0].equipos.map((e) => [e.cuadrilla, e.oficial.name, e.peon.name]), [[1, 'Juan', 'Pedro'], [2, 'Luis', 'Mario']]);
  assert.equal(g.obras[0].equiposCompletos, true);
  const a = (await db.query("SELECT detail FROM audit_log WHERE action='Planificación modificada' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.match(a.detail, /2 cuadrillas — 1: oficial Juan, peón Pedro; 2: oficial Luis, peón Mario/);
  // Back to one: the second cuadrilla's people leave the obra.
  g = await set({ cuadrillas: 1, equipos: [{ oficial: w.Luis, peon: w.Pedro }] });
  assert.deepEqual(g.obras[0].equipos.map((e) => [e.oficial.name, e.peon.name]), [['Luis', 'Pedro']]);
  assert.deepEqual((await db.query('SELECT rol FROM gantt_cuadrilla_miembros ORDER BY rol')).rows.map((r) => r.rol), ['oficial', 'peon']);
  // A worker deactivated later still shows in the obra, and the cuadrilla counts as incomplete.
  await db.query("UPDATE ledens.employees SET activo=false WHERE name='Pedro'");
  g = await G(jefe).get(proyecto);
  assert.equal(g.obras[0].equipos[0].peon.name, 'Pedro');
  assert.equal(g.obras[0].equiposCompletos, false);
  await db.query("UPDATE ledens.employees SET activo=true WHERE name='Pedro'");
});

test('Recursos: each worker with their obras, the Gantt period and overlaps', async () => {
  const R = (u) => new RecursosService(pool, u, (x) => new GanttService(pool, x));
  await assert.rejects(R(cliente).list(), { status: 403 });
  // A second obra of the same project, approved, with Luis again → overlap.
  const d = await P(admin).create({ title: 'Cocina', vatRate: '21', clientId: cliente.id, jefeId: jefe.id, projectId: proyecto,
    chapters: [{ name: 'Obra', items: [{ code: 'PA-001', name: 'Demolición', unit: 'm2', quantity: '40', unitPrice: '10' }] }] });
  await P(admin).approveOnBehalf(d.id, { versionId: d.version.id, reason: 'Firmado' });
  await P(jefe).schedule(d.id, { startDate: '2026-11-09' });
  await G(jefe).setCuadrillas(proyecto, d.id, { cuadrillas: 1, equipos: [{ oficial: w.Luis, peon: w.Mario }] });

  const r = await R(jefe).list({ today: '2026-11-09' });
  const by = Object.fromEntries(r.trabajadores.map((t) => [t.name, t]));
  assert.equal(by.Baja, undefined, 'deactivated workers with nothing assigned are not listed');
  assert.equal(by.Juan.estado, 'libre');
  assert.equal(by.Pedro.estado, 'en_obra');
  assert.equal(by.Mario.estado, 'en_obra');
  assert.equal(by.Luis.estado, 'solape');
  assert.deepEqual(by.Luis.asignaciones.map((a) => [a.cuadrilla, a.rol, a.project.code]), [[1, 'oficial', 'P2026-020'], [1, 'oficial', 'P2026-020']]);
  assert.equal(by.Luis.solapes.length, 1);
  assert.equal(by.Luis.solapes[0].desde, '2026-11-09');
  const nueva = by.Mario.asignaciones[0];
  assert.deepEqual([nueva.desde, nueva.hasta], ['2026-11-09', '2026-11-10']); // 40/20 = 2 días
  assert.deepEqual(r.resumen, { trabajadores: 4, enObra: 2, reservados: 0, libres: 1, conSolape: 1 });
  // Long after both obras end, nothing overlaps any more.
  const later = await R(admin).list({ today: '2027-06-01' });
  assert.equal(later.trabajadores.find((t) => t.name === 'Luis').estado, 'libre');
});

test('sobreasignación: no more tasks at once than cuadrillas', () => {
  const date = (i) => `2026-11-${String(10 + i).padStart(2, '0')}`;
  const o = [{ id: 'o', ref: 'PRE-1', cuadrillas: 1 }];
  const t = (id, start, end) => ({ id, obraId: 'o', name: id, start, end });
  // Back to back (one ends at 2,5 where the next starts) is fine; 0 days never counts.
  assert.deepEqual(sobreasignaciones([t('a', 0, 2.5), t('b', 2.5, 4), t('c', 1, 1)], o, date), []);
  // Overlap from 2 to 2,5: day index 2.
  let r = sobreasignaciones([t('a', 0, 2.5), t('b', 2, 4)], o, date);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].tipo, r[0].max, r[0].desde, r[0].hasta, r[0].tareas.sort()], ['sobreasignacion', 2, '2026-11-12', '2026-11-12', ['a', 'b']]);
  assert.match(r[0].mensaje, /PRE-1: con 1 cuadrilla hay 2 tareas a la vez el 12\/11/);
  // Overlaps back to back (a+b, then a+c) are one conflict over the whole stretch.
  r = sobreasignaciones([t('a', 0, 3), t('b', 1, 2), t('c', 2, 4)], o, date);
  assert.deepEqual([r.length, r[0].desde, r[0].hasta, r[0].tareas.length, r[0].max], [1, '2026-11-11', '2026-11-12', 3, 2]);
  // With 2 cuadrillas two at once are fine, three are not.
  const o2 = [{ ...o[0], cuadrillas: 2 }];
  assert.deepEqual(sobreasignaciones([t('a', 0, 2), t('b', 0, 2)], o2, date), []);
  r = sobreasignaciones([t('a', 0, 2), t('b', 0, 2), t('c', 1, 3)], o2, date);
  assert.deepEqual([r.length, r[0].max, r[0].cuadrillas], [1, 3, 2]);
  assert.match(r[0].mensaje, /con 2 cuadrillas hay 3 tareas a la vez/);
  // Other obras are counted on their own.
  assert.deepEqual(sobreasignaciones([t('a', 0, 2), { ...t('b', 0, 2), obraId: 'x' }], [...o, { id: 'x', ref: 'PRE-2', cuadrillas: 1 }], date), []);
});

test('a plan that overallocates the cuadrillas of an obra cannot be saved; simular shows it without saving', async () => {
  const cocina = (await db.query("SELECT id FROM presupuestos WHERE title='Cocina'")).rows[0].id;
  // Start from a known plan in the obra: dem, then tab and pin both right after dem (in parallel).
  let g = await G(jefe).get(proyecto);
  // By code: the chart orders tasks by their dependencies, not by the budget.
  const [dem, tab, pin] = ['PA-001', 'PA-002', 'PA-003'].map((c) => g.tasks.find((t) => t.obraId === obra && t.code === c));
  await G(jefe).updateMany(proyecto, [{ id: dem.id, duration: null, predecessors: [{ id: obra }] }, { id: tab.id, duration: null, predecessors: [{ id: dem.id }] }, { id: pin.id, duration: null, predecessors: [{ id: dem.id }] }]);
  g = await GL(jefe).get(proyecto);
  const mine = g.limitaciones.filter((x) => x.obraId === obra);
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].tareas.sort(), [tab.id, pin.id].sort());
  assert.deepEqual([dem, tab, pin].map((x) => g.tasks.find((t) => t.id === x.id).sobreasignada), [false, true, true]);

  // Any save in that obra that leaves it overallocated is refused, and nothing changes.
  const audits = async () => (await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Planificación modificada'")).rows[0].n;
  const before = await audits();
  await assert.rejects(GL(jefe).update(proyecto, dem.id, { duration: 2, predecessors: [{ id: obra }] }), { status: 409, message: /No se puede guardar: PRE-2026-001: con 1 cuadrilla hay 2 tareas a la vez/ });
  assert.equal((await GL(jefe).get(proyecto)).tasks.find((t) => t.id === dem.id).durationOverride, null);
  assert.equal(await audits(), before);
  // Another obra of the project is not held back by it.
  const coc = g.tasks.find((t) => t.obraId === cocina);
  await GL(jefe).update(proyecto, coc.id, { duration: 3, predecessors: [{ id: cocina }] });

  // simular: the plan as the change would leave it, and nothing saved.
  const fix = [{ id: pin.id, predecessors: [{ id: tab.id, type: 'FS' }] }];
  const sim = await GL(jefe).updateMany(proyecto, fix, { simular: true });
  assert.equal(sim.simulacion, true);
  assert.deepEqual(sim.limitaciones.filter((x) => x.obraId === obra), []);
  assert.deepEqual(sim.tasks.find((t) => t.id === pin.id).predecessors, [{ id: tab.id, type: 'FS', lag: 0 }]);
  assert.equal((await GL(jefe).get(proyecto)).limitaciones.filter((x) => x.obraId === obra).length, 1, 'simular saved nothing');
  assert.equal(await audits(), before + 1); // only the cocina save
  // A cycle is still refused in a simulation.
  await assert.rejects(GL(jefe).updateMany(proyecto, [{ id: dem.id, predecessors: [{ id: pin.id }] }], { simular: true }), { status: 400 });

  // The fix itself saves.
  g = await GL(jefe).updateMany(proyecto, fix);
  assert.deepEqual(g.limitaciones.filter((x) => x.obraId === obra), []);
  assert.ok(g.tasks.every((t) => !t.sobreasignada));

  // With 2 cuadrillas, two tasks at once are allowed; three are not.
  await GL(jefe).setCuadrillas(proyecto, obra, { cuadrillas: 2, equipos: [{ oficial: w.Juan, peon: w.Pedro }, { oficial: w.Luis, peon: w.Mario }] });
  g = await GL(jefe).update(proyecto, pin.id, { predecessors: [{ id: dem.id, type: 'FS' }] });
  assert.deepEqual(g.limitaciones.filter((x) => x.obraId === obra), []);
  await assert.rejects(GL(jefe).updateMany(proyecto, [{ id: tab.id, predecessors: [{ id: obra }] }, { id: pin.id, predecessors: [{ id: obra }] }]), { status: 409, message: /con 2 cuadrillas hay 3 tareas a la vez/ });
});

test('each task goes right below the task it depends on, in cascade', () => {
  const t = (id, ...preds) => ({ id, predecessors: preds.map((p) => ({ id: p })) });
  // A, B, C, D, E in budget order; C depends on A, E on C, B on «Inicio de obra» (not a task), D on B and A.
  const order = orderByDependencies([t('A'), t('B', 'obra'), t('C', 'A'), t('D', 'B', 'A'), t('E', 'C')]);
  assert.deepEqual(order.map((x) => [x.id, x.nivel]), [['A', 0], ['C', 1], ['E', 2], ['B', 0], ['D', 1]]);
});
