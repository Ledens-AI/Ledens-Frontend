import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { FinanzasService, safeDocumentUrl } from '../src/finanzas/service.js';
import { createFinanzasRouter } from '../src/routes/finanzas.js';

// Isolated PostgreSQL (PGlite) with the production accounting schema from
// fixtures/ledens-accounting.sql plus this repo's migration 010. Every row
// below is synthetic test data.
const read = (p) => fs.readFile(new URL(p, import.meta.url), 'utf8');
let db, svc, ids, server, base;
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const admin = { id: null, name: 'Admin Test', email: 'admin@test.local' };

before(async () => {
  db = new PGlite();
  await db.exec(await read('./fixtures/ledens-accounting.sql'));
  await db.exec(await read('../src/db/migrations/010_finanzas_imputacion.sql'));
  admin.id = (await one(`INSERT INTO users (email, name, role) VALUES ('admin@test.local', 'Admin Test', 'admin') RETURNING id`)).id;
  const pool = { query: (q, p) => db.query(q, p), connect: async () => ({ query: (q, p) => db.query(q, p), release() {} }) };
  svc = new FinanzasService(pool);

  const id = async (sql, p) => (await one(sql + ' RETURNING id', p)).id;
  const customer = await id(`INSERT INTO ledens.customers (display_name) VALUES ('Cliente Prueba')`);
  const pA = await id(`INSERT INTO ledens.projects (project_id, name, municipio, address, customer_id, start_date) VALUES ('P-TEST-1', 'Reforma vivienda', 'Marbella', 'Calle Prueba 1', $1, '2026-09-01')`, [customer]);
  const pB = await id(`INSERT INTO ledens.projects (project_id, name, municipio, start_date) VALUES ('P-TEST-2', 'Reforma cocina', 'Antequera', '2026-08-01')`);
  const acct = await id(`INSERT INTO ledens.bank_accounts (connection_id, external_account_id, name, currency) VALUES (gen_random_uuid(), 'x', 'Cuenta test', 'EUR')`);
  const mov = await id(`INSERT INTO ledens.bank_movements (source_id, completed_on, description, amount, total_amount, bank_account_id, currency, beneficiary_name)
    VALUES ('3T2026-001', '2026-09-10', 'Pago proveedor', -121, -121, $1, 'EUR', 'Almacenes Test')`, [acct]);
  const doc = await id(`INSERT INTO ledens.documents (numerodocumento, tipo, tercero, total, document_on, enlacearchivo, review_state)
    VALUES ('F-001', 'Factura recibida', 'Almacenes Test', 121, '2026-09-09', 'https://ledenses.sharepoint.com/sites/ledens.es/Shared%20Documents/datasource/3T-2025/f.pdf', 'Revisado')`);
  const wc = await id(`INSERT INTO ledens.work_items (categoria, name) VALUES ('Fontanería', 'Tubería')`);
  const cat = await id(`INSERT INTO ledens.work_categories (name) VALUES ('Albañilería')`);
  const emp = await id(`INSERT INTO ledens.employees (name) VALUES ('Operario Test')`);
  const m1 = await id(`INSERT INTO ledens.material_expenses (description, partida, quantity, unit_price, total, occurred_on, document_id, bank_movement_id, work_item_id, und)
    VALUES ('Tubo PVC', 'Fontanería baño', 10, 12.1, 121, '2026-09-09', $1, $2, $3, 'm')`, [doc, mov, wc]);
  const m2 = await id(`INSERT INTO ledens.material_expenses (description, quantity, unit_price, total, occurred_on, document_id)
    VALUES ('Codos', 4, 5, 20, '2026-09-12', $1)`, [doc]);
  const m3 = await id(`INSERT INTO ledens.material_expenses (description, quantity, unit_price, total, occurred_on, project_id, document_id)
    VALUES ('Cemento', 2, 50, 100, '2026-08-20', $1, $2)`, [pA, doc]);
  const w1 = await id(`INSERT INTO ledens.worker_payments (amount, occurred_on, employee_id, category_id, forma_de_pago) VALUES (1000, '2026-09-15', $1, $2, 'Transferencia')`, [emp, cat]);
  const c1 = await id(`INSERT INTO ledens.customer_payments (occurred_on, id_pago, cliente, total, vat_amount) VALUES ('2026-09-01', 'PG-1', 'Cliente Prueba', 5000, 454.55)`);
  const budget = await id(`INSERT INTO ledens.budgets (project_id) VALUES ($1)`, [pA]);
  const v1 = await id(`INSERT INTO ledens.budget_versions (budget_id, version_number, state) VALUES ($1, 1, 'rejected')`, [budget]);
  const v2 = await id(`INSERT INTO ledens.budget_versions (budget_id, version_number, state) VALUES ($1, 2, 'accepted')`, [budget]);
  await db.query(`INSERT INTO ledens.budget_lines (project_id, work_item_id, categoria, quantity, unit_price, total, budget_id, version_id)
    VALUES ($1, $2, 'Fontanería', 1, 9999, 9999, $3, $4), ($1, $2, 'Fontanería', 1, 3000, 3000, $3, $5), ($1, $2, 'Albañilería', 1, 2000, 2000, $3, $5)`, [pA, wc, budget, v1, v2]);
  ids = { pA, pB, m1, m2, m3, w1, c1, doc, mov };

  const app = express();
  app.use(express.json());
  // Stand-in for the session lookup only; the role check is the real one.
  const authenticate = (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'No autenticado' });
    req.user = { id: admin.id, name: 'Admin Test', email: 'admin@test.local', role };
    next();
  };
  app.use('/api/finanzas', createFinanzasRouter({ service: svc, authenticate }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/finanzas`;
});
after(async () => { server?.close(); await db?.close(); });

const call = (method, path, body, role = 'jefe') => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test('migration 010 also applies to an auth-only database without the accounting tables', async () => {
  const empty = new PGlite();
  try {
    await empty.exec('CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid())');
    await empty.exec(await read('../src/db/migrations/010_finanzas_imputacion.sql'));
    assert.ok((await empty.query(`SELECT to_regclass('ledens.project_allocations') AS t`)).rows[0].t);
  } finally { await empty.close(); }
});

test('the pending inbox lists unassigned records of all three tables with readable names', async () => {
  const { rows, total } = await svc.listRecords({ pending: true });
  assert.equal(total, 4, 'm1, m2, w1, c1 — m3 already has a project');
  const m1 = rows.find((r) => r.id === ids.m1);
  assert.equal(m1.type, 'material');
  assert.equal(m1.tercero, 'Almacenes Test', 'supplier from the linked document');
  assert.equal(m1.concepto, 'Tubo PVC · Fontanería baño');
  assert.equal(m1.numerodocumento, 'F-001');
  assert.equal(m1.estado, 'pendiente');
  assert.equal(rows.find((r) => r.id === ids.w1).tercero, 'Operario Test');
  assert.equal(rows.find((r) => r.id === ids.c1).tercero, 'Cliente Prueba');
  // Suggestion from history: Almacenes Test was assigned to project A before (m3).
  assert.equal(m1.suggestion.projectId, ids.pA);
  assert.match(m1.suggestion.reason, /registro anterior/);
  const s = await svc.pendingSummary();
  assert.equal(s.pendientes, 4);
  assert.equal(s.porTipo.material.pendientes, 2);
  assert.equal(s.importePendiente, '6141.00');
});

test('filters, sorting and pagination run server-side', async () => {
  assert.equal((await svc.listRecords({ type: 'material' })).total, 3);
  assert.equal((await svc.listRecords({ q: 'codos' })).total, 1);
  assert.equal((await svc.listRecords({ from: '2026-09-10', to: '2026-09-30' })).total, 2);
  assert.equal((await svc.listRecords({ min: '100', max: '1000' })).total, 3);
  assert.equal((await svc.listRecords({ project: ids.pA })).total, 1);
  const p = await svc.listRecords({ sort: 'importe', dir: 'asc', pageSize: 2, page: 2 });
  assert.deepEqual(p.rows.map((r) => Number(r.importe)), [121, 1000]);
  // Unknown sort keys never reach the SQL.
  assert.equal((await svc.listRecords({ sort: 'id; DROP TABLE x', dir: 'sideways' })).total, 5);
  await assert.rejects(svc.listRecords({ from: '1/1/2026' }), { status: 400 });
});

test('projects are found by name, code or address and never shown by uuid', async () => {
  const [p] = await svc.listProjects({ q: 'marbella' });
  assert.equal(p.label, 'Marbella — Reforma vivienda');
  assert.equal(p.code, 'P-TEST-1');
  assert.equal((await svc.listProjects({ q: 'P-TEST-2' }))[0].label, 'Antequera — Reforma cocina');
  assert.equal((await svc.listProjects({ q: 'Calle Prueba' }))[0].id, ids.pA);
  assert.equal((await svc.listProjects({ q: '%' })).length, 0, 'LIKE wildcards are escaped');
});

test('assigning writes the real project_id, audits it, and changes need a reason', async () => {
  await svc.assign({ type: 'material', id: ids.m1, projectId: ids.pB, actor: admin });
  assert.equal((await one('SELECT project_id FROM ledens.material_expenses WHERE id = $1', [ids.m1])).project_id, ids.pB);
  await assert.rejects(svc.assign({ type: 'material', id: ids.m1, projectId: ids.pA, actor: admin }), { status: 400, message: /motivo/ });
  await assert.rejects(svc.assign({ type: 'material', id: ids.m1, projectId: ids.pA, expectedProjectId: null, reason: 'x', actor: admin }), { status: 409 });
  await svc.assign({ type: 'material', id: ids.m1, projectId: ids.pA, expectedProjectId: ids.pB, reason: 'Era de Marbella', actor: admin });
  const h = await svc.history('material', ids.m1);
  assert.deepEqual(h.map((x) => x.action), ['Reasignar', 'Asignar']);
  assert.equal(h[0].old_label, 'Antequera — Reforma cocina');
  assert.equal(h[0].new_label, 'Marbella — Reforma vivienda');
  assert.equal(h[0].reason, 'Era de Marbella');
  assert.equal(h[0].actor_label, 'Admin Test');
  assert.equal(h[0].origin, 'manual');
  assert.ok((await one(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'Imputación a proyecto'`)).n >= 2);
  await assert.rejects(svc.assign({ type: 'material', id: ids.m1, projectId: '00000000-0000-0000-0000-000000000000', reason: 'x', actor: admin }), { status: 400 });
});

