// Motor de cálculo de Ledens Capital: resultado de una operación y su reparto
// entre partícipes y gestor (design-source/ledens-capital/SPEC.md §5). Puro y
// sin base de datos: recibe los supuestos de una versión aprobada del plan
// (capital.plan_versions) y, si acaso, cambios de escenario, y devuelve cifras.
// Toda cifra que ve un inversor sale de aquí, nunca del navegador.
//
// Ninguna estructura garantiza la devolución del capital: con caja
// insuficiente se recupera solo una parte, y la pérdida de un partícipe nunca
// supera lo que aportó.

export class EngineError extends Error {
  constructor(message) { super(message); this.status = 400; }
}
const fail = (m) => { throw new EngineError(m); };

export const STRATEGIES = ['flip', 'rental', 'hybrid'];
export const MODELS = ['proportional', 'capital_first', 'hurdle'];

// Rangos que acepta una simulación: los mismos que las palancas del diseño,
// con algo de holgura. Fuera de ellos el resultado no tendría sentido.
const RANGES = {
  salePrice: [0, 100_000_000], renovationOverrunPct: [-50, 200], months: [1, 120], delayCostPerMonth: [0, 1_000_000],
  exitCostPct: [0, 20], financingCost: [0, 100_000_000], annualRent: [0, 10_000_000], occupancyPct: [0, 100],
  operatingCostPct: [0, 100], years: [1, 30], exitPrice: [0, 100_000_000], hurdlePct: [0, 50], managerSharePct: [0, 100],
};

const num = (v, key) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(`Valor no válido: ${key}`);
  const r = RANGES[key];
  if (r && (n < r[0] || n > r[1])) fail(`Fuera de rango: ${key}`);
  return n;
};
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Valida los supuestos de un plan. Forma (importes en euros, % en 0–100):
 * {
 *   strategy: 'flip' | 'rental' | 'hybrid',
 *   capital: { manager, external },           // aportación del gestor y objetivo de partícipes
 *   flip:   { acquisition, renovation, otherCosts, exitCostsBudget, salePrice, months, delayCostPerMonth, exitCostPct, financingCost },
 *   rental: { annualRent, occupancyPct, operatingCostPct, years, exitPrice, exitCostPct, financingCost },
 *   structure: { model: 'proportional' | 'capital_first' | 'hurdle', hurdlePct, managerSharePct },
 *   scenarios: [{ id, name, overrides: { … } }]
 * }
 * `hybrid` usa los dos bloques: rentas durante `rental.years` y venta final a `rental.exitPrice`.
 */
export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') fail('Plan no válido');
  if (!STRATEGIES.includes(plan.strategy)) fail('Estrategia no válida');
  const manager = num(plan.capital?.manager, 'capital.manager');
  const external = num(plan.capital?.external, 'capital.external');
  if (manager < 0 || external <= 0) fail('El capital de partícipes debe ser positivo');
  const s = plan.structure || {};
  if (!MODELS.includes(s.model)) fail('Estructura de distribución no válida');
  if (s.model === 'hurdle') { num(s.hurdlePct, 'hurdlePct'); num(s.managerSharePct, 'managerSharePct'); }
  if (plan.strategy === 'flip') {
    for (const k of ['acquisition', 'renovation', 'otherCosts', 'exitCostsBudget', 'salePrice', 'months']) num(plan.flip?.[k], `flip.${k}`);
  } else {
    for (const k of ['annualRent', 'occupancyPct', 'operatingCostPct', 'years', 'exitPrice']) num(plan.rental?.[k], `rental.${k}`);
  }
  const ids = new Set();
  for (const sc of plan.scenarios || []) {
    if (typeof sc.id !== 'string' || !sc.id || ids.has(sc.id)) fail('Escenario sin identificador único');
    ids.add(sc.id);
  }
  return plan;
}

// Los únicos supuestos que un escenario o una simulación pueden cambiar.
const LEVERS = {
  flip: ['salePrice', 'renovationOverrunPct', 'months', 'delayCostPerMonth', 'exitCostPct', 'financingCost'],
  rental: ['annualRent', 'occupancyPct', 'operatingCostPct', 'years', 'exitPrice', 'exitCostPct', 'financingCost'],
  structure: ['hurdlePct', 'managerSharePct'],
};

function inputs(plan, overrides = {}) {
  const rentalLike = plan.strategy !== 'flip';
  const block = rentalLike ? plan.rental : plan.flip;
  const levers = rentalLike ? LEVERS.rental : LEVERS.flip;
  const x = { renovationOverrunPct: 0, delayCostPerMonth: 0, exitCostPct: null, financingCost: 0, ...block };
  for (const k of Object.keys(overrides || {})) {
    if (levers.includes(k) || LEVERS.structure.includes(k)) x[k] = num(overrides[k], k);
    else if (k !== 'model') fail(`Supuesto no modificable: ${k}`);
  }
  const structure = { ...plan.structure };
  for (const k of LEVERS.structure) if (overrides?.[k] != null) structure[k] = num(overrides[k], k);
  return { x, structure };
}

