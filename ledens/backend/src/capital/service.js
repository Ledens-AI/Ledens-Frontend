import { audit } from '../db/audit.js';
import { isUuid } from '../presupuestos/service.js';
import { isEmail } from '../invitaciones/service.js';
import { simulate, scenarioTable, validatePlan, EngineError } from './engine.js';

// Ledens Capital (migración 025, design-source/ledens-capital/SPEC.md). Una
// instancia por petición, con el usuario de la sesión ya verificada con
// segundo factor (routes/capital.js). Todo acceso se comprueba aquí, fila a
// fila: un partícipe solo ve sus solicitudes, sus movimientos y las
// operaciones a las que le han dado acceso, nunca nada de otro partícipe.
// El equipo actúa según sus roles de capital.staff_roles.

export class CapitalError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new CapitalError(status, message, code); };

export const STAFF_ROLES = ['super_admin', 'investment_manager', 'project_manager', 'finance_manager', 'compliance', 'investor_relations'];
export const MEMBER_STATUSES = ['invited', 'accepted', 'pending_verification', 'pending_approval', 'approved', 'suspended', 'revoked'];
const VISIBLE_STATUSES = ['coming_soon', 'open', 'allocation_review', 'funded', 'in_progress', 'completed'];
const OPEN_COMMITMENT = ['requested', 'allocated', 'signed', 'funded'];

// Quién puede hacer qué (artboard «Arquitectura», tabla de roles).
const CAN = {
  manageMembers: ['super_admin', 'investment_manager', 'investor_relations'],
  approveMembers: ['super_admin', 'compliance'],
  manageProjects: ['super_admin', 'investment_manager'],
  allocationStep1: ['super_admin', 'investment_manager'],
  allocationStep2: ['super_admin', 'compliance'],
  sign: ['super_admin', 'investment_manager'],
  cash: ['super_admin', 'finance_manager'],
  confirm: ['super_admin', 'investment_manager', 'finance_manager'],
  readAll: ['super_admin', 'investment_manager', 'finance_manager', 'compliance', 'investor_relations', 'project_manager'],
  audit: ['super_admin', 'compliance'],
};

const money = (v) => (v == null ? null : Number(v));
const toCents = (v, field) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) fail(400, `Importe no válido: ${field}`);
  return Math.round(n * 100) / 100;
};
const uuid = (v, what = 'Identificador') => { if (!isUuid(v)) fail(404, `${what} no encontrado`); return v; };
const text = (v, field, max = 500) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(400, `Falta o no es válido: ${field}`);
  return v.trim();
};

async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e?.code === '23514' && /otra persona|primera aprobación/.test(e.message)) throw new CapitalError(409, e.message);
    throw e;
  } finally {
    c.release();
  }
}

export class CapitalService {
  constructor(pool, user) {
    this.pool = pool;
    this.user = user;
    this.ctx = null;
  }

  async context() {
    if (this.ctx) return this.ctx;
    const member = (await this.pool.query('SELECT * FROM capital.members WHERE user_id=$1', [this.user.id])).rows[0] || null;
    const roles = (await this.pool.query('SELECT role FROM capital.staff_roles WHERE user_id=$1', [this.user.id])).rows.map((r) => r.role);
    this.ctx = { member, roles };
    return this.ctx;
  }

  async can(action) {
    const { roles } = await this.context();
    return roles.some((r) => CAN[action].includes(r));
  }

  async require(action) {
    if (!(await this.can(action))) fail(403, 'No tienes permiso para esto');
  }

  async approvedMember() {
    const { member } = await this.context();
    if (!member) fail(403, 'Tu cuenta no tiene acceso a Ledens Capital', 'sin_acceso');
    if (member.status !== 'approved') fail(403, 'Tu cuenta aún no está aprobada', `cuenta_${member.status}`);
    return member;
  }

  async me() {
    const { member, roles } = await this.context();
    if (!member && !roles.length) fail(403, 'Tu cuenta no tiene acceso a Ledens Capital', 'sin_acceso');
    return {
      user: { id: this.user.id, email: this.user.email, name: this.user.name },
      member: member && { id: member.id, kind: member.kind, status: member.status, approvedAt: member.approved_at },
      staffRoles: roles,
    };
  }

