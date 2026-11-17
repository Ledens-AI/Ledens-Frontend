import { PresupuestoError } from './service.js';
import { GanttService, DEP_TYPES, schedule, calendar } from './gantt.js';

// Proposes predecessors for the Planificación (Gantt) of a project (gantt.js),
// reusing the same ANTHROPIC_API_KEY/client as the presupuestos agent. Only
// suggests — never writes gantt_tareas/gantt_dependencias itself. The model
// never computes a date: that stays schedule()'s job, used here as a cycle
// check for every relation it proposes, same as a human edit would be.
const fail = (status, message) => { throw new PresupuestoError(status, message); };

export const MODEL = process.env.GANTT_AGENTE_MODEL || 'claude-sonnet-5-5';
const MAX_PREDS_PER_TASK = 4;

export const SYSTEM = `Eres el asistente de planificación de obra de Ledens, una empresa de reformas en Málaga. Te doy la lista de tareas ya aprobadas de un proyecto (cada una es una partida del presupuesto), numeradas en el orden del Gantt, con su capítulo, nombre, unidad, cantidad y duración en días laborables. Tu trabajo es proponer qué tareas deben esperar a que otra termine o empiece, con el criterio habitual de una reforma:

Demolición y obra previa antes que instalaciones en bruto (fontanería, electricidad). Instalaciones en bruto antes que cerramientos (pladur, tabiquería húmeda). Cerramientos antes que revestimientos y pavimentos. Revestimientos y pavimentos antes que pintura. Estructuras y carpintería de obra antes que mobiliario. Mobiliario antes que los electrodomésticos, la grifería o los herrajes que se instalan sobre o dentro de él. Limpieza final, siempre la última.

No inventes una relación entre dos tareas sin un motivo constructivo real — muchas tareas no dependen de ninguna otra (pueden hacerse en cualquier momento) y deben quedar sin predecesora. No propongas más de ${MAX_PREDS_PER_TASK} predecesoras para una misma tarea. Usa casi siempre "FS" (fin → inicio); usa "SS" (inicio → inicio) solo cuando dos tareas puedan avanzar en paralelo una vez empezada la primera; usa un desfase (días laborables, negativo = solape) solo cuando de verdad haga falta (p. ej. tiempo de secado). Solo puedes referirte a tareas por el número que te doy, nunca por su nombre.

Cuadrillas: cada cuadrilla hace una sola tarea a la vez, así que en una obra con N cuadrillas no puede haber más de N tareas en marcha al mismo tiempo (las duraciones que te doy ya tienen en cuenta las cuadrillas). Te digo cuántas cuadrillas tiene cada obra. Con 1 cuadrilla las tareas de esa obra van necesariamente una tras otra: propón el orden constructivo completo, encadenando cada tarea pendiente detrás de la que le corresponda. Con varias cuadrillas, deja en paralelo solo lo que de verdad pueda avanzar a la vez sin estorbarse (p. ej. dos estancias distintas) y encadena el resto. Si aun así quedan más tareas a la vez que cuadrillas, el sistema las encadenará después por orden de inicio.

Para cada relación, explica en una frase corta el motivo constructivo. Devuelve siempre tu respuesta llamando a la herramienta "proponer_dependencias", sin texto adicional.`;

export const DEP_TOOL = {
  name: 'proponer_dependencias',
  description: 'Propone relaciones de predecesora entre las tareas numeradas dadas.',
  input_schema: {
    type: 'object',
    required: ['dependencias'],
    properties: {
      dependencias: {
        type: 'array',
        items: {
          type: 'object',
          required: ['tarea', 'predecesora', 'motivo'],
          properties: {
            tarea: { type: 'integer', description: 'Número de la tarea que espera.' },
            predecesora: { type: 'integer', description: 'Número de la tarea de la que depende.' },
            tipo: { type: 'string', enum: DEP_TYPES },
            desfaseDias: { type: 'integer', description: 'Días laborables de desfase; negativo para solape. 0 si no hace falta.' },
            motivo: { type: 'string', description: 'Motivo constructivo, una frase corta.' },
          },
        },
      },
    },
  },
};

