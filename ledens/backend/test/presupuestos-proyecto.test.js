import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PresupuestosService } from '../src/presupuestos/service.js';
// Presupuestos linked to the projects of Gestión financiera (migration 032), on
// PGlite: users/audit_log, the presupuestos migrations and the ledens.projects
// columns this flow reads (copied from test/fixtures/ledens-accounting.sql).
let db, pool, admin, jefe, otroJefe, cliente, marbella, velez, obraId;
const as = (u) => new PresupuestosService(pool, u);
const body = (extra = {}) => ({
  title: 'Reforma integral Casa Marbella', address: 'C/ Ficticia 1, Marbella', vatRate: '21',
  chapters: [{ name: 'Albañilería', items: [{ code: 'PA-001', name: 'Tabique', unit: 'm2', quantity: '10', unitPrice: '100' }] }], ...extra,
});
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
      provincia text, customer_id uuid, status_id uuid REFERENCES ledens.project_statuses (id), end_date date);
    CREATE TABLE ledens.finance_project_permissions (user_id uuid NOT NULL, project_id uuid NOT NULL, PRIMARY KEY (user_id, project_id));
    INSERT INTO ledens.project_statuses VALUES ('00000000-0000-0000-0000-000000000001','EN_CURSO','En curso');`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql']) await db.exec(await migration(m));
  [admin, jefe, otroJefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@pp.test','Admin','admin'),('jefe@pp.test','Jefe','jefe'),('jefe2@pp.test','Otro Jefe','jefe'),('cliente@pp.test','Cliente','client')
    RETURNING id,email,name,role`)).rows;
  [marbella, velez] = (await db.query(`INSERT INTO ledens.projects(project_id,name,municipio,customer_name_source,status_id) VALUES
    ('P2026-014','Casa Marbella','Marbella','Cliente','00000000-0000-0000-0000-000000000001'),('P2026-015','Piso Vélez','Vélez-Málaga',NULL,NULL) RETURNING id`)).rows.map((r) => r.id);
});
after(() => db?.close());

test('migration 032 links the one Marbella obra to P2026-014 and audits it', async () => {
  // An obra created before the migration (the column does not exist yet).
  await db.query(`INSERT INTO presupuestos(title,address,client_id,jefe_id) VALUES ('Casa Marbella','Marbella',$1,$2) `, [cliente.id, jefe.id]);
  await db.query(`INSERT INTO presupuestos(title,client_id) VALUES ('Baño Nerja',$1)`, [cliente.id]);
  await db.exec(await migration('032_presupuestos_proyecto.sql'));
  const rows = (await db.query('SELECT title, project_id FROM presupuestos ORDER BY title')).rows;
  assert.deepEqual(rows, [{ title: 'Baño Nerja', project_id: null }, { title: 'Casa Marbella', project_id: marbella }]);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='Presupuesto vinculado a proyecto'")).rows[0].n, 1);
  await db.query('DELETE FROM audit_log');
  await db.query('DELETE FROM presupuestos');
});

test('an obra is created in a project; its ampliación follows it; clients never see the project', async () => {
  await assert.rejects(as(admin).create(body({ clientId: cliente.id, jefeId: jefe.id, projectId: 'nope' })), { status: 400 });
  await assert.rejects(as(admin).create(body({ clientId: cliente.id, projectId: '00000000-0000-0000-0000-0000000000ff' })), { status: 404 });
  // A jefe only links projects Gestión financiera lets them see.
  await assert.rejects(as(jefe).create(body({ clientId: cliente.id, projectId: marbella })), { status: 404 });
  const d = await as(admin).create(body({ clientId: cliente.id, jefeId: jefe.id, projectId: marbella }));
  obraId = d.id;
  assert.equal(d.project.code, 'P2026-014');
  assert.equal(d.project.status, 'En curso');
  assert.equal(d.can.linkProject, true);
  await as(admin).approveOnBehalf(obraId, { versionId: d.version.id, reason: 'Firmado en papel' });
  const amp = await as(jefe).create(body({ title: 'Ampliación cocina', parentId: obraId }));
  assert.equal(amp.project.id, marbella, 'the ampliación shows the project of its obra');
  assert.equal(amp.can.linkProject, false);
  await assert.rejects(as(admin).create(body({ title: 'Otra', parentId: obraId, projectId: velez })), { status: 400 });
  await assert.rejects(as(admin).setProject(amp.id, { projectId: velez }), { status: 400 });
  const team = await as(jefe).list();
  assert.ok(team.every((r) => r.project?.code === 'P2026-014'));
  const mine = await as(cliente).list();
  assert.ok(mine.length && mine.every((r) => !('project' in r)), 'internal: a client never gets the project');
  assert.equal('project' in (await as(cliente).get(obraId)), false);
});

test('the project view adds up its presupuestos; access follows presupuestos and finance permissions', async () => {
  const v = await as(jefe).projectView(marbella);
  assert.equal(v.project.name, 'Casa Marbella');
  assert.equal(v.kpis.obras, 1);
  assert.equal(v.kpis.presupuestos, 2);
  assert.deepEqual(v.kpis.aprobado, { n: 1, base: '1000.00', total: '1210.00' });
  assert.equal(v.kpis.borradores, 1);
  assert.equal(v.kpis.ejecucion.base, '1000.00');
  await assert.rejects(as(otroJefe).projectView(marbella), { status: 404 });
  await assert.rejects(as(cliente).projectView(marbella), { status: 403 });
  await assert.rejects(as(admin).projectView('00000000-0000-0000-0000-0000000000ff'), { status: 404 });
  assert.equal((await as(admin).projectView(velez)).presupuestos.length, 0);
  await db.query('INSERT INTO ledens.finance_project_permissions VALUES ($1,$2)', [otroJefe.id, velez]);
  assert.equal((await as(otroJefe).projectView(velez)).kpis.presupuestos, 0);
});

test('moving the obra to another project is audited; the jefe needs access to the new one', async () => {
  await assert.rejects(as(otroJefe).setProject(obraId, { projectId: velez }), { status: 404 }, 'not their obra');
  await assert.rejects(as(jefe).setProject(obraId, { projectId: velez }), { status: 404 }, 'no finance access to Vélez');
  await db.query('INSERT INTO ledens.finance_project_permissions VALUES ($1,$2)', [jefe.id, velez]);
  const d = await as(jefe).setProject(obraId, { projectId: velez });
  assert.equal(d.project.code, 'P2026-015');
  assert.equal((await as(admin).projectView(velez)).kpis.presupuestos, 2, 'the ampliación moves with its obra');
  const a = (await db.query("SELECT detail FROM audit_log WHERE action='Presupuesto vinculado a proyecto' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.match(a.detail, /P2026-014 · Casa Marbella → P2026-015 · Piso Vélez/);
  assert.equal((await as(admin).setProject(obraId, { projectId: null })).project, null);
  await assert.rejects(as(admin).setProject(obraId, { projectId: 'x' }), { status: 400 });
});