test('bulk assignment reports exactly which records changed and which did not', async () => {
  const r = await svc.bulk({ action: 'assign', projectId: ids.pB, actor: admin, items: [
    { type: 'material', id: ids.m2 },
    { type: 'material', id: ids.m1 }, // already assigned, no reason → refused alone
    { type: 'material', id: '11111111-1111-1111-1111-111111111111' },
    { type: 'nada', id: ids.m2 },
  ] });
  assert.equal(r.ok, 1);
  assert.equal(r.failed, 3);
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, false, false]);
  assert.match(r.results[1].error, /motivo/);
  assert.equal((await one('SELECT project_id FROM ledens.material_expenses WHERE id = $1', [ids.m2])).project_id, ids.pB);
  assert.equal((await one('SELECT project_id FROM ledens.material_expenses WHERE id = $1', [ids.m1])).project_id, ids.pA, 'failed item untouched');
});

test('a worker payment split across projects keeps its original amount', async () => {
  await assert.rejects(svc.distribute({ type: 'trabajador', id: ids.w1, actor: admin,
    parts: [{ projectId: ids.pA, amount: '700' }, { projectId: ids.pB, amount: '400' }] }), { status: 400, message: /supera/ });
  await assert.rejects(svc.distribute({ type: 'trabajador', id: ids.w1, actor: admin,
    parts: [{ projectId: ids.pA, amount: '-100' }] }), { status: 400 });
  await svc.distribute({ type: 'trabajador', id: ids.w1, actor: admin, parts: [{ projectId: ids.pA, amount: '600' }] });
  let rec = await svc.getRecord('trabajador', ids.w1);
  assert.equal(rec.estado, 'parcial');
  assert.ok((await svc.listRecords({ pending: true })).rows.some((x) => x.id === ids.w1), 'a partial split is still pending');
  await svc.distribute({ type: 'trabajador', id: ids.w1, actor: admin, reason: 'Repartido entre dos obras',
    parts: [{ projectId: ids.pA, amount: '600' }, { projectId: ids.pB, amount: '400.00' }] });
  rec = await svc.getRecord('trabajador', ids.w1);
  assert.equal(rec.estado, 'asignado');
  assert.equal(rec.project_id, null);
  assert.equal(rec.distribucion.length, 2);
  assert.equal((await one('SELECT sum(amount) AS s FROM ledens.project_allocations WHERE source_id = $1', [ids.w1])).s, '1000.00');
  assert.equal((await one('SELECT amount FROM ledens.worker_payments WHERE id = $1', [ids.w1])).amount, '1000', 'source row untouched');
});

