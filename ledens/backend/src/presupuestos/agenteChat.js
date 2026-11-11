import { PresupuestosService, PresupuestoError } from './service.js';
import { ObraArchivosService } from '../obras/archivos.js';
import { SYSTEM, DRAFT_TOOL, MODEL, MAX_FILE_BYTES, fileBlocks, finalizeDraft } from './agente.js';

// Admin-only, on-demand chat: never runs by itself (no cron, no folder
// watcher), only when an admin opens it and writes. It never reads an
// external folder either — "la documentación de la visita" is whatever has
// already been uploaded to a proyecto/obra through the existing fotos y
// documentos de obra (the same Blob storage /api/obras/:id/archivos uses).
// It can look that up and read it itself instead of the admin re-uploading
// everything by hand, but it still only runs when someone is talking to it.
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CHAT_SYSTEM = `${SYSTEM}

Esta conversación es con un administrador de Ledens, no un formulario de un solo paso. Tienes herramientas para encontrar el proyecto correcto y leer su documentación de visita ya subida, antes de generar nada:
- buscar_proyectos: busca entre los proyectos ya existentes por nombre, cliente, dirección o código.
- listar_archivos_obra: lista las fotos y documentos ya subidos a una obra de ese proyecto.
- leer_archivo_obra: lee el contenido de uno de esos archivos.
Si hay ambigüedad sobre a qué proyecto se refiere, o no encuentras documentación suficiente, pregúntalo en texto normal en vez de adivinar — el administrador puede pegarte más notas o indicarte otro archivo en su siguiente mensaje. Llama a registrar_borrador solo cuando ya tengas lo que necesitas para proponer el presupuesto.`;

const BUSCAR_PROYECTOS_TOOL = {
  name: 'buscar_proyectos',
  description: 'Busca entre los proyectos ya existentes en Ledens por nombre, cliente, dirección o código, y devuelve los presupuestos raíz de cada uno (aprobados o todavía en borrador) — cualquiera puede ya tener archivos de la visita subidos.',
  input_schema: { type: 'object', required: ['texto'], properties: { texto: { type: 'string' } } },
};
const LISTAR_ARCHIVOS_TOOL = {
  name: 'listar_archivos_obra',
  description: 'Lista las fotos y documentos ya subidos a un presupuesto raíz (identificado por su id, de buscar_proyectos — no el id del proyecto).',
  input_schema: { type: 'object', required: ['obraId'], properties: { obraId: { type: 'string' } } },
};
const LEER_ARCHIVO_TOOL = {
  name: 'leer_archivo_obra',
  description: 'Lee el contenido de un archivo ya listado con listar_archivos_obra, para usarlo como documentación de la visita.',
  input_schema: { type: 'object', required: ['obraId', 'fileId'], properties: { obraId: { type: 'string' }, fileId: { type: 'string' } } },
};
const CHAT_TOOLS = [BUSCAR_PROYECTOS_TOOL, LISTAR_ARCHIVOS_TOOL, LEER_ARCHIVO_TOOL, DRAFT_TOOL];
const MAX_TURNS = 8;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function runTool(name, input, { db, user, storage }) {
  if (name === 'buscar_proyectos') {
    const svc = new PresupuestosService(db, user);
    const texto = norm(input?.texto);
    const [projects, rows] = await Promise.all([svc.projectsList(), svc.list()]);
    // Any root presupuesto of the project (draft included) may already have
    // files attached — /api/obras/:id/archivos only ever rules out an
    // ampliación (r.parent), never a draft.
    const matches = projects.filter((p) => [p.code, p.name, p.cliente, p.address].some((v) => v && norm(v).includes(texto))).slice(0, 10)
      .map((p) => ({ ...p, obras: rows.filter((r) => r.project?.id === p.id && !r.parent).map((r) => ({ id: r.id, ref: r.ref, title: r.title, phase: r.phase })) }));
    return [{ type: 'text', text: matches.length ? JSON.stringify(matches) : 'Ningún proyecto coincide con esa búsqueda.' }];
  }
  if (name === 'listar_archivos_obra') {
    const svc = new ObraArchivosService(db, user, storage);
    const { fotos, documentos } = await svc.list(input?.obraId);
    const all = [...fotos, ...documentos].map((f) => ({ id: f.id, name: f.name, mime: f.mime, kind: f.kind, title: f.title }));
    return [{ type: 'text', text: all.length ? JSON.stringify(all) : 'Esa obra no tiene fotos ni documentos subidos todavía.' }];
  }
  if (name === 'leer_archivo_obra') {
    const svc = new ObraArchivosService(db, user, storage);
    const { stream, size, mime, name: fileName } = await svc.open(input?.obraId, input?.fileId);
    if (size > MAX_FILE_BYTES) return [{ type: 'text', text: `«${fileName}» supera el máximo legible (8 MB): no se puede leer directamente.` }];
    const dataBase64 = (await streamToBuffer(stream)).toString('base64');
    return fileBlocks({ name: fileName, mime, dataBase64 });
  }
  return [{ type: 'text', text: 'Herramienta no reconocida.' }];
}

// user: admin only. messages: full Anthropic-format history so far (the
// frontend keeps it and sends it back each turn — no server-side session).
// Returns either { done: false, reply, messages } (plain text, waiting on the
// admin) or { done: true, draft, messages } (registrar_borrador was called).
export async function agenteChat(user, { messages } = {}, { db, translator, anthropic, storage } = {}) {
  if (user?.role !== 'admin') fail(403, 'Solo un administrador puede usar el chat del agente');
  if (!anthropic) fail(503, 'El agente de presupuestos no está configurado');
  if (!db) fail(503, 'No se ha podido consultar la base de partidas');
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) fail(400, 'Conversación no válida');

  let history = messages;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await anthropic.messages.create({ model: MODEL, max_tokens: 8000, system: CHAT_SYSTEM, tools: CHAT_TOOLS, tool_choice: { type: 'auto' }, messages: history });
    history = [...history, { role: 'assistant', content: r.content }];
    const uses = r.content.filter((b) => b.type === 'tool_use');
    const draftUse = uses.find((u) => u.name === 'registrar_borrador');
    if (draftUse) return { done: true, draft: await finalizeDraft(draftUse.input, { db, translator }), messages: history };
    if (!uses.length) return { done: false, reply: r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), messages: history };
    const results = [];
    for (const u of uses) {
      let content;
      try { content = await runTool(u.name, u.input, { db, user, storage }); }
      catch (e) { content = [{ type: 'text', text: `Error: ${e.message}` }]; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content });
    }
    history = [...history, { role: 'user', content: results }];
  }
  fail(502, 'El agente no ha terminado tras varios pasos; reformula la petición o sé más concreto.');
}
