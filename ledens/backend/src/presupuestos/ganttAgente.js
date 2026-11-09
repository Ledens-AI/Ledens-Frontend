import { PresupuestoError } from './service.js';
import { GanttService, DEP_TYPES, schedule } from './gantt.js';

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
  // A valid (acyclic) graph always has at least one task with no predecessor
  // — schedule()'s own topological pass depends on that — so `pending` is
  // never empty here; nothing special to guard against.
  const pending = tasks.filter((t) => !t.predecessors.length);

  const index = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const byIndex = new Map(tasks.map((t, i) => [i + 1, t]));
  const lines = tasks.map((t, i) => `${i + 1}. [${t.chapter || 'Sin capítulo'}] ${t.code ? `${t.code} ` : ''}${t.name} — ${t.quantity} ${t.unit}, ${t.duration} día(s)${t.predecessors.length ? ' (ya tiene predecesora, no la toques)' : ''}`).join('\n');
  const prompt = `Tareas del proyecto «${data.project.name}» (numeradas en el orden del Gantt):\n${lines}\n\nPropón predecesoras solo para las tareas sin ninguna todavía: ${pending.map((t) => index.get(t.id)).join(', ')}.`;

  const proposed = await askAgent(anthropic, prompt);

  // Cycle check reuses schedule()'s own topological pass — earliest doesn't
  // matter for that (a cycle is independent of start dates), so 0 for all.
  const scheduleTasks = tasks.map((t) => ({ id: t.id, earliest: 0, duration: t.duration }));
  const names = new Map(tasks.map((t) => [t.id, `${t.code || ''} ${t.name}`.trim()]));
  const accepted = tasks.map((t) => t.predecessors.map((p) => ({ partida_id: t.id, predecessor_id: p.id, type: p.type, lag_days: p.lag }))).flat();
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
    if (task.predecessors.length) continue; // only propose for tasks that had none — never override a manual choice
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

  if (!byTask.size) warnings.push('El agente no ha propuesto ninguna relación aprovechable.');
  return {
    tasks: [...byTask.entries()].map(([id, predecessors]) => ({ id, predecessors })),
    considered, accepted: [...byTask.values()].reduce((a, p) => a + p.length, 0), warnings,
  };
}