test('the database itself refuses a split above the record amount or next to a project_id', async () => {
  await assert.rejects(db.query(`INSERT INTO ledens.project_allocations (source_type, source_id, project_id, amount) VALUES ('material', $1, $2, 500)`, [ids.m2, ids.pA]));
  await db.exec('BEGIN');
  try {
    await db.query(`UPDATE ledens.material_expenses SET project_id = NULL WHERE id = $1`, [ids.m2]);
    await db.query(`INSERT INTO ledens.project_allocations (source_type, source_id, project_id, amount) VALUES ('material', $1, $2, 15)`, [ids.m2, ids.pA]);
    await db.query(`INSERT INTO ledens.project_allocations (source_type, source_id, project_id, amount) VALUES ('material', $1, $2, 15)`, [ids.m2, ids.pB]);
    await assert.rejects(db.exec('COMMIT'), /supera/);
  } finally { await db.exec('ROLLBACK').catch(() => {}); }
  assert.equal((await one('SELECT project_id FROM ledens.material_expenses WHERE id = $1', [ids.m2])).project_id, ids.pB);
});

test('review flags are separate from assignments and a confirmed assignment resolves them', async () => {
  await svc.setReview({ type: 'cliente', id: ids.c1, needsReview: true, note: 'Comprobar con el cliente', actor: admin });
  assert.equal((await svc.getRecord('cliente', ids.c1)).estado, 'revision');
  assert.equal((await svc.listRecords({ estado: 'revision' })).total, 1);
  await svc.assign({ type: 'cliente', id: ids.c1, projectId: ids.pA, actor: admin });
  const rec = await svc.getRecord('cliente', ids.c1);
  assert.equal(rec.estado, 'asignado');
  assert.deepEqual(rec.historial.map((h) => h.action), ['Asignar', 'Marcar para revisión']);
});