  // ---- Captación de una operación, sin datos de ningún partícipe ----------

  async funding(projectIds, db = this.pool) {
    if (!projectIds.length) return new Map();
    const { rows } = await db.query(
      `SELECT project_id,
              coalesce(sum(signed_amount) FILTER (WHERE status IN ('signed','funded','effective')), 0) AS signed,
              coalesce(sum(allocated_amount) FILTER (WHERE status = 'allocated'), 0) AS allocated,
              coalesce(sum(requested_amount) FILTER (WHERE status = 'requested'), 0) AS in_review
         FROM capital.commitments WHERE project_id = ANY($1::uuid[]) GROUP BY project_id`,
      [projectIds],
    );
    return new Map(rows.map((r) => [r.project_id, { signed: money(r.signed), allocated: money(r.allocated), inReview: money(r.in_review) }]));
  }

  summarize(p, f = { signed: 0, allocated: 0, inReview: 0 }) {
    const target = money(p.external_target);
    return { target, ...f, available: Math.max(0, target - f.signed - f.allocated - f.inReview) };
  }

  async approvedPlan(projectId, db = this.pool) {
    return (await db.query("SELECT * FROM capital.plan_versions WHERE project_id=$1 AND status='approved'", [projectId])).rows[0] || null;
  }

  // ---- Partícipe -----------------------------------------------------------

  async visibleProject(projectId, db = this.pool) {
    uuid(projectId, 'Operación');
    const member = await this.approvedMember();
    const p = (await db.query(
      `SELECT p.* FROM capital.projects p
         JOIN capital.project_access a ON a.project_id = p.id AND a.member_id = $2
        WHERE p.id = $1 AND p.status = ANY($3)`,
      [projectId, member.id, VISIBLE_STATUSES],
    )).rows[0];
    if (!p) fail(404, 'Operación no encontrada');
    return { p, member };
  }

  publicProject(p) {
    return {
      id: p.id, code: p.code, name: p.name, location: p.location_public, strategy: p.strategy, status: p.status,
      managerEntity: p.manager_entity, minContribution: money(p.min_contribution), commitmentDeadline: p.commitment_deadline,
      summary: p.summary, riskSummary: p.risk_summary,
    };
  }

  async opportunities() {
    const member = await this.approvedMember();
    const { rows } = await this.pool.query(
      `SELECT p.* FROM capital.projects p
         JOIN capital.project_access a ON a.project_id = p.id AND a.member_id = $1
        WHERE p.status = ANY($2) ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC`,
      [member.id, VISIBLE_STATUSES],
    );
    const f = await this.funding(rows.map((r) => r.id));
    const out = [];
    for (const p of rows) {
      const v = await this.approvedPlan(p.id);
      let base = null;
      if (v && (v.plan.scenarios || []).some((s) => s.id === 'base')) {
        const r = simulate(v.plan, { amount: Math.min(money(p.min_contribution), money(p.external_target)), scenarioId: 'base' });
        base = { simpleReturn: r.simpleReturn, annualizedReturn: r.annualizedReturn, years: r.years, estimate: true };
      }
      out.push({ ...this.publicProject(p), funding: this.summarize(p, f.get(p.id)), baseScenario: base });
    }
    return out;
  }

  async project(projectId) {
    const { p, member } = await this.visibleProject(projectId);
    const v = await this.approvedPlan(p.id);
    const mine = (await this.pool.query(
      'SELECT * FROM capital.commitments WHERE project_id=$1 AND member_id=$2 ORDER BY requested_at', [p.id, member.id])).rows;
    // La dirección exacta, solo con una asignación aprobada.
    const allocated = mine.some((c) => ['allocated', 'signed', 'funded', 'effective'].includes(c.status));
    const f = (await this.funding([p.id])).get(p.id);
    return {
      ...this.publicProject(p),
      locationFull: allocated ? p.location_full : null,
      funding: this.summarize(p, f),
      plan: v && { id: v.id, version: v.version, approvedAt: v.approved_at, ...v.plan },
      scenarios: v ? scenarioTable(v.plan, Math.min(money(p.min_contribution), money(p.external_target))) : [],
      myCommitments: mine.map((c) => this.commitmentView(c)),
    };
  }

