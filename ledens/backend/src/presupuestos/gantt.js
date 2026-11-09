import { audit } from '../db/audit.js';
import { PresupuestoError, PresupuestosService, isUuid } from './service.js';

// Planificación (Gantt) of a project of Gestión financiera with at least one
// approved presupuesto (migration 035). Tasks are the approved lines of its
// obras (root + approved ampliaciones, the same lines «Actualizar avance»
// updates). Duration in working days (Mon–Fri):
//   - the one the team set for the task, else
//   - quantity ÷ rendimiento of its partida in the base (ledens.work_items,
//     matched by base_code, else by the line's own PA-### code), rounded up;
//     a rendimiento column measured in hours per unit (its name says «hora»)
//     is turned into days of 8 h; else
//   - 1 day, flagged so the team sets it.
// Start: the obra's start date (else the project's, else today), pushed by its
// predecessors — FS (fin → inicio), SS (inicio → inicio), FF (fin → fin) or
// SF (inicio → fin), each with a lag in working days. Dates are never stored:
// every answer recalculates them, so a change in the table moves the chart.
// Who: the team that may see the project reads it; the assigned jefe of the
// obra (or an admin) changes its tasks.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
export const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];
const HOURS_PER_DAY = 8;
const MAX_DAYS = 3650;

// --- Working days (Mon–Fri), dates as 'YYYY-MM-DD' in UTC -------------------
const DAY = 86400000;
const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
const wd = (t) => (new Date(t).getUTCDay() + 6) % 7; // 0 = Monday … 6 = Sunday
const monday = (t) => t - wd(t) * DAY;
export function toWorkday(s) {
  let t = parse(s);
  while (wd(t) > 4) t += DAY;
  return fmt(t);
}
// Calendar of working days counted from `base` (a working day, index 0).
export function calendar(base) {
  const b = parse(base), bm = monday(b), bw = wd(b);
  return {
    date(i) {
      const total = bw + i, weeks = Math.floor(total / 5);
      return fmt(bm + weeks * 7 * DAY + (total - weeks * 5) * DAY);
    },
    index(s) {
      const t = parse(toWorkday(s));
      return Math.round((monday(t) - bm) / (7 * DAY)) * 5 + wd(t) - bw;
    },
  };
}

// Forward pass over the dependencies. tasks: [{ id, earliest, duration }],
// deps: [{ partida_id, predecessor_id, type, lag_days }]. Returns
// Map id → { start, end } (working-day indexes, end inclusive), or throws on a cycle.
export function schedule(tasks, deps, names = new Map()) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = new Map(tasks.map((t) => [t.id, []]));
  const succs = new Map(tasks.map((t) => [t.id, []]));
  for (const d of deps) {
    if (!byId.has(d.partida_id) || !byId.has(d.predecessor_id)) continue;
    preds.get(d.partida_id).push(d);
    succs.get(d.predecessor_id).push(d.partida_id);
  }
  const pending = new Map(tasks.map((t) => [t.id, preds.get(t.id).length]));
  const queue = tasks.filter((t) => !pending.get(t.id)).map((t) => t.id);
  const out = new Map();
  while (queue.length) {
    const id = queue.shift(), t = byId.get(id), dur = t.duration;
    let s = t.earliest;
    for (const d of preds.get(id)) {
      const p = out.get(d.predecessor_id), lag = Number(d.lag_days) || 0;
      const c = d.type === 'SS' ? p.start + lag
        : d.type === 'FF' ? p.end + lag - dur + 1
          : d.type === 'SF' ? p.start + lag - dur + 1
            : p.end + 1 + lag;
      if (c > s) s = c;
    }
    out.set(id, { start: s, end: s + dur - 1 });
    for (const n of succs.get(id)) {
      pending.set(n, pending.get(n) - 1);
      if (!pending.get(n)) queue.push(n);
    }
  }
  if (out.size < tasks.length) {
    const loop = tasks.filter((t) => !out.has(t.id)).map((t) => names.get(t.id) || t.id).slice(0, 4);
    fail(400, `Las predecesoras forman un ciclo: ${loop.join(', ')}${tasks.length - out.size > 4 ? '…' : ''}. Quita alguna relación.`);
  }
  return out;
}