test('automation never invents or overwrites a project: no evidence means a suggestion only', async () => {
  const m4 = (await one(`INSERT INTO ledens.material_expenses (description, quantity, unit_price, total, occurred_on) VALUES ('Arena', 1, 30, 30, '2026-10-01') RETURNING id`)).id;
  assert.deepEqual(await svc.automaticImputation({ type: 'material', id: m4, projectId: ids.pB }), { applied: false, suggested: true });
  let rec = await svc.getRecord('material', m4);
  assert.equal(rec.project_id, null);
  assert.equal(rec.estado, 'pendiente');
  assert.equal(rec.suggestion.projectId, ids.pB);
  assert.equal(rec.suggestion.reason, 'Sugerencia de la automatización');
  assert.deepEqual(await svc.automaticImputation({ type: 'material', id: m4, projectId: ids.pB, evidence: 'Referencia de obra P-TEST-2 en la factura' }), { applied: true, suggested: false });
  rec = await svc.getRecord('material', m4);
  assert.equal(rec.project_id, ids.pB);
  assert.equal(rec.historial[0].origin, 'automatica');
  await assert.rejects(svc.automaticImputation({ type: 'material', id: m4, projectId: ids.pA, evidence: 'otra' }), { status: 409 });
  await db.query('DELETE FROM ledens.imputation_audit WHERE source_id = $1', [m4]);
  await db.query('DELETE FROM ledens.imputation_reviews WHERE source_id = $1', [m4]);
  await db.query('DELETE FROM ledens.material_expenses WHERE id = $1', [m4]);
});

