import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, scenarioTable, validatePlan, EngineError } from '../src/capital/engine.js';

// The control values of design-source/ledens-capital/SPEC.md §5 (Marbella
// Golden Mile, fictional) and every outcome the structures must support:
// gain, break-even, delay, overrun, shortfall, partial recovery and total loss.
const marbella = () => ({
  strategy: 'flip',
  capital: { manager: 140000, external: 200000 },
  flip: { acquisition: 260000, renovation: 45000, otherCosts: 27500, exitCostsBudget: 7500, salePrice: 410000, months: 12, delayCostPerMonth: 1200 },
  structure: { model: 'hurdle', hurdlePct: 8, managerSharePct: 20 },
  scenarios: [
    { id: 'conservador', name: 'Conservador', overrides: { salePrice: 385000, renovationOverrunPct: 15, months: 15 } },
    { id: 'base', name: 'Base', overrides: {} },
    { id: 'optimista', name: 'Optimista', overrides: { salePrice: 430000, renovationOverrunPct: -5, months: 11 } },
    { id: 'estres', name: 'Estrés', overrides: { salePrice: 345000, renovationOverrunPct: 30, months: 20 } },
  ],
});

test('base scenario: 70.000 € project result, 29.517,65 € for a 25.000 € contribution', () => {
  const r = simulate(marbella(), { amount: 25000, scenarioId: 'base' });
  assert.equal(r.project.result, 70000);
  assert.equal(r.project.poolResult, 36141.18);
  assert.equal(r.totalDistribution, 29517.65);
  assert.equal(r.capitalReturned, 25000);
  assert.equal(r.simpleReturn.toFixed(4), '0.1807');
  assert.equal(r.annualizedReturn.toFixed(4), '0.1807');
  assert.equal(r.estimate, true);
});

test('conservative: delay and overrun eat the excess above the hurdle', () => {
  const r = simulate(marbella(), { amount: 25000, scenarioId: 'conservador' });
  assert.equal(r.project.result, 34650);
  assert.equal(r.result, 2538.24);
  assert.equal(r.years, 1.25);
});

test('stress: loss shared pro rata, capped at what was contributed', () => {
  const r = simulate(marbella(), { amount: 25000, scenarioId: 'estres' });
  assert.equal(r.project.result, -18100);
  assert.equal(r.result, -1330.88);
  assert.equal(r.shortfall, true);
  assert.equal(r.annualizedReturn, null, 'no annualised figure for a loss');
});

test('capital first is a priority, not a guarantee: the manager absorbs the loss first, until it cannot', () => {
  const plan = marbella();
  plan.structure = { model: 'capital_first' };
  assert.equal(simulate(plan, { amount: 25000, scenarioId: 'estres' }).result, 0);
  const crash = simulate(plan, { amount: 25000, overrides: { salePrice: 150000 } });
  assert.equal(crash.capitalReturned, 18750, 'only 150.000 € to share: partial recovery');
  assert.equal(crash.project.managerCapital, 0);
});

test('break-even and total loss', () => {
  const even = simulate(marbella(), { amount: 25000, overrides: { salePrice: 340000 } });
  assert.equal(even.result, 0);
  assert.equal(even.shortfall, false);
  const zero = simulate(marbella(), { amount: 25000, overrides: { salePrice: 0 } });
  assert.equal(zero.totalDistribution, 0);
  assert.equal(zero.result, -25000, 'never more than the contribution');
});

test('proportional: no hurdle, no manager share', () => {
  const plan = marbella();
  plan.structure = { model: 'proportional' };
  assert.equal(simulate(plan, { amount: 25000 }).result, 5147.06);
});

test('rental with exit: interim rents and gross/net figures', () => {
  const plan = {
    strategy: 'rental', capital: { manager: 105000, external: 120000 },
    rental: { annualRent: 24000, occupancyPct: 100, operatingCostPct: 25, years: 5, exitPrice: 260000, exitCostPct: 3 },
    structure: { model: 'hurdle', hurdlePct: 8, managerSharePct: 20 },
  };
  const r = simulate(plan, { amount: 20000 });
  assert.equal(r.interimDistributions, 8000, '18.000 €/año × 5 × 120/225 × 1/6');
  assert.equal(r.years, 5);
  assert.ok(r.totalDistribution > 20000);
});

test('rejects what a client must not change or could not mean', () => {
  assert.throws(() => simulate(marbella(), { amount: 25000, overrides: { acquisition: 1 } }), EngineError);
  assert.throws(() => simulate(marbella(), { amount: 25000, overrides: { months: 0 } }), EngineError);
  assert.throws(() => simulate(marbella(), { amount: 0 }), EngineError);
  assert.throws(() => simulate(marbella(), { amount: 250000 }), EngineError, 'above the external target');
  assert.throws(() => simulate(marbella(), { amount: 25000, scenarioId: 'otro' }), EngineError);
  assert.throws(() => validatePlan({ ...marbella(), structure: { model: 'guaranteed' } }), EngineError);
  assert.equal(scenarioTable(marbella(), 25000).length, 4);
});
