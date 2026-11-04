import Anthropic from '@anthropic-ai/sdk';
import { PresupuestoError } from './service.js';
import { loadCatalog, matchLines, unitLabel } from './catalog.js';

// Turns the loose documentation of a client visit (notes typed by the jefe,
// transcribed voice notes, photos, plans, provider quotes...) into a budget
// draft, the same shape pdfDraft() returns, so it goes through the same
// editor and the same save/send flow. Nothing here invents a measurement,
// a price or a decision: what the model cannot support from the files
// becomes a warning the jefe must resolve before sending, exactly like a
// line whose figures do not add up already does in the PDF-import flow.
// Matching a partida, pricing it and proposing a new one when nothing fits
// is never the model's job — that is matchLines() (catalog.js), deterministic
// and already used by the PDF import. The model only has to understand the
// visit.
const fail = (status, message) => { throw new PresupuestoError(status, message); };

export function agenteFromEnv() {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new Anthropic({ apiKey: key }) : null;
}

const MODEL = process.env.AGENTE_PRESUPUESTOS_MODEL || 'claude-sonnet-5-5';
const MAX_FILES = 40;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const SYSTEM = `Eres el asistente de un jefe de obra de Ledens, una empresa de reformas en Málaga. Te da la documentación de la visita a un posible cliente (notas, notas de voz ya transcritas a texto, fotos, planos, presupuestos de proveedores) y debes extraer, con disciplina, qué reforma se ha pedido.

No puedes inventar: mediciones, cantidades, precios, materiales, modelos de producto, soluciones constructivas, recorridos de instalaciones, condiciones del inmueble, decisiones del cliente, alcances no mencionados, permisos, ni quién suministra un producto. Cualquier dato que no puedas demostrar con los archivos queda pendiente, nunca adivinado.
No calculas ni asignas precios: eso lo hace otro sistema a partir de la base de partidas de Ledens. Nunca pongas un precio.
Distingue alcance confirmado de lo meramente comentado: expresiones como "podríamos", "habría que ver", "quizás", "se puede valorar" son propuestas pendientes o actuaciones condicionadas, nunca alcance firme.
Una medida solo es válida si puedes decir qué elemento mide, desde dónde hasta dónde, en qué unidad y si es del estado actual o del reformado. Si falta alguna de esas cuatro cosas, la cantidad queda sin rellenar (null) y explicas en "motivoPendiente" qué medición exacta falta (no una pregunta genérica).
No deduzcas medidas usando como escala azulejos, muebles, puertas u otros objetos de tamaño no confirmado. No interpretes fotografías en perspectiva para calcular dimensiones.
Cada partida que identifiques debe llevar su estado: "confirmada" (alcance y cantidad respaldados), "pendiente_medicion" (trabajo confirmado, falta medir), "pendiente_decision" (depende de una elección del cliente todavía no hecha), "condicionada" (depende de una cata, demolición previa, inspección, permiso o hallazgo), "opcional" (mejora o alternativa comentada, no parte del alcance principal), "no_incluida" (se menciona pero queda fuera).
Registra en "contradicciones" cualquier dato que se contradiga entre archivos distintos, citando los archivos. Registra en "archivosNoLegibles" cualquier archivo que no hayas podido interpretar. Registra en "pendientes" cada pregunta concreta que haya que resolver antes de poder cerrar el presupuesto (evita preguntas genéricas: cita la estancia y el elemento exacto). Registra en "referencias" cualquier producto, marca, modelo o precio visto por el cliente o en un presupuesto de un proveedor — son referencias, nunca el precio de venta de Ledens.
Agrupa las partidas en los capítulos habituales de una reforma (trabajos previos, demoliciones, albañilería, fontanería, electricidad, climatización, pladur, revestimientos y pavimentos, pintura, carpintería, mobiliario, sanitarios, gestión de residuos, limpieza, partidas condicionadas, opciones y mejoras) cuando corresponda; no incluyas capítulos sin partidas.
Devuelve siempre tu respuesta llamando a la herramienta "registrar_borrador", sin texto adicional.`;