/** Resultado del proyecto (antes de repartir) para unos supuestos. */
export function projectResult(plan, overrides) {
  const { x, structure } = inputs(plan, overrides);
  const capital = plan.capital.manager + plan.capital.external;
  let income, obligations, interim = 0, years;
  if (plan.strategy === 'flip') {
    // El capital aportado cubre el presupuesto del plan (incluidos los gastos
    // de salida presupuestados). De la venta salen solo las desviaciones.
    const exitCosts = x.exitCostPct == null ? x.exitCostsBudget : x.salePrice * x.exitCostPct / 100;
    const extraMonths = x.months - plan.flip.months;
    obligations = x.renovation * x.renovationOverrunPct / 100 + (exitCosts - x.exitCostsBudget) + x.financingCost + extraMonths * x.delayCostPerMonth;
    income = x.salePrice;
    years = x.months / 12;
  } else {
    const netRent = x.annualRent * x.occupancyPct / 100 * (1 - x.operatingCostPct / 100);
    interim = netRent * x.years;
    income = x.exitPrice + interim;
    obligations = x.exitPrice * (x.exitCostPct || 0) / 100 + x.financingCost;
    years = x.years;
  }
  const distributable = income - obligations;
  return { capital, income, obligations, distributable, profit: distributable - capital, interim, years, structure, x };
}

/** Reparte la caja distribuible según la estructura (SPEC.md §5). */
export function waterfall(plan, r) {
  const poolCap = plan.capital.external;
  const capital = r.capital;
  const share = poolCap / capital;
  const D = r.distributable;
  const s = r.structure;
  let poolCapital, managerCapital, poolResult = 0, managerResult = 0;
  if (s.model === 'capital_first') {
    poolCapital = Math.min(poolCap, Math.max(D, 0));
    managerCapital = Math.min(capital - poolCap, Math.max(D - poolCapital, 0));
    const excess = Math.max(D - capital, 0);
    poolResult = excess * share; managerResult = excess - poolResult;
  } else if (D <= capital) {
    poolCapital = Math.max(D, 0) * share;
    managerCapital = Math.max(D, 0) - poolCapital;
  } else {
    poolCapital = poolCap; managerCapital = capital - poolCap;
    const P = D - capital;
    const poolShare = P * share;
    if (s.model === 'hurdle') {
      const h = s.hurdlePct / 100 * r.years * poolCap;
      poolResult = Math.min(poolShare, h) + (1 - s.managerSharePct / 100) * Math.max(0, poolShare - h);
    } else poolResult = poolShare;
    managerResult = P - poolResult;
  }
  return { poolCapital, managerCapital, poolResult, managerResult, shortfall: D < capital };
}

/**
 * Lo que corresponde a una aportación concreta. Devuelve importes redondeados
 * a céntimos; `annualizedReturn` es simple (sin capitalizar) y null cuando la
 * rentabilidad no es positiva, como en la interfaz.
 */
export function simulate(plan, { amount, scenarioId, overrides } = {}) {
  validatePlan(plan);
  const a = num(amount, 'amount');
  if (a <= 0 || a > plan.capital.external) fail('Importe fuera del objetivo de la operación');
  let ov = overrides || {};
  if (scenarioId) {
    const sc = (plan.scenarios || []).find((s) => s.id === scenarioId);
    if (!sc) fail('Escenario desconocido');
    ov = { ...sc.overrides, ...ov };
  }
  const r = projectResult(plan, ov);
  const w = waterfall(plan, r);
  const k = a / plan.capital.external;
  const total = k * (w.poolCapital + w.poolResult);
  const ret = total / a - 1;
  return {
    amount: round2(a),
    capitalReturned: round2(k * w.poolCapital),
    result: round2(total - a),
    totalDistribution: round2(total),
    interimDistributions: round2(k * r.interim * (plan.capital.external / r.capital)),
    simpleReturn: ret,
    annualizedReturn: ret > 0 ? ret / r.years : null,
    years: r.years,
    shortfall: w.shortfall,
    project: {
      income: round2(r.income), obligations: round2(r.obligations), distributable: round2(r.distributable), result: round2(r.profit),
      poolCapital: round2(w.poolCapital), managerCapital: round2(w.managerCapital), poolResult: round2(w.poolResult), managerResult: round2(w.managerResult),
    },
    model: r.structure.model,
    estimate: true,
  };
}

/** Los escenarios del plan, para una aportación: la tabla de la ficha del proyecto. */
export function scenarioTable(plan, amount) {
  validatePlan(plan);
  return (plan.scenarios || []).map((sc) => ({ id: sc.id, name: sc.name, ...simulate(plan, { amount, scenarioId: sc.id }) }));
}