// Duration from the base: rendimiento in units per working day (or hours per
// unit when the column says so).
export function durationFrom(quantity, rendimiento, perHour) {
  const q = Number(quantity), r = Number(rendimiento);
  if (!(q > 0) || !(r > 0)) return null;
  const days = perHour ? q * r / HOURS_PER_DAY : q / r;
  return Math.min(MAX_DAYS, Math.max(1, Math.ceil(days - 1e-9)));
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = String(v).trim().replace(/\s/g, '');
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};

export class GanttService {
  constructor(pool, user) { this.pool = pool; this.user = user; this.svc = new PresupuestosService(pool, user); }

  // The rendimiento column of ledens.work_items (the import names it; read
  // from the catalog): numeric first, then the one about a crew / day.
  async rendimientoColumn(db) {
    const rows = (await db.query(`SELECT column_name c, data_type t FROM information_schema.columns
                                   WHERE table_schema='ledens' AND table_name='work_items'`)).rows;
    const cands = rows.filter((r) => /rendimiento/i.test(r.c) && !/validad|observ|nota|fuente|origen/i.test(r.c));
    const score = (r) => (/numeric|integer|double|real|smallint|bigint/.test(r.t) ? 4 : 0) + (/cuadrilla|dia|jornada/i.test(r.c) ? 2 : 0) + (/hora/i.test(r.c) ? -1 : 0);
    cands.sort((a, b) => score(b) - score(a) || a.c.localeCompare(b.c));
    return cands[0] ? { name: cands[0].c, perHour: /hora/i.test(cands[0].c) } : null;
  }

  async rendimientos(db, codes) {
    const col = await this.rendimientoColumn(db).catch(() => null);
    const out = new Map();
    if (!col || !codes.length) return { col, map: out };
    const rows = (await db.query('SELECT id_partida, to_jsonb(w)->>$1 r FROM ledens.work_items w WHERE id_partida = ANY($2::text[])', [col.name, codes])).rows;
    for (const r of rows) { const n = num(r.r); if (n !== null && n > 0 && !out.has(r.id_partida)) out.set(r.id_partida, n); }
    return { col, map: out };
  }

