import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nifProblem, clientProblems, suggestions, parseCents, breakdown, toEuros, missingLabels } from '../src/components/plataforma/obras/facturas.js';

// Pure helpers of «Generar factura» (no browser, no React): `npm test` in ledens/frontend.

test('the CIF/NIF is checked like the backend does', () => {
  for (const ok of ['25333033M', '25333033-m', 'B19753805', 'X1234567L', 'H29123452', 'ESB19753805', 'FR40303265045']) assert.equal(nifProblem(ok), null, ok);
  assert.match(nifProblem('25333033A'), /letra/);
  assert.match(nifProblem('B19753806'), /control/);
  assert.match(nifProblem(''), /Indica/);
});

test('the client data says what is missing or wrong', () => {
  assert.deepEqual(clientProblems({ nombre: ' ', nif: '', direccion: '' }), { nombre: 'Obligatorio', nif: 'Obligatorio', direccion: 'Obligatorio' });
  assert.deepEqual(clientProblems({ nombre: 'Ana', nif: '25333033A', direccion: 'Antequera', email: 'x' }).email, 'Email no válido');
  assert.match(clientProblems({ nombre: 'Ana', nif: '25333033A', direccion: 'Antequera' }).nif, /letra/);
  assert.deepEqual(clientProblems({ nombre: 'Ana', nif: '25333033M', direccion: 'Antequera', telefono: '', email: '' }), {});
  assert.deepEqual(missingLabels(['nif', 'direccion']), ['CIF/NIF', 'dirección']);
});

test('20 %, 50 % and 100 % of what is still to be collected', () => {
  assert.deepEqual(suggestions(1517), [{ pct: 20, cents: 30340 }, { pct: 50, cents: 75850 }, { pct: 100, cents: 151700 }]);
  assert.deepEqual(suggestions('1517.01'), [{ pct: 20, cents: 30340 }, { pct: 50, cents: 75851 }, { pct: 100, cents: 151701 }]);
  assert.deepEqual(suggestions(0), []);
  assert.deepEqual(suggestions(-20), []);
  assert.deepEqual(suggestions(null), []);
});

test('amounts typed by hand and the VAT breakdown of the example invoice', () => {
  assert.equal(parseCents('1.200,00 €'), 120000);
  assert.equal(parseCents('758.5'), 75850);
  assert.equal(parseCents('0'), null);
  assert.equal(parseCents('12,345'), null);
  assert.equal(parseCents('abc'), null);
  assert.deepEqual(breakdown(120000, '21'), { base: 99174, iva: 20826, total: 120000 });
  assert.deepEqual(breakdown(75850, '10'), { base: 68955, iva: 6895, total: 75850 });
  assert.equal(toEuros(75850), '758.50');
});