  async simulate(projectId, body = {}) {
    const { p } = await this.visibleProject(projectId);
    const v = await this.approvedPlan(p.id);
    if (!v) fail(409, 'La operación aún no tiene un plan aprobado');
    try {
      return { planVersion: v.version, ...simulate(v.plan, { amount: body.amount, scenarioId: body.scenarioId, overrides: body.overrides }) };
    } catch (e) {
      if (e instanceof EngineError) fail(400, e.message);
      throw e;
    }
  }

  commitmentView(c) {
    return {
      id: c.id, projectId: c.project_id, status: c.status,
      requestedAmount: money(c.requested_amount), allocatedAmount: money(c.allocated_amount), signedAmount: money(c.signed_amount),
      requestedAt: c.requested_at, allocatedAt: c.allocated_at, signedAt: c.signed_at, fundedAt: c.funded_at, effectiveAt: c.effective_at,
      closedAt: c.closed_at, closedReason: c.closed_reason,
    };
  }

  async requestCommitment(projectId, body = {}) {
    return tx(this.pool, async (db) => {
      const { p, member } = await this.visibleProject(projectId, db);
      if (p.status !== 'open') fail(409, 'La operación no está abierta a compromisos');
      if (p.commitment_deadline && new Date(p.commitment_deadline) < new Date(new Date().toDateString())) fail(409, 'El plazo de compromisos ha terminado');
      const v = await this.approvedPlan(p.id, db);
      if (!v) fail(409, 'La operación aún no tiene un plan aprobado');
      const amount = toCents(body.amount, 'amount');
      if (amount < money(p.min_contribution)) fail(400, `La aportación mínima es ${money(p.min_contribution)} €`);
      await db.query('SELECT id FROM capital.projects WHERE id=$1 FOR UPDATE', [p.id]); // serializa las solicitudes de una operación
      const s = this.summarize(p, (await this.funding([p.id], db)).get(p.id));
      if (amount > s.available) fail(409, 'El importe supera la asignación disponible', 'sin_disponible');
      // Cada documento exigido por el plan, confirmado en su versión actual.
      const required = v.plan.requiredAcknowledgements || [];
      const given = new Map((body.acknowledgements || []).map((a) => [a?.key, a?.version]));
      for (const d of required) if (given.get(d.key) !== d.version) fail(400, `Confirma el documento: ${d.title || d.key}`, 'documentos_pendientes');
      let c;
      try {
        c = (await db.query(
          `INSERT INTO capital.commitments (project_id, member_id, plan_version_id, requested_amount) VALUES ($1,$2,$3,$4) RETURNING *`,
          [p.id, member.id, v.id, amount])).rows[0];
      } catch (e) {
        if (e.code === '23505') fail(409, 'Ya tienes una solicitud abierta en esta operación', 'solicitud_abierta');
        throw e;
      }
      for (const d of required) {
        await db.query(
          'INSERT INTO capital.acknowledgements (commitment_id, document_key, document_version, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
          [c.id, d.key, d.version, body.ip || null, body.userAgent || null]);
      }
      await audit({ actor: this.user, action: 'capital.commitment_requested', target: { label: p.code }, detail: `${amount} € · solicitud ${c.id}` }, db);
      return this.commitmentView(c);
    });
  }

  async withdraw(commitmentId) {
    uuid(commitmentId, 'Solicitud');
    const member = await this.approvedMember();
    return tx(this.pool, async (db) => {
      const c = (await db.query('SELECT * FROM capital.commitments WHERE id=$1 AND member_id=$2 FOR UPDATE', [commitmentId, member.id])).rows[0];
      if (!c) fail(404, 'Solicitud no encontrada');
      if (!['requested', 'allocated'].includes(c.status)) fail(409, 'Una solicitud firmada ya no se puede retirar desde aquí');
      const u = (await db.query(
        "UPDATE capital.commitments SET status='withdrawn', closed_at=now(), closed_reason='Retirada por el partícipe', updated_at=now() WHERE id=$1 RETURNING *",
        [c.id])).rows[0];
      await audit({ actor: this.user, action: 'capital.commitment_withdrawn', target: { label: c.id } }, db);
      return this.commitmentView(u);
    });
  }

