import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createCapitalRouter } from '../src/routes/capital.js';
import { hashToken } from '../src/auth/sessions.js';

// Ledens Capital on PGlite (migrations 024–025): who sees what, the five
// states of a participation with four-eyes allocation, and the realised
// portfolio. Sessions are real (cookie + sessions row) so the second-factor
// guard is exercised too.
const ORIGIN = 'https://capital.test';
let db, pool, server, base;
const u = {};
let projectId, planId, commitmentA, commitmentB;

const plan = {
  strategy: 'flip',
  capital: { manager: 140000, external: 200000 },
  flip: { acquisition: 260000, renovation: 45000, otherCosts: 27500, exitCostsBudget: 7500, salePrice: 410000, months: 12, delayCostPerMonth: 1200 },
  structure: { model: 'hurdle', hurdlePct: 8, managerSharePct: 20 },
  scenarios: [
    { id: 'base', name: 'Base', overrides: {} },
    { id: 'estres', name: 'Estrés', overrides: { salePrice: 345000, renovationOverrunPct: 30, months: 20 } },
  ],
  requiredAcknowledgements: [
    { key: 'memorandum', version: 'v3', title: 'Memorándum de inversión' },
    { key: 'riesgos', version: 'v1', title: 'Divulgación de riesgos' },
  ],
};
const acks = plan.requiredAcknowledgements.map(({ key, version }) => ({ key, version }));