test('profitability adds splits without duplication and keeps cobros apart from income', async () => {
  const r = await svc.profitability(ids.pA);
  assert.equal(r.project.label, 'Marbella — Reforma vivienda');
  // pA: m1 121 + m3 100 materials; 600 of w1; c1 5000 cobro.
  assert.equal(r.kpis.materiales, '221.00');
  assert.equal(r.kpis.trabajadores, '600.00');
  assert.equal(r.kpis.costeTotal, '821.00');
  assert.equal(r.kpis.cobros, '5000.00');
  assert.equal(r.kpis.presupuesto, '5000.00', 'only the accepted version (v2), not the rejected v1');
  assert.equal(r.kpis.margenPrevisto, '4179.00');
  assert.ok(r.noDisponibles.some((n) => n.kpi === 'Ingresos reconocidos'));
  const pB = await svc.profitability(ids.pB);
  assert.equal(pB.kpis.trabajadores, '400.00');
  assert.equal(pB.kpis.presupuesto, null, 'no budget → no invented figure');
  const fon = r.presupuestoVsCoste.find((x) => x.categoria === 'Fontanería');
  assert.deepEqual(fon, { categoria: 'Fontanería', presupuesto: '3000.00', coste: '121.00' });
  assert.ok(r.evolucion.some((e) => e.mes === '2026-09' && e.type === 'cliente'));
});

test('record detail carries the document, a safe link and the bank movement', async () => {
  const rec = await svc.getRecord('material', ids.m1);
  assert.equal(rec.documento.numerodocumento, 'F-001');
  assert.match(rec.documento.archivo, /^https:\/\/ledenses\.sharepoint\.com\//);
  assert.equal(rec.movimiento.source_id, '3T2026-001');
  assert.equal(rec.movimiento.bank_account, 'Cuenta test');
  assert.equal(rec.movimiento.difference, '-121');
  assert.equal(safeDocumentUrl('javascript:alert(1)'), null);
  assert.equal(safeDocumentUrl('https://evil.example/sharepoint.com/x.pdf'), null);
});

test('reconciliation lists bank movements still to be matched', async () => {
  const r = await svc.reconciliation({ view: 'movimientos' });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].source_id, '3T2026-001');
  const d = await svc.reconciliation({ view: 'documentos' });
  assert.equal(d.total, 0, 'the only document is Revisado → OK');
});

test('API: clients and anonymous users are refused, jefes and admins work', async () => {
  assert.equal((await call('GET', '/registros', null, null)).status, 401);
  assert.equal((await call('GET', '/registros', null, 'client')).status, 403);
  assert.equal((await call('PUT', `/registros/material/${ids.m2}/proyecto`, { projectId: ids.pA, reason: 'x' }, 'client')).status, 403);
  assert.equal((await one('SELECT project_id FROM ledens.material_expenses WHERE id = $1', [ids.m2])).project_id, ids.pB, 'refused call changed nothing');
  assert.equal((await call('GET', '/resumen', null, 'admin')).status, 200);
  const res = await call('GET', '/registros?pendientes=1&tipo=trabajador');
  assert.equal(res.status, 200);
});

test('API: assignment round trip, validation and conflict', async () => {
  assert.equal((await call('PUT', `/registros/otra/${ids.m2}/proyecto`, { projectId: ids.pA })).status, 400);
  assert.equal((await call('PUT', `/registros/material/${ids.m2}/proyecto`, { projectId: 'no-uuid' })).status, 400);
  assert.equal((await call('PUT', `/registros/material/${ids.m2}/proyecto`, { projectId: ids.pA, expectedProjectId: null, reason: 'x' })).status, 409);
  const ok = await call('PUT', `/registros/material/${ids.m2}/proyecto`, { projectId: ids.pA, expectedProjectId: ids.pB, reason: 'Corrección' });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.record.project_id, ids.pA);
  assert.equal(body.record.project_label, 'Marbella — Reforma vivienda');
  const lote = await call('POST', '/registros/lote', { action: 'review', note: 'Revisar', items: [{ type: 'material', id: ids.m2 }] });
  assert.equal((await lote.json()).ok, 1);
  const prof = await call('GET', `/proyectos/${ids.pA}/rentabilidad`);
  assert.equal(prof.status, 200);
  assert.equal((await call('GET', '/proyectos/no-uuid/rentabilidad')).status, 404);
});