  /**
   * Cartera del partícipe (artboard «Dashboard»). Solo movimientos
   * conciliados cuentan como realizados; lo estimado va aparte.
   */
  async portfolio() {
    const member = await this.approvedMember();
    const commitments = (await this.pool.query(
      `SELECT c.*, p.name, p.code, p.strategy, p.status AS project_status, p.location_public
         FROM capital.commitments c JOIN capital.projects p ON p.id = c.project_id
        WHERE c.member_id=$1 ORDER BY c.requested_at`, [member.id])).rows;
    const moves = (await this.pool.query(
      `SELECT project_id, kind, sum(amount) AS total FROM capital.cash_movements
        WHERE member_id=$1 AND status='reconciled' GROUP BY project_id, kind`, [member.id])).rows;
    const by = new Map();
    for (const m of moves) {
      const o = by.get(m.project_id) || { contribution: 0, capital_return: 0, profit: 0, loss_allocation: 0 };
      o[m.kind] = money(m.total);
      by.set(m.project_id, o);
    }
    const sum = (k) => [...by.values()].reduce((a, o) => a + o[k], 0);
    const contributed = sum('contribution');
    const returned = sum('capital_return');
    const profit = sum('profit');
    const loss = sum('loss_allocation');
    const committed = commitments
      .filter((c) => ['signed', 'funded', 'effective'].includes(c.status) && c.project_status !== 'completed')
      .reduce((a, c) => a + money(c.signed_amount), 0);
    const outstanding = [...by.values()].reduce((a, o) => a + Math.max(0, o.contribution - o.capital_return - o.loss_allocation), 0);
    const completed = commitments.filter((c) => c.project_status === 'completed' && c.status === 'effective');
    const done = completed.map((c) => by.get(c.project_id)).filter(Boolean);
    const doneContrib = done.reduce((a, o) => a + o.contribution, 0);
    const realisedReturn = doneContrib > 0 ? done.reduce((a, o) => a + o.profit - o.loss_allocation, 0) / doneContrib : null;
    const round = (n) => Math.round(n * 100) / 100;
    return {
      realised: {
        contributed: round(contributed),
        committed: round(committed),
        outstanding: round(outstanding),
        realisedProfit: round(profit - loss),
        distributions: { total: round(returned + profit), capital: round(returned), profit: round(profit) },
        realisedReturn,
        completedInvestments: completed.length,
        activeInvestments: commitments.filter((c) => c.status === 'effective' && c.project_status !== 'completed').length,
      },
      positions: commitments.map((c) => {
        const o = by.get(c.project_id) || { contribution: 0, capital_return: 0, profit: 0, loss_allocation: 0 };
        return {
          ...this.commitmentView(c),
          project: { id: c.project_id, code: c.code, name: c.name, strategy: c.strategy, status: c.project_status, location: c.location_public },
          contributed: o.contribution, capitalReturned: o.capital_return, profit: o.profit, lossAllocated: o.loss_allocation,
        };
      }),
    };
  }

  // ---- Equipo: miembros ------------------------------------------------------