async function session(user, { mfa = true } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(`INSERT INTO sessions (user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1,$2, now() + interval '1 day', ${mfa ? 'now()' : 'NULL'})`, [user.id, hashToken(token)]);
  return `ledens_session=${token}`;
}
const call = async (who, p, { method, body, origin = ORIGIN } = {}) => {
  const r = await fetch(`${base}${p}`, {
    method: method || (body ? 'POST' : 'GET'), body: body ? JSON.stringify(body) : undefined,
    headers: { origin, 'content-type': 'application/json', ...(who ? { cookie: who.cookie } : {}) },
  });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`
    CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text NOT NULL, password_hash text,
      email_verified boolean NOT NULL DEFAULT false, role text NOT NULL DEFAULT 'client', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
    CREATE TABLE sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, user_agent text, ip text);
    CREATE TABLE audit_log(id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);`);
  for (const m of ['024_mfa_totp.sql', '025_capital_core.sql']) await db.exec(await fs.readFile(new URL(`../src/db/migrations/${m}`, import.meta.url), 'utf8'));
  for (const [k, email] of [['sa', 'sa@capital.test'], ['im', 'inversiones@capital.test'], ['comp', 'cumplimiento@capital.test'], ['fin', 'finanzas@capital.test'],
    ['a', 'carmen@capital.test'], ['b', 'javier@capital.test'], ['nadie', 'nadie@capital.test']]) {
    u[k] = (await db.query('INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id, email, name', [email, k])).rows[0];
  }
  await db.query(`INSERT INTO capital.staff_roles (user_id, role) VALUES ($1,'super_admin'),($2,'investment_manager'),($3,'compliance'),($4,'finance_manager')`,
    [u.sa.id, u.im.id, u.comp.id, u.fin.id]);
  for (const k of Object.keys(u)) u[k].cookie = await session(u[k]);
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  app.use('/api/capital', createCapitalRouter({ pool, origin: ORIGIN }));
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: String(err.message) }); });
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/capital`;
});
after(async () => { server?.close(); await db?.close(); });

test('the second factor and Capital membership come first', async () => {
  assert.equal((await call(null, '/me')).body.code, 'login_requerido');
  const noMfa = { cookie: await session(u.a, { mfa: false }) };
  assert.equal((await call(noMfa, '/me')).body.code, 'mfa_alta_requerida');
  assert.equal((await call(u.nadie, '/me')).body.code, 'sin_acceso');
  assert.deepEqual((await call(u.im, '/me')).body.staffRoles, ['investment_manager']);
  assert.equal((await call(u.im, '/admin/miembros', { body: { email: 'x@capital.test' }, origin: 'https://evil.test' })).status, 403);
});

test('members are created by the team and approved only by compliance', async () => {
  let r = await call(u.a, '/admin/miembros', { body: { email: 'otro@capital.test' } });
  assert.equal(r.status, 403, 'an investor cannot add members');
  r = await call(u.im, '/admin/miembros', { body: { email: u.a.email, name: 'No cambia' } });
  assert.equal(r.status, 201);
  u.a.member = r.body.id;
  assert.equal((await db.query('SELECT name FROM users WHERE id=$1', [u.a.id])).rows[0].name, 'a', 'an existing account never changes');
  u.b.member = (await call(u.im, '/admin/miembros', { body: { email: u.b.email } })).body.id;
  assert.equal((await call(u.im, '/admin/miembros', { body: { email: u.b.email } })).status, 409);

  assert.equal((await call(u.a, '/oportunidades')).body.code, 'cuenta_invited');
  assert.equal((await call(u.im, `/admin/miembros/${u.a.member}/estado`, { method: 'PATCH', body: { status: 'approved' } })).status, 403);
  for (const m of [u.a.member, u.b.member]) {
    assert.equal((await call(u.comp, `/admin/miembros/${m}/estado`, { method: 'PATCH', body: { status: 'approved' } })).status, 200);
  }
  assert.equal((await call(u.comp, `/admin/miembros/${u.b.member}/estado`, { method: 'PATCH', body: { status: 'suspended' } })).status, 400, 'suspending needs a reason');
});

test('a project opens only with a plan approved by someone other than its author', async () => {
  let r = await call(u.im, '/admin/proyectos', { body: {
    code: 'LC-2026-07', name: 'Marbella Golden Mile', locationPublic: 'Marbella · Milla de Oro', locationFull: 'Calle Ficticia 1, Marbella',
    strategy: 'flip', managerEntity: 'Ledens Marbella I, S.L.', externalTarget: 200000, managerContribution: 140000, minContribution: 25000 } });
  assert.equal(r.status, 201);
  projectId = r.body.id;
  assert.equal((await call(u.im, `/admin/proyectos/${projectId}/planes`, { body: { plan: { ...plan, capital: { manager: 1, external: 1 } } } })).status, 400);
  r = await call(u.im, `/admin/proyectos/${projectId}/planes`, { body: { plan } });
  planId = r.body.id;
  assert.equal(r.body.version, 1);
  assert.equal((await call(u.im, `/admin/proyectos/${projectId}/estado`, { method: 'PATCH', body: { status: 'open' } })).status, 409, 'no approved plan yet');
  assert.equal((await call(u.im, `/admin/proyectos/${projectId}/planes/${planId}/aprobar`, { body: {} })).status, 409, 'four eyes');
  assert.equal((await call(u.sa, `/admin/proyectos/${projectId}/planes/${planId}/aprobar`, { body: {} })).status, 200);
  assert.equal((await call(u.im, `/admin/proyectos/${projectId}/estado`, { method: 'PATCH', body: { status: 'open' } })).status, 200);
  assert.equal((await call(u.im, `/admin/proyectos/${projectId}/accesos`, { body: { memberId: u.a.member } })).status, 201);
});

test('only invited members see an opportunity; the figures come from the server', async () => {
  assert.deepEqual((await call(u.b, '/oportunidades')).body, []);
  assert.equal((await call(u.b, `/proyectos/${projectId}`)).status, 404);
  let r = await call(u.a, '/oportunidades');
  assert.equal(r.body.length, 1);
  assert.deepEqual(r.body[0].funding, { target: 200000, signed: 0, allocated: 0, inReview: 0, available: 200000 });
  assert.equal(r.body[0].baseScenario.simpleReturn.toFixed(4), '0.1807');
  r = await call(u.a, `/proyectos/${projectId}`);
  assert.equal(r.body.locationFull, null, 'full address only after an approved allocation');
  assert.equal(r.body.scenarios.length, 2);
  r = await call(u.a, `/proyectos/${projectId}/simular`, { body: { amount: 25000, scenarioId: 'estres' } });
  assert.equal(r.body.result, -1330.88);
  assert.equal(r.body.estimate, true);
  assert.equal((await call(u.a, `/proyectos/${projectId}/simular`, { body: { amount: 25000, overrides: { acquisition: 1 } } })).status, 400);
});

test('a request needs every document acknowledged, the minimum and available allocation', async () => {
  let r = await call(u.a, `/proyectos/${projectId}/solicitudes`, { body: { amount: 25000 } });
  assert.equal(r.body.code, 'documentos_pendientes');
  assert.equal((await call(u.a, `/proyectos/${projectId}/solicitudes`, { body: { amount: 10000, acknowledgements: acks } })).status, 400, 'below the minimum');
  r = await call(u.a, `/proyectos/${projectId}/solicitudes`, { body: { amount: 25000, acknowledgements: acks } });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'requested');
  commitmentA = r.body.id;
  assert.equal((await call(u.a, `/proyectos/${projectId}/solicitudes`, { body: { amount: 25000, acknowledgements: acks } })).body.code, 'solicitud_abierta');
  assert.equal((await db.query('SELECT count(*)::int n FROM capital.acknowledgements WHERE commitment_id=$1', [commitmentA])).rows[0].n, 2);
  r = await call(u.a, '/oportunidades');
  assert.equal(r.body[0].funding.inReview, 25000);
  assert.equal(r.body[0].funding.available, 175000);

  await call(u.im, `/admin/proyectos/${projectId}/accesos`, { body: { memberId: u.b.member } });
  assert.equal((await call(u.b, `/proyectos/${projectId}/solicitudes`, { body: { amount: 180000, acknowledgements: acks } })).body.code, 'sin_disponible');
  commitmentB = (await call(u.b, `/proyectos/${projectId}/solicitudes`, { body: { amount: 30000, acknowledgements: acks } })).body.id;
});

test('allocation takes two different people with the right roles', async () => {
  assert.equal((await call(u.comp, `/admin/solicitudes/${commitmentA}/asignacion`, { body: { amount: 20000 } })).status, 403, 'compliance signs second, not first');
  let r = await call(u.im, `/admin/solicitudes/${commitmentA}/asignacion`, { body: { amount: 20000 } });
  assert.equal(r.body.step, 1);
  assert.equal((await call(u.im, `/admin/solicitudes/${commitmentA}/asignacion`, { body: {} })).status, 403);
  r = await call(u.comp, `/admin/solicitudes/${commitmentA}/asignacion`, { body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'allocated');
  assert.equal(r.body.allocatedAmount, 20000, 'the amount of the first signature');

  // A super admin may sign either step, never both.
  assert.equal((await call(u.sa, `/admin/solicitudes/${commitmentB}/asignacion`, { body: {} })).body.step, 1);
  r = await call(u.sa, `/admin/solicitudes/${commitmentB}/asignacion`, { body: {} });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /otra persona/);

  assert.equal((await call(u.a, `/proyectos/${projectId}`)).body.locationFull, 'Calle Ficticia 1, Marbella');
  assert.equal((await call(u.b, `/proyectos/${projectId}`)).body.locationFull, null);
  r = await call(u.im, `/admin/proyectos/${projectId}/solicitudes`);
  assert.equal(r.body.find((c) => c.id === commitmentA).approvals.length, 2);
});

test('signed, paid, reconciled and confirmed: only then is it an active investment', async () => {
  assert.equal((await call(u.fin, `/admin/solicitudes/${commitmentA}/aportaciones`, { body: { amount: 20000, bankReference: 'LC07-014' } })).status, 409, 'not signed yet');
  assert.equal((await call(u.im, `/admin/solicitudes/${commitmentA}/firma`, { body: { contractRef: 'LC-2026-07-014' } })).body.status, 'signed');
  assert.equal((await call(u.im, `/admin/solicitudes/${commitmentA}/aportaciones`, { body: { amount: 20000, bankReference: 'x' } })).status, 403, 'cash is finance');
  const mov = (await call(u.fin, `/admin/solicitudes/${commitmentA}/aportaciones`, { body: { amount: 20000, bankReference: 'LC07-014', valueDate: '2026-11-20' } })).body;

  let p = (await call(u.a, '/cartera')).body;
  assert.equal(p.realised.contributed, 0, 'received is not reconciled');
  assert.equal(p.realised.committed, 20000);
  assert.equal(p.realised.activeInvestments, 0);
  assert.equal((await call(u.im, `/admin/solicitudes/${commitmentA}/confirmar`, { body: {} })).status, 409);

  const r = await call(u.fin, `/admin/movimientos/${mov.id}/conciliar`, { body: {} });
  assert.equal(r.body.commitment.status, 'funded');
  assert.equal((await call(u.fin, `/admin/movimientos/${mov.id}/conciliar`, { body: {} })).status, 409);
  assert.equal((await call(u.im, `/admin/solicitudes/${commitmentA}/confirmar`, { body: {} })).body.status, 'effective');

  p = (await call(u.a, '/cartera')).body;
  assert.equal(p.realised.contributed, 20000);
  assert.equal(p.realised.outstanding, 20000);
  assert.equal(p.realised.activeInvestments, 1);
  assert.equal(p.realised.realisedReturn, null, 'nothing settled yet');
  assert.equal(p.positions.length, 1);
});

test('investors only ever touch their own rows', async () => {
  const p = (await call(u.b, '/cartera')).body;
  assert.deepEqual(p.positions.map((x) => x.id), [commitmentB]);
  assert.equal((await call(u.a, `/solicitudes/${commitmentB}/retirar`, { body: {} })).status, 404);
  assert.equal((await call(u.a, `/solicitudes/${commitmentA}/retirar`, { body: {} })).status, 409, 'effective cannot be withdrawn');
  assert.equal((await call(u.b, `/solicitudes/${commitmentB}/retirar`, { body: {} })).body.status, 'withdrawn');
  assert.equal((await call(u.a, '/admin/auditoria')).status, 403);
  const log = (await call(u.comp, '/admin/auditoria')).body.map((r) => r.action);
  for (const a of ['capital.commitment_requested', 'capital.allocation_step1', 'capital.allocation_approved', 'capital.contract_signed', 'capital.movement_reconciled', 'capital.participation_effective', 'capital.commitment_withdrawn']) {
    assert.ok(log.includes(a), a);
  }
});