  // Project, approved obras and their lines, with the stored choices.
  async load(projectId, db = this.pool) {
    const view = await this.svc.projectView(projectId); // team only; 404 when the user may not see it
    const obras = view.presupuestos.filter((r) => !r.parent && ['aprobado', 'en_curso'].includes(r.phase));
    if (!obras.length) fail(409, 'El proyecto aún no tiene ningún presupuesto aprobado');
    const lines = await this.svc.obraLines(obras.map((o) => o.id), db);
    const ids = lines.map((l) => l.id);
    const extra = new Map((await db.query('SELECT id, base_code FROM presupuesto_partidas WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => [r.id, r.base_code]));
    const overrides = new Map((await db.query('SELECT partida_id, duration_days FROM gantt_tareas WHERE partida_id = ANY($1::uuid[])', [ids])).rows.map((r) => [r.partida_id, r.duration_days]));
    const deps = (await db.query('SELECT partida_id, predecessor_id, type, lag_days FROM gantt_dependencias WHERE partida_id = ANY($1::uuid[]) ORDER BY predecessor_id', [ids])).rows;
    return { view, obras, lines, extra, overrides, deps };
  }

  async get(projectId, db = this.pool) {
    const { view, obras, lines, extra, overrides, deps } = await this.load(projectId, db);
    const codeOf = (l) => extra.get(l.id) || (/^PA-\d+$/i.test(String(l.code || '').trim()) ? String(l.code).trim().toUpperCase() : null);
    const { col, map: rend } = await this.rendimientos(db, [...new Set(lines.map(codeOf).filter(Boolean))]);
    const today = new Date().toISOString().slice(0, 10);
    const obraStart = new Map(obras.map((o) => [o.id, toWorkday(o.startDate || view.project.startDate?.slice(0, 10) || today)]));
    const base = [...obraStart.values()].sort()[0];
    const cal = calendar(base);
    const names = new Map(lines.map((l) => [l.id, `${l.code ? `${l.code} ` : ''}${l.name}`]));
    const tasks = lines.map((l) => {
      const code = codeOf(l), r = code ? rend.get(code) ?? null : null;
      const computed = durationFrom(l.quantity, r, col?.perHour);
      const override = overrides.get(l.id) ?? null;
      return { l, code, r, computed, override, id: l.id, earliest: cal.index(obraStart.get(l.obra_id)), duration: override || computed || 1 };
    });
    const sched = schedule(tasks, deps, names);
    const obraOf = new Map(obras.map((o) => [o.id, o]));
    const canEdit = (obraId) => this.user.role === 'admin' || obraOf.get(obraId)?.jefe?.id === this.user.id;
    const out = tasks.map((t) => {
      const s = sched.get(t.id), l = t.l;
      const q = Number(l.quantity), ex = Number(l.executed);
      return {
        id: l.id, obraId: l.obra_id, presupuesto: { id: l.presupuesto_id, ref: l.ref, title: l.title, ampliacion: !!l.parent_id },
        chapter: l.chapter_name, code: l.code, baseCode: t.code, name: l.name, unit: l.unit, quantity: l.quantity,
        rendimiento: t.r, computedDuration: t.computed, durationOverride: t.override, duration: t.duration,
        warning: t.override ? null : !t.code ? 'Partida sin código de la base: 1 día; indica la duración' : t.r === null ? 'Sin rendimiento en la base: 1 día; indica la duración' : null,
        start: cal.date(s.start), end: cal.date(s.end),
        executionPct: q > 0 ? Math.round(Math.min(ex, q) / q * 1000) / 10 : 0,
        predecessors: deps.filter((d) => d.partida_id === l.id).map((d) => ({ id: d.predecessor_id, type: d.type, lag: d.lag_days })),
        canEdit: canEdit(l.obra_id),
      };
    });
    const starts = out.map((t) => t.start).sort(), ends = out.map((t) => t.end).sort();
    return {
      project: { id: view.project.id, code: view.project.code, name: view.project.name },
      obras: obras.map((o) => ({ id: o.id, ref: o.ref, title: o.title, startDate: o.startDate, plannedStart: obraStart.get(o.id) })),
      start: starts[0] || base, end: ends[ends.length - 1] || base,
      rendimiento: col ? { column: col.name, unit: col.perHour ? 'h por unidad' : 'unidades por jornada' } : null,
      tasks: out,
    };
  }

  // Validates one task's choices (shared by update() and updateMany()):
  // { id, duration: days | null, predecessors: [{ id, type, lag }] }.
  normalize(body = {}, n = 1) {
    const partidaId = body.id;
    if (!isUuid(partidaId)) fail(404, `Tarea ${n} no encontrada`);
    let duration = body.duration;
    if (duration === '' || duration === undefined) duration = null;
    if (duration !== null) {
      duration = Number(duration);
      if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DAYS) fail(400, `La duración son días laborables enteros, de 1 a ${MAX_DAYS}`);
    }
    const list = body.predecessors ?? [];
    if (!Array.isArray(list) || list.length > 50) fail(400, 'Predecesoras no válidas');
    const seen = new Set();
    const preds = list.map((p, i) => {
      if (!isUuid(p?.id)) fail(400, `Predecesora ${i + 1} no válida`);
      if (p.id === partidaId) fail(400, 'Una tarea no puede ser su propia predecesora');
      if (seen.has(p.id)) fail(400, 'Esa predecesora está repetida');
      seen.add(p.id);
      const type = String(p.type || 'FS').toUpperCase();
      if (!DEP_TYPES.includes(type)) fail(400, 'La relación es FS, SS, FF o SF');
      const lag = p.lag === '' || p.lag === null || p.lag === undefined ? 0 : Number(p.lag);
      if (!Number.isInteger(lag) || lag < -365 || lag > 365) fail(400, 'El desfase son días laborables enteros, de -365 a 365');
      return { id: p.id, type, lag };
    });
    return { partidaId, duration, preds };
  }

  // One task's choices.
  async update(projectId, partidaId, body = {}) {
    return this.updateMany(projectId, [{ ...body, id: partidaId }]);
  }

  // Several tasks' choices at once, in one transaction: either every change
  // applies and the whole plan is revalidated once (a cycle rolls back
  // everything, nothing partially saved), or none of it does. Used both by
  // a single task's save (update(), above) and by the «guardar en bloque»
  // of the planning agent's suggestions (ganttAgente.js never writes here
  // itself — only this method does, after the jefe has reviewed).
  async updateMany(projectId, items = []) {
    if (!Array.isArray(items) || !items.length) fail(400, 'No hay tareas que guardar');
    if (items.length > 200) fail(400, 'Demasiadas tareas de una vez');
    const prepared = items.map((body, n) => this.normalize(body, n + 1));
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const { lines, obras } = await this.load(projectId, c);
      const inProject = new Set(lines.map((l) => l.id));
      const obraOf = new Map(lines.map((l) => [l.id, obras.find((o) => o.id === l.obra_id)]));
      const name = (id) => { const l = lines.find((x) => x.id === id); return l ? (l.code || l.name) : id; };
      const details = [];
      for (const { partidaId, duration, preds } of prepared) {
        if (!inProject.has(partidaId)) fail(404, 'Esa partida no es una tarea de este proyecto');
        const obra = obraOf.get(partidaId);
        if (this.user.role !== 'admin' && obra?.jefe?.id !== this.user.id) fail(403, 'Solo el jefe de esta obra o un administrador cambia su planificación');
        for (const p of preds) if (!inProject.has(p.id)) fail(400, 'La predecesora no es una tarea de este proyecto');
        if (duration === null) await c.query('DELETE FROM gantt_tareas WHERE partida_id=$1', [partidaId]);
        else await c.query(`INSERT INTO gantt_tareas (partida_id, duration_days, updated_by) VALUES ($1,$2,$3)
                            ON CONFLICT (partida_id) DO UPDATE SET duration_days=EXCLUDED.duration_days, updated_by=EXCLUDED.updated_by, updated_at=now()`, [partidaId, duration, this.user.id]);
        await c.query('DELETE FROM gantt_dependencias WHERE partida_id=$1', [partidaId]);
        for (const p of preds) await c.query('INSERT INTO gantt_dependencias (partida_id, predecessor_id, type, lag_days) VALUES ($1,$2,$3,$4)', [partidaId, p.id, p.type, p.lag]);
        const line = lines.find((l) => l.id === partidaId);
        details.push(`${line.ref} · ${line.code || line.name}: ${duration ? `${duration} días` : 'duración según rendimiento'}${preds.length ? ` · predecesoras ${preds.map((p) => `${name(p.id)} ${p.type}${p.lag ? (p.lag > 0 ? `+${p.lag}` : p.lag) : ''}`).join(', ')}` : ' · sin predecesoras'}`);
      }
      const result = await this.get(projectId, c); // throws on a cycle → rollback, nothing applied
      const label = prepared.length === 1 ? lines.find((l) => l.id === prepared[0].partidaId)?.ref : `${prepared.length} tareas`;
      await audit({ actor: { id: this.user.id, name: this.user.name || this.user.email }, action: 'Planificación modificada', target: { id: null, label }, detail: details.join('\n') }, c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }
}
