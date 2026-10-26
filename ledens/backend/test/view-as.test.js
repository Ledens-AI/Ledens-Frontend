import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { viewAs } from '../src/auth/viewAs.js';
import { createFinanzasRouter } from '../src/routes/finanzas.js';
// «Ver como» without a database: fake sessions and users.
const users = {
  'a0000000-0000-4000-8000-000000000001': { id: 'a0000000-0000-4000-8000-000000000001', role: 'admin', name: 'Admin' },
  'a0000000-0000-4000-8000-000000000002': { id: 'a0000000-0000-4000-8000-000000000002', role: 'jefe', name: 'Ana Jefe' },
  'a0000000-0000-4000-8000-000000000003': { id: 'a0000000-0000-4000-8000-000000000003', role: 'client', name: 'Cliente' },
};
const [ADMIN, JEFE, CLIENT] = Object.keys(users);
const findUser = async (id) => users[id] || null;
const authenticate = (req, _res, next) => { req.user = { ...users[req.get('x-test-user')] }; next(); };
const serve = async (app, fn) => { const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); } };
const call = (base, path, who, as, method = 'GET') => fetch(base + path, { method, headers: { 'x-test-user': who, 'content-type': 'application/json', origin: 'https://ledens.test', ...(as ? { 'x-ledens-view-as': as } : {}) }, body: method === 'GET' ? undefined : '{}' });

test('only an admin may view as someone, only to read, and the request runs as that user', async () => {
  const app = express(); app.use(express.json());
  app.all('/who', authenticate, viewAs({ findUser }), (req, res) => res.json({ user: req.user.id, viewer: req.viewer?.id ?? null }));
  await serve(app, async (base) => {
    assert.deepEqual(await (await call(base, '/who', ADMIN)).json(), { user: ADMIN, viewer: null }, 'no header: unchanged');
    assert.deepEqual(await (await call(base, '/who', ADMIN, JEFE)).json(), { user: JEFE, viewer: ADMIN });
    assert.equal((await call(base, '/who', JEFE, ADMIN)).status, 403, 'a jefe cannot');
    assert.equal((await call(base, '/who', CLIENT, JEFE)).status, 403, 'a client cannot');
    assert.equal((await call(base, '/who', ADMIN, JEFE, 'POST')).status, 403, 'read-only');
    assert.equal((await call(base, '/who', ADMIN, 'not-a-uuid')).status, 400);
    assert.equal((await call(base, '/who', ADMIN, 'a0000000-0000-4000-8000-000000000009')).status, 404);
  });
});

test('Gestión financiera answers as the viewed user: a jefe reads, a client is refused, writes are refused', async () => {
  const service = { employees: async () => [{ id: 'e1', name: 'Trabajador' }] };
  const app = express(); app.use(express.json());
  app.use('/api/finanzas', createFinanzasRouter({ service, authenticate, findUser, origin: 'https://ledens.test' }));
  await serve(app, async (base) => {
    assert.equal((await call(base, '/api/finanzas/trabajadores', ADMIN, JEFE)).status, 200);
    assert.equal((await call(base, '/api/finanzas/trabajadores', ADMIN, CLIENT)).status, 403, 'as a client: no finance');
    assert.equal((await call(base, '/api/finanzas/gestion-proyectos', ADMIN, JEFE, 'POST')).status, 403);
    assert.equal((await call(base, '/api/finanzas/trabajadores', JEFE, ADMIN)).status, 403);
    assert.equal((await call(base, '/api/finanzas/trabajadores', JEFE)).status, 200, 'without the header nothing changes');
  });
});
