import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseScan, statusOf, STATUS, REQUEST_STATUS, FILTERS, ADMIN_FILTERS, can, whereLine, fmtDate, alwaysBlocks, drafts, INCIDENT_KINDS } from '../src/components/plataforma/herramientas/labels.js';

// Pure helpers of Ledens Tools (no browser, no React): `npm test` in ledens/frontend.
// The screens themselves are checked with Playwright (see the PR's test report).

test('a scanned label or a typed code opens the right thing', () => {
  assert.deepEqual(parseScan('https://ambitious-island-05d1d8a03.2.azurestaticapps.net/h/Ab3_xY-9kLmN2p'), { token: 'Ab3_xY-9kLmN2p' });
  assert.deepEqual(parseScan('http://localhost:5173/h/Ab3_xY-9kLmN2p?x=1'), { token: 'Ab3_xY-9kLmN2p' });
  assert.deepEqual(parseScan('  led-tool-000042 '), { code: 'LED-TOOL-000042' });
  assert.deepEqual(parseScan('KIT-FONTANERIA-001'), { code: 'KIT-FONTANERIA-001' });
  assert.deepEqual(parseScan('Ab3_xY-9kLmN2p'), { token: 'Ab3_xY-9kLmN2p' }, 'a bare token from a USB scanner');
  assert.equal(parseScan(''), null);
  assert.equal(parseScan('https://evil.test/<script>'), null);
  assert.equal(parseScan('hola mundo'), null);
});

test('every status the backend can return has a label and colours', () => {
  for (const s of ['disponible', 'asignada', 'reservada', 'en_traslado', 'averiada', 'en_mantenimiento', 'perdida', 'robada', 'baja']) {
    assert.ok(STATUS[s]?.label && STATUS[s].bg && STATUS[s].fg, s);
  }
  assert.equal(statusOf('desconocido').label, 'desconocido', 'an unknown status is shown, never crashes');
  for (const s of ['borrador', 'solicitada', 'en_revision', 'aprobada', 'parcialmente_aprobada', 'rechazada', 'en_preparacion', 'en_traslado', 'entregada', 'finalizada', 'cancelada']) assert.ok(REQUEST_STATUS[s], s);
});

test('filters match the estados the API accepts', () => {
  const api = ['todas', 'disponibles', 'mi_obra', 'otras_obras', 'reservadas', 'averiadas', 'en_traslado', 'asignadas', 'baja'];
  for (const [k] of [...FILTERS, ...ADMIN_FILTERS]) assert.ok(api.includes(k), k);
  assert.deepEqual(FILTERS.map(([k]) => k), ['todas', 'disponibles', 'mi_obra', 'otras_obras', 'reservadas', 'averiadas']);
});

test('permissions and blocking incidents mirror the backend', () => {
  assert.equal(can(['tools.read'], 'tools.read'), true);
  assert.equal(can(['tools.read'], 'tools.manage'), false);
  assert.equal(can(undefined, 'tools.read'), false);
  assert.deepEqual(INCIDENT_KINDS.filter((k) => k[3]).map((k) => k[0]), ['averia', 'rotura', 'perdida', 'robo']);
  assert.equal(alwaysBlocks('accesorio_faltante'), false);
});

test('where a tool is, in one line, and dates in Spanish format', () => {
  assert.equal(whereLine({ location: { name: 'Almacén central' } }), 'Almacén central');
  assert.equal(whereLine({ location: { name: 'P1 · Casa', project: { name: 'Casa Marbella' } }, custodian: { name: 'Oficial Pérez' } }), 'Casa Marbella · con Oficial Pérez');
  assert.equal(whereLine({ location: { name: 'Otra obra', hidden: true } }), 'Otra obra');
  assert.equal(fmtDate('2026-11-28'), '28/11/2026');
  assert.equal(fmtDate(null), '—');
});

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
beforeEach(() => { globalThis.localStorage = memory(); });

test('drafts survive a reload and never break the form when storage is unavailable', () => {
  drafts.save('solicitud', { projectId: 'p', items: [{ typeId: 't', quantity: 2 }] });
  assert.deepEqual(drafts.load('solicitud'), { projectId: 'p', items: [{ typeId: 't', quantity: 2 }] });
  drafts.clear('solicitud');
  assert.equal(drafts.load('solicitud'), null);
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => drafts.save('x', { a: 1 }));
  assert.equal(drafts.load('x'), null);
  delete globalThis.localStorage;
  assert.equal(drafts.load('x'), null);
});