const DRAFT_TOOL = {
  name: 'registrar_borrador',
  description: 'Registra el borrador del presupuesto extraído de la documentación de la visita.',
  input_schema: {
    type: 'object',
    required: ['resumen', 'capitulos'],
    properties: {
      titulo: { type: ['string', 'null'], description: 'Nombre del proyecto o del cliente, si se identifica.' },
      direccion: { type: ['string', 'null'] },
      resumen: { type: 'string', description: 'Descripción general de la reforma: objetivo, estancias afectadas, alcance confirmado.' },
      capitulos: {
        type: 'array',
        items: {
          type: 'object',
          required: ['nombre', 'partidas'],
          properties: {
            nombre: { type: 'string' },
            partidas: {
              type: 'array',
              items: {
                type: 'object',
                required: ['nombre', 'descripcion', 'unidad', 'estado'],
                properties: {
                  nombre: { type: 'string' },
                  descripcion: { type: 'string' },
                  unidad: { type: 'string', description: 'ud, m2, ml, m3, kg, h, dia...' },
                  cantidad: { type: ['number', 'null'] },
                  estado: { type: 'string', enum: ['confirmada', 'pendiente_medicion', 'pendiente_decision', 'condicionada', 'opcional', 'no_incluida'] },
                  motivoPendiente: { type: ['string', 'null'] },
                  suministra: { type: ['string', 'null'], enum: ['ledens', 'cliente', 'proveedor_externo', 'pendiente_de_confirmar', null] },
                  archivoProcedencia: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
      mediciones: { type: 'array', items: { type: 'string' }, description: 'Una línea por medida calculada: elemento, fórmula, dimensiones y archivo de origen.' },
      pendientes: { type: 'array', items: { type: 'string' }, description: 'Preguntas concretas que hay que resolver antes de cerrar el presupuesto.' },
      referencias: { type: 'array', items: { type: 'string' }, description: 'Productos, marcas o precios vistos por el cliente; nunca precio de venta de Ledens.' },
      contradicciones: { type: 'array', items: { type: 'string' } },
      archivosNoLegibles: { type: 'array', items: { type: 'string' } },
    },
  },
};

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function contentBlocks({ notes, files = [] } = {}) {
  const blocks = [];
  if (notes && notes.trim()) blocks.push({ type: 'text', text: `Notas del jefe de obra:\n${notes.trim()}` });
  for (const f of files) {
    if (IMAGE_MIME.has(f.mime)) blocks.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.dataBase64 } });
    else if (f.mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: f.mime, data: f.dataBase64 } });
    else blocks.push({ type: 'text', text: `--- ${f.name} ---\n${Buffer.from(f.dataBase64, 'base64').toString('utf8')}` });
    blocks.push({ type: 'text', text: `(archivo: ${f.name})` });
  }
  if (!blocks.length) fail(400, 'No hay notas ni archivos que leer.');
  return blocks;
}

function validateInput({ notes, files = [] } = {}) {
  if ((!notes || !notes.trim()) && !files.length) fail(400, 'Escribe algo o adjunta al menos un archivo de la visita.');
  if (files.length > MAX_FILES) fail(400, `Demasiados archivos (máximo ${MAX_FILES}).`);
  let total = 0;
  for (const f of files) {
    if (!f?.name || !f?.mime || !f?.dataBase64) fail(400, 'Archivo incompleto (falta nombre, tipo o contenido).');
    const bytes = Buffer.byteLength(f.dataBase64, 'base64');
    if (bytes > MAX_FILE_BYTES) fail(400, `«${f.name}» supera el máximo por archivo (8 MB).`);
    total += bytes;
  }
  if (total > MAX_TOTAL_BYTES) fail(400, 'El conjunto de archivos supera el máximo (20 MB).');
}

async function askAgent(anthropic, input) {
  const r = await anthropic.messages.create({
    model: MODEL, max_tokens: 8000, system: SYSTEM,
    tools: [DRAFT_TOOL], tool_choice: { type: 'tool', name: 'registrar_borrador' },
    messages: [{ role: 'user', content: contentBlocks(input) }],
  });
  const use = r.content.find((b) => b.type === 'tool_use');
  if (!use) fail(502, 'El agente no ha devuelto un borrador.');
  return use.input;
}

const KIND = { confirmada: 'confirmada', condicionada: 'condicionada', opcional: 'opcion', pendiente_decision: 'decision' };
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const net = (priceIncl, vat) => (priceIncl == null ? null : String(round(priceIncl / (1 + vat / 100), 6)));

// lines: flattened partidas, in the order they will be matched (matchLines
// returns one result per line, same order).
function buildItems(capitulos, matches, catalog, vat) {
  let n = 0;
  const warnings = [];
  const chapters = [];
  for (const cap of capitulos) {
    const items = [];
    for (const p of cap.partidas || []) {
      const m = matches[n++];
      if (p.estado === 'no_incluida') {
        warnings.push(`Fuera de alcance: «${p.nombre}»${p.archivoProcedencia ? ` (${p.archivoProcedencia})` : ''} — mencionado pero no forma parte del presupuesto.`);
        continue;
      }
      const pending = p.cantidad == null || p.estado === 'pendiente_medicion';
      if (pending) warnings.push(`Falta medición para «${p.nombre}» (capítulo ${cap.nombre}): ${p.motivoPendiente || 'no se ha podido determinar la cantidad con la documentación disponible.'}`);
      const base = m?.baseCode ? catalog.byCode.get(m.baseCode.toUpperCase()) : null;
      const unit = base ? unitLabel(base.unit) : p.unidad;
      items.push({
        code: '', name: p.nombre.slice(0, 300), description: (p.descripcion || '').slice(0, 4000), unit,
        quantity: pending ? '0' : String(round(Number(p.cantidad), 3)),
        unitPrice: net(base?.priceIncl, vat) ?? '0',
        kind: KIND[p.estado] || 'confirmada', check: pending,
        suppliedBy: p.suministra || null, sourceFile: p.archivoProcedencia || null,
        ...(m ? { baseCode: m.baseCode, baseName: m.baseName, annotations: m.annotations, translation: m.translation, proposal: m.proposal } : {}),
      });
      if (!base && !m?.proposal) warnings.push(`«${p.nombre}»: no se ha podido comparar con la base de partidas.`);
    }
    if (items.length) chapters.push({ name: cap.nombre.slice(0, 200), items });
  }
  return { chapters, warnings };
}

// user: who uploads (admin/jefe only, like pdfDraft). input: { notes, files:
// [{ name, mime, dataBase64 }] }. db: required to match against the base de
// partidas — without it every line would become a proposal, so it fails loud
// instead. anthropic: injectable for tests.
export async function agenteDraft(user, input, { db, translator, anthropic } = {}) {
  if (!['admin', 'jefe'].includes(user?.role)) fail(403, 'Solo el equipo puede generar presupuestos con el agente');
  if (!anthropic) fail(503, 'El agente de presupuestos no está configurado');
  if (!db) fail(503, 'No se ha podido consultar la base de partidas');
  validateInput(input);

  const draft = await askAgent(anthropic, input);
  if (!Array.isArray(draft.capitulos)) fail(502, 'El agente no ha devuelto capítulos.');

  const catalog = await loadCatalog(db);
  const lines = draft.capitulos.flatMap((c) => (c.partidas || []).filter((p) => p.estado !== 'no_incluida')
    .map((p) => ({ code: null, name: p.nombre, description: p.descripcion, unit: p.unidad, unitPrice: null })));
  const vat = 21;
  const matches = lines.length ? await matchLines(lines, catalog, { translator, pricesIncludeVat: true, vatRate: vat }) : [];
  const { chapters, warnings } = buildItems(draft.capitulos, matches, catalog, vat);

  const notes = [draft.resumen, ...(draft.pendientes || []).map((p) => `Pendiente: ${p}`), ...(draft.mediciones || []).map((m) => `Medición: ${m}`),
    ...(draft.referencias || []).map((r) => `Referencia del cliente: ${r}`), ...(draft.contradicciones || []).map((c) => `Contradicción: ${c}`),
    ...(draft.archivosNoLegibles || []).map((a) => `Archivo no legible: ${a}`)].filter(Boolean).join('\n');

  const totalDocument = chapters.flatMap((c) => c.items).reduce((a, i) => a + Number(i.quantity) * Number(i.unitPrice), 0);
  return {
    source: 'agente', title: draft.titulo || null, address: draft.direccion || null, vatRate: String(vat), pricesIncludeVat: true,
    notes: notes.slice(0, 5000) || null, totalDocument: round(totalDocument, 2).toFixed(2), warnings, chapters,
  };
}
