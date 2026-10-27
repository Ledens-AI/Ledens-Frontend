import { audit } from '../db/audit.js';

// Presupuestos para clientes y seguimiento de obra (migration 020). One
// service per request, built with the effective user (after «Ver como»).
// Who may do what is decided here, never by the frontend:
//  - admin: everything;
//  - jefe: only presupuestos assigned to them (jefe_id) — edit and send versions,
//    create ampliaciones, set dates and declare production;
//  - client: only their own presupuestos, never drafts — approve, ask for
//    changes, reject and comment on the version he was sent.
// Amounts: prices net of VAT, one VAT rate per version. A line counts when it
// is confirmada/condicionada, or a decision/opcion the client selected.
export class PresupuestoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new PresupuestoError(status, message); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export const KINDS = ['confirmada', 'condicionada', 'decision', 'opcion'];
const COUNTED = "(l.kind IN ('confirmada','condicionada') OR l.selected)";
// Line amounts are summed unrounded and only totals are rounded, so net prices
// converted from VAT-inclusive ones add back up to the original total.
const LINE = 'l.quantity*l.unit_price';
const LAST_EXECUTED = '(SELECT pr.executed FROM presupuesto_produccion pr WHERE pr.partida_id=l.id ORDER BY pr.id DESC LIMIT 1)';

// Money in (unrounded) cents; rounded to whole cents only when shown as "1234.56".
const cents = (v) => Number(v || 0) * 100;
const money = (c) => (Math.round(c) / 100).toFixed(2);
// VAT on the unrounded base: a VAT-inclusive spreadsheet total comes back exactly.
const vatOf = (baseCents, rate) => Math.round(baseCents * Number(rate) / 100);
const pct = (part, whole) => (whole > 0 ? Math.round(part / whole * 1000) / 10 : 0);

const text = (v, field, { max, required } = {}) => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) fail(400, `Falta ${field}`);
    return null;
  }
  if (typeof v !== 'string') fail(400, `${field} no válido`);
  const t = v.trim();
  if (t.length > max) fail(400, `${field}: máximo ${max} caracteres`);
  return t;
};
const decimal = (v, field, decimals, { allowZero } = {}) => {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!new RegExp(`^\\d{1,11}(\\.\\d{1,${decimals}})?$`).test(s)) fail(400, `${field} no válido`);
  if (!allowZero && Number(s) === 0) fail(400, `${field} debe ser mayor que cero`);
  return s;
};
const date = (v, field) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) fail(400, `${field} no válida`);
  return v;
};

// Chapters and lines as sent by the editor: validated whole, before any write.
export function parseContent(body) {
  const vatRate = body.vatRate === undefined ? '21' : decimal(body.vatRate, 'Tipo de IVA', 2, { allowZero: true });
  if (Number(vatRate) >= 100) fail(400, 'Tipo de IVA no válido');
  const notes = text(body.notes, 'Condiciones y exclusiones', { max: 5000 });
  const chapters = body.chapters ?? [];
  if (!Array.isArray(chapters) || chapters.length > 50) fail(400, 'Capítulos no válidos (máximo 50)');
  let lines = 0;
  const parsed = chapters.map((c, ci) => {
    const name = text(c?.name, `Nombre del capítulo ${ci + 1}`, { max: 200, required: true });
    if (!Array.isArray(c.items) || c.items.length > 200) fail(400, `Partidas del capítulo «${name}» no válidas`);
    lines += c.items.length;
    return {
      name,
      items: c.items.map((i, ii) => {
        const where = `partida ${ci + 1}.${ii + 1}`;
        const kind = i?.kind ?? 'confirmada';
        if (!KINDS.includes(kind)) fail(400, `Tipo de la ${where} no válido`);
        return {
          code: text(i.code, `Código de la ${where}`, { max: 40 }),
          name: text(i.name, `Nombre de la ${where}`, { max: 300, required: true }),
          description: text(i.description, `Descripción de la ${where}`, { max: 4000 }),
          unit: text(i.unit, `Unidad de la ${where}`, { max: 20, required: true }),
          quantity: decimal(i.quantity, `Cantidad de la ${where}`, 3),
          unitPrice: decimal(i.unitPrice, `Precio de la ${where}`, 6, { allowZero: true }),
          kind,
          baseCode: text(i.baseCode, `Partida de la base de la ${where}`, { max: 40 }),
          annotations: parseAnnotations(i.annotations, where),
          proposal: parseProposal(i.proposal, where),
        };
      }),
    };
  });
  if (lines > 1000) fail(400, 'Demasiadas partidas (máximo 1000)');
  return { vatRate, notes, chapters: parsed, sourceFile: text(body.sourceFile, 'Archivo de origen', { max: 200 }) };
}