  async createMember(body = {}) {
    await this.require('manageMembers');
    const email = String(body.email || '').trim();
    if (!isEmail(email)) fail(400, 'Email no válido');
    const kind = body.kind === 'company' ? 'company' : 'person';
    return tx(this.pool, async (db) => {
      let u = (await db.query('SELECT id, email, name FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
      // Una cuenta que ya existe nunca cambia (ni rol, ni nombre, ni contraseña).
      if (!u) {
        u = (await db.query("INSERT INTO users (email, name, role) VALUES ($1,$2,'client') RETURNING id, email, name",
          [email, typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : email])).rows[0];
      }
      const m = (await db.query(
        `INSERT INTO capital.members (user_id, kind, legal_name, company_name, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO NOTHING RETURNING *`,
        [u.id, kind, body.legalName || null, kind === 'company' ? body.companyName || null : null, this.user.id])).rows[0];
      if (!m) fail(409, 'Esta persona ya es miembro de Ledens Capital');
      await audit({ actor: this.user, action: 'capital.member_created', target: { id: u.id, label: u.email }, detail: kind }, db);
      return { id: m.id, userId: u.id, email: u.email, status: m.status, kind };
    });
  }

  async setMemberStatus(memberId, body = {}) {
    uuid(memberId, 'Miembro');
    const to = body.status;
    if (!MEMBER_STATUSES.includes(to)) fail(400, 'Estado no válido');
    await this.require(['approved', 'suspended', 'revoked'].includes(to) ? 'approveMembers' : 'manageMembers');
    const reason = ['suspended', 'revoked'].includes(to) ? text(body.reason, 'reason') : body.reason || null;
    return tx(this.pool, async (db) => {
      const m = (await db.query('SELECT m.*, u.email FROM capital.members m JOIN users u ON u.id=m.user_id WHERE m.id=$1 FOR UPDATE', [memberId])).rows[0];
      if (!m) fail(404, 'Miembro no encontrado');
      if (m.user_id === this.user.id) fail(403, 'No puedes cambiar tu propio estado');
      const u = (await db.query(
        `UPDATE capital.members SET status=$2, status_reason=$3, updated_at=now(),
                approved_at = CASE WHEN $2='approved' THEN now() ELSE approved_at END,
                approved_by = CASE WHEN $2='approved' THEN $4::uuid ELSE approved_by END
          WHERE id=$1 RETURNING *`, [m.id, to, reason, this.user.id])).rows[0];
      await audit({ actor: this.user, action: 'capital.member_status', target: { id: m.user_id, label: m.email }, detail: `${m.status} → ${to}${reason ? ` · ${reason}` : ''}` }, db);
      return { id: u.id, status: u.status };
    });
  }

  async members() {
    await this.require('readAll');
    const { rows } = await this.pool.query(
      `SELECT m.id, m.kind, m.status, m.status_reason, m.approved_at, m.created_at, u.email, u.name,
              (SELECT confirmed_at IS NOT NULL FROM user_mfa_totp t WHERE t.user_id=u.id) AS mfa
         FROM capital.members m JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC`);
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, kind: r.kind, status: r.status, statusReason: r.status_reason, approvedAt: r.approved_at, mfa: Boolean(r.mfa) }));
  }

  // ---- Equipo: operaciones y planes -----------------------------------------

  async createProject(body = {}) {
    await this.require('manageProjects');
    const strategy = ['flip', 'rental', 'hybrid'].includes(body.strategy) ? body.strategy : fail(400, 'Estrategia no válida');
    const p = (await this.pool.query(
      `INSERT INTO capital.projects (code, name, location_public, location_full, strategy, manager_entity, external_target, manager_contribution,
                                     min_contribution, commitment_deadline, summary, risk_summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [text(body.code, 'code', 40), text(body.name, 'name', 200), text(body.locationPublic, 'locationPublic', 200), body.locationFull || null, strategy,
        text(body.managerEntity, 'managerEntity', 200), toCents(body.externalTarget, 'externalTarget'),
        body.managerContribution == null ? 0 : Math.max(0, Number(body.managerContribution) || 0), toCents(body.minContribution, 'minContribution'),
        body.commitmentDeadline || null, body.summary || null, body.riskSummary || null, this.user.id],
    ).catch((e) => { if (e.code === '23505') fail(409, 'Ya existe una operación con ese código'); throw e; })).rows[0];
    await audit({ actor: this.user, action: 'capital.project_created', target: { label: p.code } }, this.pool);
    return { id: p.id, code: p.code, status: p.status };
  }

  async createPlanVersion(projectId, body = {}) {
    await this.require('manageProjects');
    uuid(projectId, 'Operación');
    try { validatePlan(body.plan); } catch (e) { if (e instanceof EngineError) fail(400, e.message); throw e; }
    return tx(this.pool, async (db) => {
      const p = (await db.query('SELECT * FROM capital.projects WHERE id=$1 FOR UPDATE', [projectId])).rows[0];
      if (!p) fail(404, 'Operación no encontrada');
      if (body.plan.strategy !== p.strategy) fail(400, 'La estrategia del plan no coincide con la de la operación');
      if (money(p.external_target) !== Number(body.plan.capital.external)) fail(400, 'El capital de partícipes del plan no coincide con el objetivo de la operación');
      const n = Number((await db.query('SELECT coalesce(max(version),0)+1 AS n FROM capital.plan_versions WHERE project_id=$1', [p.id])).rows[0].n);
      const v = (await db.query(
        'INSERT INTO capital.plan_versions (project_id, version, plan, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [p.id, n, JSON.stringify(body.plan), body.note || null, this.user.id])).rows[0];
      await audit({ actor: this.user, action: 'capital.plan_created', target: { label: p.code }, detail: `v${n}` }, db);
      return { id: v.id, version: v.version, status: v.status };
    });
  }

  async approvePlanVersion(projectId, versionId) {
    await this.require('manageProjects');
    uuid(projectId, 'Operación'); uuid(versionId, 'Versión');
    return tx(this.pool, async (db) => {
      const v = (await db.query('SELECT v.*, p.code FROM capital.plan_versions v JOIN capital.projects p ON p.id=v.project_id WHERE v.id=$1 AND v.project_id=$2 FOR UPDATE', [versionId, projectId])).rows[0];
      if (!v) fail(404, 'Versión no encontrada');
      if (v.status !== 'draft') fail(409, 'Esta versión ya no es un borrador');
      if (v.created_by === this.user.id) fail(409, 'La aprobación debe hacerla otra persona');
      await db.query("UPDATE capital.plan_versions SET status='superseded' WHERE project_id=$1 AND status='approved'", [projectId]);
      await db.query("UPDATE capital.plan_versions SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [v.id, this.user.id]);
      await audit({ actor: this.user, action: 'capital.plan_approved', target: { label: v.code }, detail: `v${v.version}` }, db);
      return { id: v.id, version: v.version, status: 'approved' };
    });
  }

  async setProjectStatus(projectId, body = {}) {
    await this.require('manageProjects');
    uuid(projectId, 'Operación');
    const to = body.status;
    if (!['draft', ...VISIBLE_STATUSES].includes(to)) fail(400, 'Estado no válido');
    return tx(this.pool, async (db) => {
      const p = (await db.query('SELECT * FROM capital.projects WHERE id=$1 FOR UPDATE', [projectId])).rows[0];
      if (!p) fail(404, 'Operación no encontrada');
      if (to !== 'draft' && to !== 'coming_soon' && !(await this.approvedPlan(p.id, db))) fail(409, 'Aprueba un plan antes de abrir la operación');
      await db.query('UPDATE capital.projects SET status=$2, published_at=coalesce(published_at, CASE WHEN $2<>\'draft\' THEN now() END), updated_at=now() WHERE id=$1', [p.id, to]);
      await audit({ actor: this.user, action: 'capital.project_status', target: { label: p.code }, detail: `${p.status} → ${to}` }, db);
      return { id: p.id, status: to };
    });
  }

  async grantAccess(projectId, memberId) {
    await this.require('manageMembers');
    uuid(projectId, 'Operación'); uuid(memberId, 'Miembro');
    const ok = (await this.pool.query('SELECT (SELECT code FROM capital.projects WHERE id=$1) AS code, (SELECT id FROM capital.members WHERE id=$2) AS m', [projectId, memberId])).rows[0];
    if (!ok.code || !ok.m) fail(404, 'Operación o miembro no encontrado');
    await this.pool.query('INSERT INTO capital.project_access (project_id, member_id, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [projectId, memberId, this.user.id]);
    await audit({ actor: this.user, action: 'capital.access_granted', target: { label: ok.code }, detail: memberId }, this.pool);
    return { projectId, memberId };
  }

  // ---- Equipo: solicitudes, firma y fondos ----------------------------------

  async commitments(projectId) {
    await this.require('readAll');
    uuid(projectId, 'Operación');
    const { rows } = await this.pool.query(
      `SELECT c.*, u.email, u.name, m.status AS member_status,
              (SELECT json_agg(json_build_object('step', a.step, 'by', a.decided_by, 'amount', a.amount, 'at', a.created_at) ORDER BY a.step)
                 FROM capital.approvals a WHERE a.subject_type='allocation' AND a.subject_id=c.id) AS approvals
         FROM capital.commitments c JOIN capital.members m ON m.id=c.member_id JOIN users u ON u.id=m.user_id
        WHERE c.project_id=$1 ORDER BY c.requested_at`, [projectId]);
    return rows.map((r) => ({ ...this.commitmentView(r), member: { email: r.email, name: r.name, status: r.member_status }, approvals: r.approvals || [] }));
  }

  async lockCommitment(db, id) {
    uuid(id, 'Solicitud');
    const c = (await db.query(
      `SELECT c.*, p.code, m.status AS member_status FROM capital.commitments c
         JOIN capital.projects p ON p.id=c.project_id JOIN capital.members m ON m.id=c.member_id
        WHERE c.id=$1 FOR UPDATE OF c`, [id])).rows[0];
    if (!c) fail(404, 'Solicitud no encontrada');
    return c;
  }

  /** Aprobación de asignación a cuatro ojos: 1.ª firma (inversiones), 2.ª (cumplimiento). */
  async approveAllocation(commitmentId, body = {}) {
    return tx(this.pool, async (db) => {
      const c = await this.lockCommitment(db, commitmentId);
      if (c.status !== 'requested') fail(409, 'Esta solicitud ya no está en revisión');
      const first = (await db.query("SELECT * FROM capital.approvals WHERE subject_type='allocation' AND subject_id=$1 AND step=1", [c.id])).rows[0];
      if (!first) {
        await this.require('allocationStep1');
        const amount = body.amount == null ? money(c.requested_amount) : toCents(body.amount, 'amount');
        if (amount > money(c.requested_amount)) fail(400, 'La asignación no puede superar lo solicitado');
        await db.query("INSERT INTO capital.approvals (subject_type, subject_id, step, decided_by, amount, note) VALUES ('allocation',$1,1,$2,$3,$4)",
          [c.id, this.user.id, amount, body.note || null]);
        await audit({ actor: this.user, action: 'capital.allocation_step1', target: { label: c.code }, detail: `${amount} € · ${c.id}` }, db);
        return { id: c.id, status: 'requested', step: 1, amount };
      }
      await this.require('allocationStep2');
      if (c.member_status !== 'approved') fail(409, 'El partícipe no está aprobado');
      const amount = money(first.amount);
      await db.query("INSERT INTO capital.approvals (subject_type, subject_id, step, decided_by, amount, note) VALUES ('allocation',$1,2,$2,$3,$4)",
        [c.id, this.user.id, amount, body.note || null]);
      const u = (await db.query("UPDATE capital.commitments SET status='allocated', allocated_amount=$2, allocated_at=now(), updated_at=now() WHERE id=$1 RETURNING *",
        [c.id, amount])).rows[0];
      await audit({ actor: this.user, action: 'capital.allocation_approved', target: { label: c.code }, detail: `${amount} € · ${c.id}` }, db);
      return this.commitmentView(u);
    });
  }

  async rejectCommitment(commitmentId, body = {}) {
    const reason = text(body.reason, 'reason');
    return tx(this.pool, async (db) => {
      if (!(await this.can('allocationStep1')) && !(await this.can('allocationStep2'))) fail(403, 'No tienes permiso para esto');
      const c = await this.lockCommitment(db, commitmentId);
      if (!['requested', 'allocated'].includes(c.status)) fail(409, 'Esta solicitud ya no se puede rechazar');
      const u = (await db.query("UPDATE capital.commitments SET status='rejected', closed_at=now(), closed_reason=$2, updated_at=now() WHERE id=$1 RETURNING *", [c.id, reason])).rows[0];
      await audit({ actor: this.user, action: 'capital.commitment_rejected', target: { label: c.code }, detail: `${c.id} · ${reason}` }, db);
      return this.commitmentView(u);
    });
  }

  /** Contrato firmado (fase 1: subido y verificado por Ledens, o referencia del proveedor). */
  async markSigned(commitmentId, body = {}) {
    await this.require('sign');
    const ref = text(body.contractRef, 'contractRef', 200);
    return tx(this.pool, async (db) => {
      const c = await this.lockCommitment(db, commitmentId);
      if (c.status !== 'allocated') fail(409, 'Solo se firma una asignación aprobada');
      const u = (await db.query("UPDATE capital.commitments SET status='signed', signed_amount=allocated_amount, contract_ref=$2, signed_at=now(), updated_at=now() WHERE id=$1 RETURNING *",
        [c.id, ref])).rows[0];
      await audit({ actor: this.user, action: 'capital.contract_signed', target: { label: c.code }, detail: `${c.id} · ${ref}` }, db);
      return this.commitmentView(u);
    });
  }

  async recordContribution(commitmentId, body = {}) {
    await this.require('cash');
    const amount = toCents(body.amount, 'amount');
    return tx(this.pool, async (db) => {
      const c = await this.lockCommitment(db, commitmentId);
      if (c.status !== 'signed') fail(409, 'Solo se registran aportaciones de un contrato firmado');
      const m = (await db.query(
        `INSERT INTO capital.cash_movements (project_id, member_id, commitment_id, kind, amount, status, bank_reference, value_date, note, recorded_by)
         VALUES ($1,$2,$3,'contribution',$4,'received',$5,$6,$7,$8) RETURNING *`,
        [c.project_id, c.member_id, c.id, amount, text(body.bankReference, 'bankReference', 140), body.valueDate || null, body.note || null, this.user.id])).rows[0];
      await audit({ actor: this.user, action: 'capital.contribution_received', target: { label: c.code }, detail: `${amount} € · ${m.bank_reference}` }, db);
      return { id: m.id, status: m.status, amount: money(m.amount) };
    });
  }

  /** Conciliación manual: el dinero está en la cuenta segregada. Con todo lo firmado conciliado, la solicitud pasa a `funded`. */
  async reconcile(movementId, body = {}) {
    await this.require('cash');
    uuid(movementId, 'Movimiento');
    const to = body.status || 'reconciled';
    if (!['reconciled', 'rejected', 'returned'].includes(to)) fail(400, 'Estado no válido');
    return tx(this.pool, async (db) => {
      const m = (await db.query('SELECT * FROM capital.cash_movements WHERE id=$1 FOR UPDATE', [movementId])).rows[0];
      if (!m) fail(404, 'Movimiento no encontrado');
      if (!['pending', 'received'].includes(m.status)) fail(409, 'Este movimiento ya está cerrado');
      if (to !== 'reconciled') text(body.note, 'note');
      await db.query('UPDATE capital.cash_movements SET status=$2, reconciled_by=$3, reconciled_at=now(), note=coalesce($4, note), updated_at=now() WHERE id=$1',
        [m.id, to, this.user.id, body.note || null]);
      let commitment = null;
      if (m.commitment_id && m.kind === 'contribution' && to === 'reconciled') {
        const c = await this.lockCommitment(db, m.commitment_id);
        const paid = money((await db.query("SELECT coalesce(sum(amount),0) AS s FROM capital.cash_movements WHERE commitment_id=$1 AND kind='contribution' AND status='reconciled'", [c.id])).rows[0].s);
        if (c.status === 'signed' && paid >= money(c.signed_amount)) {
          commitment = this.commitmentView((await db.query("UPDATE capital.commitments SET status='funded', funded_at=now(), updated_at=now() WHERE id=$1 RETURNING *", [c.id])).rows[0]);
        }
      }
      await audit({ actor: this.user, action: `capital.movement_${to}`, target: { label: m.id }, detail: `${money(m.amount)} €` }, db);
      return { id: m.id, status: to, commitment };
    });
  }

  /** Participación efectiva: contrato firmado, fondos conciliados y partícipe aprobado. */
  async confirm(commitmentId) {
    await this.require('confirm');
    return tx(this.pool, async (db) => {
      const c = await this.lockCommitment(db, commitmentId);
      if (c.status !== 'funded') fail(409, 'Faltan fondos conciliados o el contrato firmado');
      if (c.member_status !== 'approved') fail(409, 'El partícipe no está aprobado');
      const u = (await db.query("UPDATE capital.commitments SET status='effective', effective_at=now(), updated_at=now() WHERE id=$1 RETURNING *", [c.id])).rows[0];
      await audit({ actor: this.user, action: 'capital.participation_effective', target: { label: c.code }, detail: c.id }, db);
      return this.commitmentView(u);
    });
  }

  async auditLog() {
    await this.require('audit');
    const { rows } = await this.pool.query(
      "SELECT id, at, actor_label, action, target_label, detail FROM audit_log WHERE action LIKE 'capital.%' OR action LIKE 'mfa.%' ORDER BY id DESC LIMIT 200");
    return rows;
  }
}
