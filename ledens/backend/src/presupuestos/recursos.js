import { PresupuestoError } from './service.js';

// Gestión de recursos: the company's workers (ledens.employees, the list of
// Gestión financiera → Trabajadores) and where each one works. Every cuadrilla
// of an obra's Planificación is one oficial and one peón (migration 043,
// gantt_cuadrilla_miembros, chosen in the Gantt — see gantt.js setCuadrillas).
// RecursosService.list() is the «Recursos» screen: each worker with their
// obras, the period each obra occupies in its Gantt (first start → last end of
// its tasks, recalculated like the chart) and the assignments that overlap in
// time (the same person in two obras at once). Pay is never read here.
// Team only (admin and jefe de obra): a jefe needs to see who is busy
// elsewhere before choosing a cuadrilla.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
export const ROLES = ['oficial', 'peon'];
// Id of the internal reader of every obra's Gantt (no such user: it only reads).
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
export const ROL_LABEL = { oficial: 'Oficial', peon: 'Peón' };

// Role the worker's puesto suggests (the Gantt lists them first for it).
export function rolDePuesto(puesto) {
  const p = String(puesto || '');
  if (/oficial|encargad/i.test(p)) return 'oficial';
  if (/pe[oó]n|ayudante|auxiliar|peonaje/i.test(p)) return 'peon';
  return null;
}

// Whether the accounting import's worker tables exist here (checked without
// raising, so it is safe inside a transaction).
export async function workersAvailable(db) {
  const r = (await db.query("SELECT to_regclass('ledens.employees') IS NOT NULL e, to_regclass('ledens.positions') IS NOT NULL p")).rows[0];
  return !!(r?.e && r?.p);
}

// Active workers, plus the ones in `ids` even when deactivated (so an obra
// still shows who was in it). Map id → { id, name, puesto, rol, activo }.
export async function loadWorkers(db, ids = []) {
  if (!(await workersAvailable(db))) return null;
  const rows = (await db.query(`SELECT e.id, e.name, po.name puesto, coalesce(e.activo, true) activo
                                FROM ledens.employees e LEFT JOIN ledens.positions po ON po.id = e.primary_position_id
                                WHERE coalesce(e.activo, true) OR e.id = ANY($1::uuid[])
                                ORDER BY e.name, e.id`, [ids])).rows;
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name || 'Sin nombre', puesto: r.puesto || null, rol: rolDePuesto(r.puesto), activo: r.activo }]));
}

// Members of the cuadrillas of these obras: Map obraId → [{ cuadrilla, rol, employee_id }].
export async function loadMembers(db, obraIds) {
  const out = new Map();
  if (!obraIds.length) return out;
  const rows = (await db.query('SELECT obra_id, cuadrilla, rol, employee_id FROM gantt_cuadrilla_miembros WHERE obra_id = ANY($1::uuid[]) ORDER BY cuadrilla, rol', [obraIds])).rows;
  for (const r of rows) { if (!out.has(r.obra_id)) out.set(r.obra_id, []); out.get(r.obra_id).push(r); }
  return out;
}

// The cuadrillas 1..n of an obra with their oficial and peón (null = missing).
export function equipos(n, members = [], workers = new Map()) {
  const person = (id) => (id ? workers.get(id) || { id, name: 'Trabajador no encontrado', puesto: null, rol: null, activo: false } : null);
  return Array.from({ length: n }, (_, i) => {
    const of = members.filter((m) => m.cuadrilla === i + 1);
    return { cuadrilla: i + 1, oficial: person(of.find((m) => m.rol === 'oficial')?.employee_id), peon: person(of.find((m) => m.rol === 'peon')?.employee_id) };
  });
}
// Complete: every cuadrilla has its oficial and its peón, all of them active.
export const completos = (eqs) => eqs.every((e) => e.oficial?.activo && e.peon?.activo);

// Two periods [desde, hasta] (dates 'YYYY-MM-DD', both included) overlap.
const overlap = (a, b) => (a.desde <= b.hasta && b.desde <= a.hasta ? { desde: a.desde > b.desde ? a.desde : b.desde, hasta: a.hasta < b.hasta ? a.hasta : b.hasta } : null);