async function askAgent(anthropic, prompt) {
  // tool_choice: {type:'tool', ...} is rejected by some models — 'auto' plus
  // the system prompt's own instruction is what works across models (same
  // fallback as the presupuestos agent, src/presupuestos/agente.js).
  const r = await anthropic.messages.create({
    model: MODEL, max_tokens: 4000, system: SYSTEM,
    tools: [DEP_TOOL], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  const use = r.content.find((b) => b.type === 'tool_use');
  if (!use) fail(502, 'El agente no ha propuesto ninguna relación.');
  return Array.isArray(use.input?.dependencias) ? use.input.dependencias : [];
}

// user/projectId: same visibility and permission rules as GanttService (team
// only to read; every task must be editable by this user to generate for it).
// anthropic: injectable for tests.
export async function ganttAgenteDraft(user, projectId, { db, anthropic } = {}) {
  if (!anthropic) fail(503, 'El agente de planificación no está configurado');
  const data = await new GanttService(db, user).get(projectId);
  const { tasks } = data;
  if (tasks.length < 2) fail(400, 'Hacen falta al menos dos tareas para proponer relaciones.');
  if (!tasks.every((t) => t.canEdit)) fail(403, 'Solo el jefe de obra asignado o un administrador puede generar la planificación.');
  // Tasks still to plan: none, or only «Inicio de obra» by default. With every
  // task tied to «Inicio de obra» or another task on purpose there is nothing
  // left to propose.
  const planned = (t) => t.predecessors.some((p) => !p.porDefecto);
  const pending = tasks.filter((t) => !planned(t));
  if (!pending.length) fail(400, 'Todas las tareas tienen ya predecesoras: no queda nada que proponer.');

  const index = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const byIndex = new Map(tasks.map((t, i) => [i + 1, t]));
  const obras = data.obras || [];
  const crews = new Map(obras.map((o) => [o.id, Math.max(1, Number(o.cuadrillas) || 1)]));
  const refOf = new Map(obras.map((o) => [o.id, o.ref]));
  const many = obras.length > 1;
  const crewText = obras.map((o) => `${many ? `Obra ${o.ref}` : 'La obra'}: ${crews.get(o.id)} ${crews.get(o.id) === 1 ? 'cuadrilla' : 'cuadrillas'}.`).join('\n');
  const lines = tasks.map((t, i) => `${i + 1}. ${many ? `{obra ${refOf.get(t.obraId)}} ` : ''}[${t.chapter || 'Sin capítulo'}] ${t.code ? `${t.code} ` : ''}${t.name} — ${t.quantity} ${t.unit}, ${t.duration} día(s)${planned(t) ? ' (ya tiene predecesora, no la toques)' : ''}`).join('\n');
  const prompt = `Tareas del proyecto «${data.project.name}» (numeradas en el orden del Gantt):\n${lines}\n\n${crewText}\n\nPropón predecesoras solo para las tareas sin ninguna todavía: ${pending.map((t) => index.get(t.id)).join(', ')}.`;

  const proposed = await askAgent(anthropic, prompt);

  // schedule() is both the cycle check and, with the real start of each obra
  // on the working-day axis (festivos included), what the nivelación below
  // reads to find tasks running at once. «Inicio de obra» milestones are
  // tasks of 0 days, so a manual relation to one still counts.
  const off = new Set((data.festivos || []).map((f) => f.fecha));
  const hitoDate = new Map((data.hitos || []).map((h) => [h.id, h.date]));
  const base = [...hitoDate.values()].sort()[0] || data.start;
  const cal = calendar(base, off);
  const scheduleTasks = [
    ...(data.hitos || []).map((h) => ({ id: h.id, earliest: cal.index(h.date), duration: 0 })),
    ...tasks.map((t) => ({ id: t.id, earliest: cal.index(hitoDate.get(t.obraId) || base), duration: t.duration })),
  ];
  const names = new Map(tasks.map((t) => [t.id, `${t.code || ''} ${t.name}`.trim()]));
  const accepted = tasks.map((t) => t.predecessors.filter((p) => !p.porDefecto).map((p) => ({ partida_id: t.id, predecessor_id: p.id, type: p.type, lag_days: p.lag }))).flat();
  const warnings = [];
  const byTask = new Map();
  const countByTask = new Map();
  let considered = 0;

  for (const raw of proposed.slice(0, 200)) {
    considered++;
    const task = byIndex.get(Number(raw?.tarea)), pred = byIndex.get(Number(raw?.predecesora));
    const label = (n) => (byIndex.get(Number(n)) ? names.get(byIndex.get(Number(n)).id) : `#${n}`);
    if (!task || !pred) { warnings.push(`Se ha descartado una relación con un número de tarea que no existe (${raw?.tarea} → ${raw?.predecesora}).`); continue; }
    if (task.id === pred.id) { warnings.push(`Se ha descartado que «${label(raw.tarea)}» sea su propia predecesora.`); continue; }
    if (planned(task)) continue; // only propose for tasks that had none — never override a manual choice
    if ((countByTask.get(task.id) || 0) >= MAX_PREDS_PER_TASK) { warnings.push(`«${names.get(task.id)}»: se ha ignorado una predecesora de más (máximo ${MAX_PREDS_PER_TASK}).`); continue; }
    const type = DEP_TYPES.includes(String(raw.tipo).toUpperCase()) ? String(raw.tipo).toUpperCase() : 'FS';
    const lag = Number.isInteger(Number(raw.desfaseDias)) ? Math.max(-365, Math.min(365, Number(raw.desfaseDias))) : 0;
    if ((accepted).some((d) => d.partida_id === task.id && d.predecessor_id === pred.id)) continue; // duplicate
    const candidate = { partida_id: task.id, predecessor_id: pred.id, type, lag_days: lag };
    try { schedule(scheduleTasks, [...accepted, candidate], names); }
    catch { warnings.push(`Se ha descartado que «${label(raw.tarea)}» espere a «${label(raw.predecesora)}»: formaría un ciclo con otra relación ya aceptada.`); continue; }
    accepted.push(candidate);
    countByTask.set(task.id, (countByTask.get(task.id) || 0) + 1);
    if (!byTask.has(task.id)) byTask.set(task.id, []);
    byTask.get(task.id).push({ id: pred.id, type, lag, motivo: String(raw.motivo || '').slice(0, 300) || null });
  }

  // Nivelación por cuadrillas (deterministic, never the model): while an obra
  // still has more tasks at once than cuadrillas, the pending task that starts
  // latest among those overlapping waits (FS 0) for the one that ends first —
  // so the plan offered can be saved (ganttLimitaciones.js). Only tasks that
  // had no predecessor get these relations; a conflict among planned tasks
  // alone is left as it is, with a warning. Every relation only pushes a task
  // later and is never repeated, so this ends.
  const pendingIds = new Set(pending.map((t) => t.id));
  const stuck = new Set();
  let nivelacion = 0;
  for (let guard = 0; ; guard++) {
    if (guard > 500) { warnings.push('La nivelación por cuadrillas se ha detenido sin terminar: revisa las limitaciones en el Gantt.'); break; }
    const pos = schedule(scheduleTasks, accepted, names);
    const conflict = firstOverlap(tasks, pos, crews, stuck);
    if (!conflict) break;
    const { obraId, active } = conflict;
    const start = (id) => pos.get(id).start, end = (id) => pos.get(id).end;
    const waiting = active.filter((id) => pendingIds.has(id)).sort((a, b) => start(b) - start(a) || index.get(b) - index.get(a));
    let added = null;
    for (const b of waiting) {
      const firsts = active.filter((id) => id !== b).sort((x, y) => end(x) - end(y) || start(x) - start(y) || index.get(x) - index.get(y));
      for (const a of firsts) {
        if (accepted.some((d) => d.partida_id === b && d.predecessor_id === a)) continue;
        const candidate = { partida_id: b, predecessor_id: a, type: 'FS', lag_days: 0 };
        try { schedule(scheduleTasks, [...accepted, candidate], names); } catch { continue; }
        added = candidate; break;
      }
      if (added) break;
    }
    if (!added) {
      stuck.add(obraId);
      warnings.push(`${refOf.get(obraId) || 'La obra'}: quedan más tareas a la vez que cuadrillas entre tareas que ya tenían predecesora; no se han tocado. Encadénalas a mano o añade cuadrillas.`);
      continue;
    }
    accepted.push(added);
    nivelacion++;
    const n = crews.get(obraId);
    if (!byTask.has(added.partida_id)) byTask.set(added.partida_id, []);
    byTask.get(added.partida_id).push({ id: added.predecessor_id, type: 'FS', lag: 0, recurso: true,
      motivo: `Sin cuadrilla libre (${n === 1 ? '1 cuadrilla' : `${n} cuadrillas`}): empieza cuando termina «${names.get(added.predecessor_id)}».` });
  }

  if (!byTask.size) warnings.push('El agente no ha propuesto ninguna relación aprovechable.');
  return {
    tasks: [...byTask.entries()].map(([id, predecessors]) => ({ id, predecessors })),
    considered, accepted: [...byTask.values()].reduce((a, p) => a + p.length, 0), nivelacion, warnings,
  };
}

const tenths = (v) => Math.round(Number(v) * 10);

// The first moment, in an obra not in `skip`, where more tasks run at once
// than it has cuadrillas: { obraId, active: [ids] }, or null. Same sweep as
// sobreasignaciones() in ganttLimitaciones.js (0-day tasks never count;
// touching ends/starts are not an overlap).
export function firstOverlap(tasks, pos, crews, skip = new Set()) {
  let best = null;
  for (const [obraId, n] of crews) {
    if (skip.has(obraId)) continue;
    const ts = tasks.filter((t) => t.obraId === obraId && tenths(pos.get(t.id).end) > tenths(pos.get(t.id).start));
    if (ts.length <= n) continue;
    const ev = ts.flatMap((t) => [{ at: tenths(pos.get(t.id).start), d: 1, id: t.id }, { at: tenths(pos.get(t.id).end), d: -1, id: t.id }])
      .sort((a, b) => a.at - b.at || a.d - b.d);
    const active = new Set();
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].d > 0) active.add(ev[i].id); else active.delete(ev[i].id);
      if (ev[i + 1] && ev[i + 1].at === ev[i].at) continue;
      if (active.size > n) {
        if (!best || ev[i].at < best.at) best = { at: ev[i].at, obraId, active: [...active] };
        break;
      }
    }
  }
  return best && { obraId: best.obraId, active: best.active };
}