// Notes about how a line relates to the base de partidas (catalog.js), team only.
export const ANNOTATION_TYPES = ['precio', 'codigo', 'traduccion', 'nueva', 'base', 'nota'];
function parseAnnotations(v, where) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 20) fail(400, `Anotaciones de la ${where} no válidas`);
  return v.map((a) => {
    if (!a || !ANNOTATION_TYPES.includes(a.type)) fail(400, `Anotación de la ${where} no válida`);
    return { type: a.type, text: text(a.text, `Anotación de la ${where}`, { max: 1000, required: true }) };
  });
}
// A proposed new partida for the base, when no partida covers the line.
function parseProposal(v, where) {
  if (v == null) return null;
  if (typeof v !== 'object') fail(400, `Partida propuesta de la ${where} no válida`);
  return {
    name: text(v.name, `Nombre de la partida propuesta (${where})`, { max: 300, required: true }),
    definition: text(v.definition, `Definición de la partida propuesta (${where})`, { max: 4000 }),
    unit: text(v.unit, `Unidad de la partida propuesta (${where})`, { max: 20, required: true }),
    priceInclVat: v.priceInclVat == null || v.priceInclVat === '' ? null : decimal(String(v.priceInclVat), `Precio de la partida propuesta (${where})`, 6, { allowZero: true }),
    categoryCode: text(v.categoryCode, 'Categoría', { max: 20 }),
    categoryName: text(v.categoryName, 'Categoría', { max: 200 }),
    nearestCode: text(v.nearestCode, 'Partida más próxima', { max: 40 }),
    reason: text(v.reason, 'Motivo', { max: 1000 }),
  };
}

export class PresupuestosService {
  constructor(pool, user) { this.pool = pool; this.user = user; }