export class RecursosService {
  // gantt: a GanttService factory (user → service), injected to avoid a cycle.
  constructor(pool, user, gantt) { this.pool = pool; this.user = user; this.gantt = gantt; }

  async list({ today = new Date().toISOString().slice(0, 10) } = {}) {
    if (!['admin', 'jefe'].includes(this.user.role)) fail(403, 'Solo el equipo ve los recursos');
    const rows = (await this.pool.query(`SELECT m.obra_id, m.cuadrilla, m.rol, m.employee_id, p.ref, p.title, p.project_id
                                         FROM gantt_cuadrilla_miembros m JOIN presupuestos p ON p.id = m.obra_id
                                         LEFT JOIN gantt_obras g ON g.obra_id = m.obra_id
                                         WHERE m.cuadrilla <= coalesce(g.cuadrillas, 1)
                                         ORDER BY p.ref, m.cuadrilla, m.rol`)).rows;
    const workers = await loadWorkers(this.pool, [...new Set(rows.map((r) => r.employee_id))]);
    if (!workers) fail(503, 'La lista de trabajadores no está disponible');

    // Period of each obra in its Gantt (read as an admin: the screen needs every
    // obra a worker is in, whoever runs it; only refs, names and dates leave here).
    const planner = this.gantt({ role: 'admin', id: SYSTEM_ID, name: 'Recursos' });
    const periods = new Map(), projects = new Map();
    for (const projectId of [...new Set(rows.map((r) => r.project_id).filter(Boolean))]) {
      const g = await planner.get(projectId).catch(() => null);
      if (!g) continue;
      projects.set(projectId, g.project);
      for (const o of g.obras) {
        const ts = g.tasks.filter((t) => t.obraId === o.id);
        const desde = ts.map((t) => t.start).sort()[0] || o.plannedStart;
        const hasta = ts.map((t) => t.end).sort().pop() || o.plannedStart;
        periods.set(o.id, { desde, hasta, terminada: ts.length > 0 && ts.every((t) => t.executionPct >= 100) });
      }
    }

    const byWorker = new Map();
    for (const r of rows) {
      const p = periods.get(r.obra_id);
      const a = {
        obraId: r.obra_id, ref: r.ref, title: r.title, project: r.project_id ? projects.get(r.project_id) || { id: r.project_id } : null,
        cuadrilla: r.cuadrilla, rol: r.rol, desde: p?.desde || null, hasta: p?.hasta || null, terminada: !!p?.terminada, planificada: !!p,
      };
      if (!byWorker.has(r.employee_id)) byWorker.set(r.employee_id, []);
      byWorker.get(r.employee_id).push(a);
    }
    const trabajadores = [...workers.values()].map((w) => {
      const asignaciones = (byWorker.get(w.id) || []).sort((a, b) => String(a.desde || '9').localeCompare(String(b.desde || '9')) || a.ref.localeCompare(b.ref));
      // Overlaps that still matter: two obras not finished whose periods meet today or later.
      const vivas = asignaciones.filter((a) => a.planificada && !a.terminada && a.hasta >= today);
      const solapes = [];
      for (let i = 0; i < vivas.length; i++) {
        for (let j = i + 1; j < vivas.length; j++) {
          if (vivas[i].obraId === vivas[j].obraId) continue;
          const o = overlap(vivas[i], vivas[j]);
          if (o && o.hasta >= today) solapes.push({ obras: [vivas[i].ref, vivas[j].ref], ...o });
        }
      }
      const actual = vivas.filter((a) => a.desde <= today).map((a) => a.ref);
      return { ...w, asignaciones, solapes, estado: solapes.length ? 'solape' : actual.length ? 'en_obra' : vivas.length ? 'reservado' : 'libre' };
    });
    trabajadores.sort((a, b) => Number(b.activo) - Number(a.activo) || a.name.localeCompare(b.name, 'es'));
    const n = (k) => trabajadores.filter((t) => t.activo && t.estado === k).length;
    return {
      today,
      trabajadores,
      resumen: { trabajadores: trabajadores.filter((t) => t.activo).length, enObra: n('en_obra'), reservados: n('reservado'), libres: n('libre'), conSolape: n('solape') },
    };
  }
}