  async tx(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  get isClient() { return this.user.role === 'client'; }
  isTeam(p) { return this.user.role === 'admin' || (this.user.role === 'jefe' && p.jefe_id === this.user.id); }
  actor() { return { id: this.user.id, name: this.user.name || this.user.email }; }

  // Row-level visibility, as SQL on presupuestos alias p. $1 is always the user id.
  visibleSql() {
    if (this.user.role === 'admin') return '($1::uuid IS NOT NULL)';
    if (this.user.role === 'jefe') return 'p.jefe_id=$1';
    // The titular client, or one invited to the obra (obra_clientes, migration 023: they see it, only the titular decides).
    // A password registration that claimed a pending client row sees nothing until the email is proven (migration 024).
    if (this.user.role === 'client') return "(p.client_id=$1 OR EXISTS (SELECT 1 FROM obra_clientes oc WHERE oc.presupuesto_id=coalesce(p.parent_id, p.id) AND oc.user_id=$1)) AND EXISTS (SELECT 1 FROM presupuesto_versiones x WHERE x.presupuesto_id=p.id AND x.status<>'draft') AND NOT EXISTS (SELECT 1 FROM users me WHERE me.id=$1 AND me.access_held AND NOT me.email_verified)";
    return 'false';
  }
  versionFilter() { return this.isClient ? "AND v.status<>'draft'" : ''; }

  async load(db, id, { lock } = {}) {
    if (!isUuid(id)) fail(404, 'Presupuesto no encontrado');
    const p = (await db.query(`SELECT p.* FROM presupuestos p WHERE p.id=$2 AND ${this.visibleSql()}${lock ? ' FOR UPDATE' : ''}`, [this.user.id, id])).rows[0];
    if (!p) fail(404, 'Presupuesto no encontrado');
    return p;
  }
  async latest(db, id, { sentOnly } = {}) {
    return (await db.query(`SELECT * FROM presupuesto_versiones v WHERE v.presupuesto_id=$1 ${sentOnly ? "AND v.status<>'draft'" : ''} ORDER BY number DESC LIMIT 1`, [id])).rows[0] || null;
  }

  // Phase as the list shows it: borrador (team only), pendiente, cambios,
  // rechazado, aprobado, en_curso (approved obra with a start date).
  phase(p, status) {
    if (status === 'approved') return !p.parent_id && p.start_date ? 'en_curso' : 'aprobado';
    return { draft: 'borrador', sent: 'pendiente', changes_requested: 'cambios', rejected: 'rechazado' }[status] || status;
  }

  totals(base, optional, rate) {
    const b = cents(base), iva = vatOf(b, rate);
    return { base: money(b), vat: money(iva), total: money(Math.round(b) + iva), optionalBase: money(cents(optional)), vatRate: String(Number(rate)) };
  }

  async list() {
    const rows = (await this.pool.query(`
      WITH vis AS (SELECT p.* FROM presupuestos p WHERE ${this.visibleSql()}),
      cur AS (SELECT DISTINCT ON (v.presupuesto_id) v.* FROM presupuesto_versiones v JOIN vis ON vis.id=v.presupuesto_id
              WHERE true ${this.versionFilter()} ORDER BY v.presupuesto_id, v.number DESC)
      SELECT vis.id, vis.ref, vis.title, vis.address, vis.parent_id, par.ref parent_ref, par.title parent_title,
             vis.start_date::text, vis.end_date::text, vis.client_id, c.name client_name, c.email client_email,
             vis.jefe_id, j.name jefe_name, cur.id version_id, cur.number version_number, cur.status, cur.vat_rate,
             cur.sent_at, cur.decided_at, cur.created_at version_created_at, t.base, t.optional
        FROM vis JOIN cur ON cur.presupuesto_id=vis.id
        JOIN users c ON c.id=vis.client_id LEFT JOIN users j ON j.id=vis.jefe_id
        LEFT JOIN presupuestos par ON par.id=vis.parent_id
        LEFT JOIN LATERAL (SELECT sum(${LINE}) FILTER (WHERE ${COUNTED}) base,
                                  sum(${LINE}) FILTER (WHERE NOT ${COUNTED}) optional
                             FROM presupuesto_partidas l WHERE l.version_id=cur.id) t ON true
       ORDER BY coalesce(cur.sent_at, cur.created_at) DESC, vis.ref DESC`, [this.user.id])).rows;
    const obras = await this.obraTotals(rows.filter((r) => !r.parent_id && r.status === 'approved').map((r) => r.id));
    return rows.map((r) => ({
      id: r.id, ref: r.ref, title: r.title, address: r.address,
      parent: r.parent_id ? { id: r.parent_id, ref: r.parent_ref, title: r.parent_title } : null,
      client: { id: r.client_id, name: r.client_name || r.client_email },
      jefe: r.jefe_id ? { id: r.jefe_id, name: r.jefe_name } : null,
      version: { id: r.version_id, number: r.version_number, status: r.status, sentAt: r.sent_at, decidedAt: r.decided_at },
      phase: this.phase(r, r.status), startDate: r.start_date, endDate: r.end_date,
      ...this.totals(r.base, r.optional, r.vat_rate),
      obra: obras.get(r.id) || null,
      // A client invited to the obra (obra_clientes) sees it; only the titular decides.
      decides: !this.isClient || r.client_id === this.user.id,
    }));
  }

  // Approved lines of an obra (root + approved ampliaciones) with production.
  async obraLines(ids, db = this.pool) {
    if (!ids.length) return [];
    return (await db.query(`
      SELECT coalesce(p.parent_id,p.id) obra_id, p.id presupuesto_id, p.ref, p.title, p.parent_id, v.id version_id, v.vat_rate,
             ch.id capitulo_id, ch.position chapter_position, ch.name chapter_name,
             l.id, l.position, l.code, l.name, l.description, l.unit, l.quantity::text, l.unit_price::text, l.kind, l.selected,
             ${LINE} amount, coalesce(${LAST_EXECUTED},0)::text executed,
             (SELECT jsonb_build_object('at',pr.declared_at,'by',u.name,'note',pr.note) FROM presupuesto_produccion pr
                LEFT JOIN users u ON u.id=pr.declared_by WHERE pr.partida_id=l.id ORDER BY pr.id DESC LIMIT 1) last
        FROM presupuestos p
        JOIN presupuesto_versiones v ON v.presupuesto_id=p.id AND v.status='approved'
        JOIN presupuesto_partidas l ON l.version_id=v.id AND ${COUNTED}
        JOIN presupuesto_capitulos ch ON ch.id=l.capitulo_id
       WHERE coalesce(p.parent_id,p.id)=ANY($1::uuid[])
       ORDER BY obra_id, p.parent_id NULLS FIRST, v.decided_at, ch.position, l.position`, [ids])).rows;
  }

  // Executed amount caps each line at its budgeted quantity (% de ejecución);
  // consumed does not (% de presupuesto consumido): the difference is the excess.
  lineFigures(l) {
    const price = Number(l.unit_price), qty = Number(l.quantity), ex = Number(l.executed);
    return { amount: cents(l.amount), executedAmount: Math.min(ex, qty) * price * 100, consumed: ex * price * 100 };
  }

  async obraTotals(ids) {
    const out = new Map();
    for (const l of await this.obraLines(ids)) {
      const o = out.get(l.obra_id) || { base: 0, vat: 0, executed: 0, consumed: 0 };
      const f = this.lineFigures(l);
      o.base += f.amount; o.executed += f.executedAmount; o.consumed += f.consumed;
      out.set(l.obra_id, o);
    }
    for (const [id, o] of out) out.set(id, { base: money(o.base), executedAmount: money(o.executed), consumed: money(o.consumed), executionPct: pct(o.executed, o.base), consumedPct: pct(o.consumed, o.base) });
    return out;
  }

  async get(id, { versionId } = {}) {
    const p = await this.load(this.pool, id);
    const team = this.isTeam(p);
    const versions = (await this.pool.query(`
      SELECT v.id, v.number, v.status, v.vat_rate, v.notes, v.sent_at, v.decided_at, v.created_at,
             s.name sent_by, d.name decided_by,
             (SELECT sum(${LINE}) FILTER (WHERE ${COUNTED}) FROM presupuesto_partidas l WHERE l.version_id=v.id) base,
             (SELECT sum(${LINE}) FILTER (WHERE NOT ${COUNTED}) FROM presupuesto_partidas l WHERE l.version_id=v.id) optional
        FROM presupuesto_versiones v LEFT JOIN users s ON s.id=v.sent_by LEFT JOIN users d ON d.id=v.decided_by
       WHERE v.presupuesto_id=$1 ${this.versionFilter()} ORDER BY v.number DESC`, [p.id])).rows;
    const shown = versionId ? versions.find((v) => v.id === versionId) : versions[0];
    if (!shown) fail(404, 'Versión no encontrada');
    const lines = (await this.pool.query(`
      SELECT ch.id capitulo_id, ch.position chapter_position, ch.name chapter_name, l.id, l.position, l.code, l.name, l.description,
             l.unit, l.quantity::text, l.unit_price::text, l.kind, l.selected, ${LINE} amount, ${COUNTED} counted, l.base_code, l.annotations,
             (SELECT to_jsonb(x) FROM (SELECT pp.id, pp.status, pp.name, pp.definition, pp.unit, pp.price_incl_vat::text "priceInclVat", pp.category_code "categoryCode",
                     pp.category_name "categoryName", pp.nearest_code "nearestCode", pp.reason, pp.created_code "createdCode"
                FROM partida_propuestas pp WHERE pp.partida_id=l.id ORDER BY pp.created_at DESC LIMIT 1) x) proposal
        FROM presupuesto_capitulos ch LEFT JOIN presupuesto_partidas l ON l.capitulo_id=ch.id
       WHERE ch.version_id=$1 ORDER BY ch.position, l.position`, [shown.id])).rows;
    const chapters = [];
    for (const l of lines) {
      let c = chapters[chapters.length - 1];
      if (!c || c.id !== l.capitulo_id) chapters.push(c = { id: l.capitulo_id, name: l.chapter_name, base: 0, items: [] });
      if (!l.id) continue;
      if (l.counted) c.base += cents(l.amount);
      c.items.push({ id: l.id, code: l.code, name: l.name, description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: l.unit_price, kind: l.kind, selected: l.selected, counted: l.counted, amount: money(cents(l.amount)),
        // How the line relates to the base de partidas: internal, team only.
        ...(team ? { baseCode: l.base_code, annotations: l.annotations || [], proposal: l.proposal && l.proposal.status === 'pending' ? l.proposal : null } : {}) });
    }
    chapters.forEach((c) => { c.base = money(c.base); });
    const comments = (await this.pool.query(`
      SELECT k.id, k.kind, k.body, k.created_at, k.version_id, v.number version_number, u.name author, u.role author_role
        FROM presupuesto_comentarios k LEFT JOIN users u ON u.id=k.author_id LEFT JOIN presupuesto_versiones v ON v.id=k.version_id
       WHERE k.presupuesto_id=$1 ORDER BY k.id`, [p.id])).rows;
    const people = (await this.pool.query('SELECT id, name, email FROM users WHERE id=ANY($1::uuid[])', [[p.client_id, p.jefe_id].filter(Boolean)])).rows;
    const person = (pid) => { const u = people.find((x) => x.id === pid); return u ? { id: u.id, name: u.name || u.email } : null; };
    const parent = p.parent_id ? (await this.pool.query('SELECT id, ref, title FROM presupuestos WHERE id=$1', [p.parent_id])).rows[0] : null;
    const latestAll = versions[0];
    const latestSent = versions.find((v) => v.status !== 'draft');
    const isOwner = this.isClient && p.client_id === this.user.id;
    const approved = versions.some((v) => v.status === 'approved');
    const ampliaciones = p.parent_id ? [] : (await this.list()).filter((r) => r.parent?.id === p.id);
    const obra = !p.parent_id && approved ? await this.obra(p) : null;
    return {
      id: p.id, ref: p.ref, title: p.title, address: p.address, parent, client: person(p.client_id), jefe: person(p.jefe_id),
      startDate: p.start_date ? toDate(p.start_date) : null, endDate: p.end_date ? toDate(p.end_date) : null,
      phase: this.phase(p, (team ? latestAll : latestSent)?.status),
      versions: versions.map((v) => ({ id: v.id, number: v.number, status: v.status, sentAt: v.sent_at, sentBy: v.sent_by, decidedAt: v.decided_at, decidedBy: v.decided_by, ...this.totals(v.base, v.optional, v.vat_rate) })),
      version: { id: shown.id, number: shown.number, status: shown.status, notes: shown.notes, sentAt: shown.sent_at, decidedAt: shown.decided_at, ...this.totals(shown.base,shown.optional, shown.vat_rate), chapters },
      comments: comments.map((k) => ({ id: Number(k.id), kind: k.kind, body: k.body, at: k.created_at, versionNumber: k.version_number, author: k.author, team: k.author_role !== 'client' })),
      ampliaciones, obra,
      can: {
        edit: team && !!latestAll && ['draft', 'sent', 'changes_requested'].includes(latestAll.status),
        send: team && latestAll?.status === 'draft',
        decide: isOwner && latestSent?.status === 'sent' && shown.id === latestSent.id,
        comment: team || isOwner,
        schedule: team && !p.parent_id && approved,
        declare: team && !p.parent_id && approved && !!p.start_date,
        ampliar: team && !p.parent_id && approved,
        assignJefe: this.user.role === 'admin' && !p.parent_id,
        // Clients are invited to the obra (root presupuesto): /api/invitaciones.
        invite: team && !p.parent_id,
      },
    };
  }

  async obra(p) {
    const lines = await this.obraLines([p.id]);
    const groups = [];
    const tot = { base: 0, vat: 0, executed: 0, consumed: 0 };
    const byVersion = new Map();
    for (const l of lines) {
      let g = groups[groups.length - 1];
      if (!g || g.id !== l.capitulo_id) groups.push(g = { id: l.capitulo_id, name: l.chapter_name, presupuesto: { id: l.presupuesto_id, ref: l.ref, title: l.title, ampliacion: !!l.parent_id }, base: 0, executed: 0, consumed: 0, items: [] });
      const f = this.lineFigures(l);
      g.base += f.amount; g.executed += f.executedAmount; g.consumed += f.consumed;
      tot.base += f.amount; tot.executed += f.executedAmount; tot.consumed += f.consumed;
      byVersion.set(l.version_id, { rate: l.vat_rate, base: (byVersion.get(l.version_id)?.base || 0) + f.amount });
      g.items.push({ id: l.id, code: l.code, name: l.name, description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: l.unit_price, kind: l.kind,
        amount: money(f.amount), executed: l.executed, executedAmount: money(f.executedAmount), consumed: money(f.consumed),
        executionPct: pct(Math.min(Number(l.executed), Number(l.quantity)), Number(l.quantity)), excess: Number(l.executed) > Number(l.quantity),
        lastDeclared: l.last ? { at: l.last.at, by: l.last.by, note: l.last.note } : null });
    }
    for (const v of byVersion.values()) tot.vat += vatOf(v.base, v.rate);
    return {
      startDate: p.start_date ? toDate(p.start_date) : null, endDate: p.end_date ? toDate(p.end_date) : null,
      base: money(tot.base), vat: money(tot.vat), total: money(Math.round(tot.base) + tot.vat),
      executedAmount: money(tot.executed), consumed: money(tot.consumed),
      executionPct: pct(tot.executed, tot.base), consumedPct: pct(tot.consumed, tot.base),
      chapters: groups.map((g) => ({ ...g, base: money(g.base), executedAmount: money(g.executed), consumed: money(g.consumed), executionPct: pct(g.executed, g.base), consumedPct: pct(g.consumed, g.base), executed: undefined })),
    };
  }

  // New-budget form: clients to send to and jefes to assign. A jefe creates
  // budgets for themselves, so they only get the clients.
  async options() {
    if (!['admin', 'jefe'].includes(this.user.role)) fail(403, 'Solo el equipo puede crear presupuestos');
    const rows = (await this.pool.query("SELECT id, name, email, role, registered_at IS NOT NULL registered FROM users WHERE role IN ('client','jefe','admin') ORDER BY coalesce(name,email)")).rows;
    const pick = (role) => rows.filter((u) => u.role === role).map((u) => ({ id: u.id, name: u.name || u.email, email: u.email, registered: u.registered }));
    // Obras a new presupuesto can join (as one more budget of the obra, approved
    // separately): approved main presupuestos the user runs (an admin: all).
    const obras = (await this.pool.query(`
      SELECT p.id, p.ref, p.title, p.address, p.client_id FROM presupuestos p
       WHERE p.parent_id IS NULL AND (${this.user.role === 'admin' ? 'true' : 'p.jefe_id=$1'})
         AND EXISTS (SELECT 1 FROM presupuesto_versiones v WHERE v.presupuesto_id=p.id AND v.status='approved')
       ORDER BY p.created_at DESC`, this.user.role === 'admin' ? [] : [this.user.id])).rows
      .map((p) => ({ id: p.id, ref: p.ref, title: p.title, address: p.address, clientId: p.client_id }));
    // An admin may also be the person in charge of an obra.
    if (this.user.role === 'jefe') return { clients: pick('client'), jefes: [{ id: this.user.id, name: this.user.name || this.user.email, email: this.user.email }], obras };
    return { clients: pick('client'), jefes: [...pick('jefe'), ...pick('admin')], obras };
  }

  // A draft saved again replaces its pending proposals with the ones it now carries.
  async writeContent(db, versionId, content) {
    await db.query('UPDATE presupuesto_versiones SET vat_rate=$2, notes=$3 WHERE id=$1', [versionId, content.vatRate, content.notes]);
    await db.query("DELETE FROM partida_propuestas WHERE status='pending' AND partida_id IN (SELECT id FROM presupuesto_partidas WHERE version_id=$1)", [versionId]);
    await db.query('DELETE FROM presupuesto_capitulos WHERE version_id=$1', [versionId]);
    const p = (await db.query('SELECT p.id, p.ref, p.title FROM presupuesto_versiones v JOIN presupuestos p ON p.id=v.presupuesto_id WHERE v.id=$1', [versionId])).rows[0];
    for (const [ci, c] of content.chapters.entries()) {
      const chId = (await db.query('INSERT INTO presupuesto_capitulos (version_id, position, name) VALUES ($1,$2,$3) RETURNING id', [versionId, ci + 1, c.name])).rows[0].id;
      for (const [ii, i] of c.items.entries()) {
        const line = (await db.query(`INSERT INTO presupuesto_partidas (version_id, capitulo_id, position, code, name, description, unit, quantity, unit_price, kind, base_code, annotations)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [versionId, chId, ii + 1, i.code, i.name, i.description, i.unit, i.quantity, i.unitPrice, i.kind, i.baseCode || null, JSON.stringify(i.annotations || [])])).rows[0];
        if (i.proposal && !i.baseCode) await this.propose(db, line.id, p, i.proposal, content.sourceFile);
      }
    }
  }

  async propose(db, partidaId, p, x, sourceFile) {
    const file = sourceFile ? `«${sourceFile}»` : 'un presupuesto en PDF';
    const origin = `Partida propuesta el ${new Date().toISOString().slice(0, 10)} a partir de ${file} para la obra ${p.ref} «${p.title}». Partida más próxima descartada: ${x.nearestCode || 'ninguna'}.`;
    const priceSource = x.priceInclVat == null ? null : `Precio de venta del presupuesto ${p.ref} (${file}) presentado al cliente`;
    await db.query(`INSERT INTO partida_propuestas (partida_id, presupuesto_id, category_code, category_name, name, definition, unit, price_incl_vat, price_source, nearest_code, reason, origin, created_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [partidaId, p.id, x.categoryCode, x.categoryName, x.name, x.definition, x.unit, x.priceInclVat, priceSource, x.nearestCode, x.reason, origin, this.user.id || null]);
  }

  async create(body = {}) {
    const content = parseContent(body);
    const title = text(body.title, 'el título', { max: 200, required: true });
    const address = text(body.address, 'Dirección', { max: 300 });
    const id = await this.tx(async (db) => {
      let clientId, jefeId;
      if (body.parentId) {
        // Ampliación: same client and jefe as the approved obra it extends.
        const parent = await this.load(db, body.parentId, { lock: true });
        if (!this.isTeam(parent)) fail(403, 'No tienes permiso para ampliar esta obra');
        if (parent.parent_id) fail(400, 'Una ampliación se añade a la obra principal');
        if (!(await db.query("SELECT 1 FROM presupuesto_versiones WHERE presupuesto_id=$1 AND status='approved'", [parent.id])).rows.length) fail(409, 'Solo se amplía un presupuesto aprobado');
        clientId = parent.client_id; jefeId = parent.jefe_id;
      } else {
        // An admin creates for any jefe; a jefe creates the budgets they will run.
        if (!['admin', 'jefe'].includes(this.user.role)) fail(403, 'Solo el equipo puede crear presupuestos');
        if (!isUuid(body.clientId)) fail(400, 'Selecciona el cliente');
        const c = (await db.query('SELECT role FROM users WHERE id=$1', [body.clientId])).rows[0];
        if (c?.role !== 'client') fail(400, 'El destinatario debe ser un usuario cliente');
        clientId = body.clientId;
        if (this.user.role === 'jefe') jefeId = this.user.id;
        else if (body.jefeId) {
          if (!isUuid(body.jefeId)) fail(400, 'Jefe de obra no válido');
          const j = (await db.query('SELECT role FROM users WHERE id=$1', [body.jefeId])).rows[0];
          if (j?.role !== 'jefe' && j?.role !== 'admin') fail(400, 'El responsable debe ser un jefe de obra o un administrador');
          jefeId = body.jefeId;
        }
      }
      const p = (await db.query(`INSERT INTO presupuestos (title, address, client_id, jefe_id, parent_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [title, address, clientId, jefeId || null, body.parentId || null, this.user.id])).rows[0];
      const v = (await db.query('INSERT INTO presupuesto_versiones (presupuesto_id, number, created_by) VALUES ($1,1,$2) RETURNING id', [p.id, this.user.id])).rows[0];
      await this.writeContent(db, v.id, content);
      return p.id;
    });
    return this.get(id);
  }

  // Saves the draft. While the client has a version in hand (sent or with
  // changes requested) the draft is a new version; approved/rejected are final.
  async saveDraft(id, body = {}) {
    const content = parseContent(body);
    await this.tx(async (db) => {
      const p = await this.load(db, id, { lock: true });
      if (!this.isTeam(p)) fail(403, 'No tienes permiso para editar este presupuesto');
      const last = await this.latest(db, p.id);
      if (!['draft', 'sent', 'changes_requested'].includes(last.status)) fail(409, 'Este presupuesto ya está cerrado: aprobado o rechazado');
      if (body.version !== undefined && body.version !== last.number) fail(409, 'El presupuesto ha cambiado mientras lo editabas. Recárgalo.');
      const title = text(body.title, 'el título', { max: 200 });
      const address = body.address === undefined ? p.address : text(body.address, 'Dirección', { max: 300 });
      await db.query('UPDATE presupuestos SET title=coalesce($2,title), address=$3, updated_at=now() WHERE id=$1', [p.id, title, address]);
      const versionId = last.status === 'draft' ? last.id
        : (await db.query('INSERT INTO presupuesto_versiones (presupuesto_id, number, created_by) VALUES ($1,$2,$3) RETURNING id', [p.id, last.number + 1, this.user.id])).rows[0].id;
      await this.writeContent(db, versionId, content);
    });
    return this.get(id);
  }

  async send(id) {
    await this.tx(async (db) => {
      const p = await this.load(db, id, { lock: true });
      if (!this.isTeam(p)) fail(403, 'No tienes permiso para enviar este presupuesto');
      const last = await this.latest(db, p.id);
      if (last.status !== 'draft') fail(409, 'No hay ningún borrador por enviar');
      const n = (await db.query('SELECT count(*)::int n FROM presupuesto_partidas WHERE version_id=$1', [last.id])).rows[0].n;
      if (!n) fail(400, 'Añade al menos una partida antes de enviarlo');
      await db.query("UPDATE presupuesto_versiones SET status='superseded' WHERE presupuesto_id=$1 AND status IN ('sent','changes_requested')", [p.id]);
      await db.query("UPDATE presupuesto_versiones SET status='sent', sent_at=now(), sent_by=$2 WHERE id=$1", [last.id, this.user.id]);
      await audit({ actor: this.actor(), action: 'Presupuesto enviado', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} v${last.number} · ${p.title}` }, db);
    });
    return this.get(id);
  }

  // Client decisions act on the version they were shown, which must still be the
  // one awaiting their answer.
  async decision(db, id, versionId) {
    const p = await this.load(db, id, { lock: true });
    if (!this.isClient || p.client_id !== this.user.id) fail(403, 'Solo el cliente puede decidir sobre su presupuesto');
    const v = await this.latest(db, p.id, { sentOnly: true });
    if (!v || v.id !== versionId) fail(409, 'Hay una versión más reciente de este presupuesto. Recárgalo.');
    if (v.status !== 'sent') fail(409, 'Este presupuesto ya no espera tu decisión');
    return { p, v };
  }

  async approve(id, body = {}) {
    const selected = body.selected ?? [];
    if (!Array.isArray(selected) || selected.length > 1000 || !selected.every(isUuid)) fail(400, 'Selección de partidas no válida');
    await this.tx(async (db) => {
      const { p, v } = await this.decision(db, id, body.versionId);
      if (selected.length) {
        const ok = (await db.query("SELECT count(*)::int n FROM presupuesto_partidas WHERE version_id=$1 AND kind IN ('decision','opcion') AND id=ANY($2::uuid[])", [v.id, selected])).rows[0].n;
        if (ok !== new Set(selected).size) fail(400, 'Solo puedes elegir partidas opcionales o pendientes de decisión de este presupuesto');
        await db.query('UPDATE presupuesto_partidas SET selected=true WHERE version_id=$1 AND id=ANY($2::uuid[])', [v.id, selected]);
      }
      await db.query("UPDATE presupuesto_versiones SET status='approved', decided_at=now(), decided_by=$2 WHERE id=$1", [v.id, this.user.id]);
      await db.query("DELETE FROM presupuesto_versiones WHERE presupuesto_id=$1 AND status='draft'", [p.id]);
      await audit({ actor: this.actor(), action: 'Presupuesto aprobado', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} v${v.number}${selected.length ? ` · ${selected.length} partidas opcionales elegidas` : ''}` }, db);
    });
    return this.get(id);
  }

  async requestChanges(id, body = {}) {
    const comment = text(body.body, 'el comentario', { max: 4000, required: true });
    await this.tx(async (db) => {
      const { p, v } = await this.decision(db, id, body.versionId);
      await db.query("UPDATE presupuesto_versiones SET status='changes_requested', decided_at=now(), decided_by=$2 WHERE id=$1", [v.id, this.user.id]);
      await db.query("INSERT INTO presupuesto_comentarios (presupuesto_id, version_id, author_id, kind, body) VALUES ($1,$2,$3,'cambios',$4)", [p.id, v.id, this.user.id, comment]);
      await audit({ actor: this.actor(), action: 'Cambios solicitados en presupuesto', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} v${v.number}` }, db);
    });
    return this.get(id);
  }

  async reject(id, body = {}) {
    const comment = text(body.body, 'el motivo', { max: 4000 });
    await this.tx(async (db) => {
      const { p, v } = await this.decision(db, id, body.versionId);
      await db.query("UPDATE presupuesto_versiones SET status='rejected', decided_at=now(), decided_by=$2 WHERE id=$1", [v.id, this.user.id]);
      await db.query("DELETE FROM presupuesto_versiones WHERE presupuesto_id=$1 AND status='draft'", [p.id]);
      if (comment) await db.query("INSERT INTO presupuesto_comentarios (presupuesto_id, version_id, author_id, kind, body) VALUES ($1,$2,$3,'rechazo',$4)", [p.id, v.id, this.user.id, comment]);
      await audit({ actor: this.actor(), action: 'Presupuesto rechazado', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} v${v.number}` }, db);
    });
    return this.get(id);
  }

  async comment(id, body = {}) {
    const comment = text(body.body, 'el comentario', { max: 4000, required: true });
    await this.tx(async (db) => {
      const p = await this.load(db, id);
      if (!this.isTeam(p) && !(this.isClient && p.client_id === this.user.id)) fail(403, 'No puedes comentar este presupuesto');
      const v = await this.latest(db, p.id, { sentOnly: this.isClient });
      await db.query('INSERT INTO presupuesto_comentarios (presupuesto_id, version_id, author_id, body) VALUES ($1,$2,$3,$4)', [p.id, v?.id || null, this.user.id, comment]);
    });
    return this.get(id);
  }

  // Admins change who is in charge of an obra; its ampliaciones follow.
  async assignJefe(id, body = {}) {
    if (this.user.role !== 'admin') fail(403, 'Solo un administrador asigna el jefe de obra');
    if (body.jefeId !== null && !isUuid(body.jefeId)) fail(400, 'Jefe de obra no válido');
    await this.tx(async (db) => {
      const p = await this.load(db, id, { lock: true });
      if (p.parent_id) fail(400, 'El jefe se asigna en la obra principal');
      const j = body.jefeId ? (await db.query('SELECT id, name, email, role FROM users WHERE id=$1', [body.jefeId])).rows[0] : null;
      if (body.jefeId && j?.role !== 'jefe' && j?.role !== 'admin') fail(400, 'El responsable debe ser un jefe de obra o un administrador');
      if ((p.jefe_id || null) === (j?.id || null)) return;
      await db.query('UPDATE presupuestos SET jefe_id=$2, updated_at=now() WHERE id=$1 OR parent_id=$1', [p.id, j?.id || null]);
      await audit({ actor: this.actor(), action: 'Jefe de obra asignado', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} · ${j ? j.name || j.email : 'sin asignar'}` }, db);
    });
    return this.get(id);
  }

  async schedule(id, body = {}) {
    const start = date(body.startDate, 'Fecha de inicio'), end = date(body.endDate, 'Fecha de fin prevista');
    if (!start) fail(400, 'Indica la fecha de inicio');
    if (end && end < start) fail(400, 'La fecha de fin no puede ser anterior al inicio');
    await this.tx(async (db) => {
      const p = await this.load(db, id, { lock: true });
      if (!this.isTeam(p)) fail(403, 'No tienes permiso para planificar esta obra');
      if (p.parent_id) fail(400, 'Las fechas se fijan en la obra principal');
      if (!(await db.query("SELECT 1 FROM presupuesto_versiones WHERE presupuesto_id=$1 AND status='approved'", [p.id])).rows.length) fail(409, 'El presupuesto aún no está aprobado');
      await db.query('UPDATE presupuestos SET start_date=$2, end_date=$3, updated_at=now() WHERE id=$1', [p.id, start, end]);
      await audit({ actor: this.actor(), action: 'Fechas de obra', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} · inicio ${start}${end ? ` · fin prevista ${end}` : ''}` }, db);
    });
    return this.get(id);
  }

  // Production: executed quantity per approved line of the obra (root and
  // approved ampliaciones). Only changed lines are recorded.
  async declare(id, body = {}) {
    const items = body.items;
    if (!Array.isArray(items) || !items.length || items.length > 1000) fail(400, 'Indica la producción de al menos una partida');
    const parsed = items.map((i, n) => {
      if (!isUuid(i?.partidaId)) fail(400, `Partida ${n + 1} no válida`);
      return { partidaId: i.partidaId, executed: decimal(i.executed, 'Cantidad ejecutada', 4, { allowZero: true }), note: text(i.note, 'Nota', { max: 1000 }) };
    });
    await this.tx(async (db) => {
      const p = await this.load(db, id, { lock: true });
      if (!this.isTeam(p)) fail(403, 'Solo el jefe de esta obra declara su producción');
      if (p.parent_id) fail(400, 'La producción se declara en la obra principal');
      if (!p.start_date) fail(409, 'La obra aún no tiene fecha de inicio');
      const lines = new Map((await this.obraLines([p.id], db)).map((l) => [l.id, l]));
      let changed = 0;
      for (const i of parsed) {
        const l = lines.get(i.partidaId);
        if (!l) fail(400, 'Esa partida no pertenece a lo aprobado en esta obra');
        if (Number(i.executed) > Number(l.quantity) * 10) fail(400, `«${l.name}»: la cantidad ejecutada es más de diez veces la presupuestada`);
        if (Number(i.executed) === Number(l.executed) && !i.note) continue;
        await db.query('INSERT INTO presupuesto_produccion (partida_id, executed, note, declared_by) VALUES ($1,$2,$3,$4)', [i.partidaId, i.executed, i.note, this.user.id]);
        changed++;
      }
      if (changed) await audit({ actor: this.actor(), action: 'Producción declarada', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} · ${changed} partida${changed === 1 ? '' : 's'}` }, db);
    });
    return this.get(id);
  }
}

// pg returns DATE columns as local-midnight Date objects; format without UTC shift.
function toDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
