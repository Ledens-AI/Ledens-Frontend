import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { agenteChat } from '../src/presupuestos/agenteChat.js';
import { PresupuestosService } from '../src/presupuestos/service.js';
import { ObraArchivosService } from '../src/obras/archivos.js';
import { folderStorage } from '../src/obras/storage.js';
// The admin chat: it only ever runs on an explicit message, finds the right
// project itself, and reads files already uploaded to its obra (same Blob
// storage /api/obras uses — here a temp folder) before proposing a draft.

function scriptedAnthropic(turns) {
  let i = 0;
  return { messages: { create: async () => turns[Math.min(i++, turns.length - 1)] } };
}
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }] });
const textReply = (text) => ({ content: [{ type: 'text', text }] });
const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] });

let db, pool, dir, storage, admin, jefe, cliente, marbellaId, obraId, fileId;
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
  await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, name text, role text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false, access_held boolean NOT NULL DEFAULT false, registered_at timestamptz);
    CREATE TABLE audit_log(id bigint GENERATED ALWAYS AS IDENTITY, at timestamptz NOT NULL DEFAULT now(), actor_id uuid REFERENCES users(id), actor_label text NOT NULL, action text NOT NULL,
      target_id uuid REFERENCES users(id), target_label text, detail text);
    CREATE SCHEMA ledens;
    CREATE TABLE ledens.project_statuses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
    CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
      project_id text, name text, customer_name_source text, salesman text, address text, start_date date, municipio text,
      provincia text, customer_id uuid, status_id uuid REFERENCES ledens.project_statuses (id), end_date date);
    CREATE TABLE ledens.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL);
    CREATE TABLE ledens.finance_project_permissions (user_id uuid NOT NULL, project_id uuid NOT NULL, PRIMARY KEY (user_id, project_id));
    CREATE TABLE ledens.work_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text, raw_id uuid, id_categoria text, name text);
    CREATE TABLE ledens.work_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text, raw_id uuid, id_partida text, category_id uuid REFERENCES ledens.work_categories(id), categoria text, name text,
      definicion_partida text, unit_source text, sale_price_including_vat numeric, sale_price_excluding_vat numeric, incluye_materiales text, activa text, subcategoria text, palabrasclave text,
      observacionesagente text, rendimientovalidado text, observacionesplanificacion text, unit_id uuid);`);
  for (const m of ['020_presupuestos_cliente.sql', '021_presupuestos_precision.sql', '022_obra_archivos.sql', '023_invitaciones_cliente.sql', '025_presupuestos_dimpartida.sql', '033_presupuestos_proyecto.sql', '037_estado_proyecto.sql']) {
    await db.exec(await fs.readFile(new URL('../src/db/migrations/' + m, import.meta.url), 'utf8'));
  }
  [admin, jefe, cliente] = (await db.query(`INSERT INTO users(email,name,role) VALUES
    ('admin@chat.test','Admin','admin'),('jefe@chat.test','Jefe','jefe'),('cliente@chat.test','Cliente Ruiz','client') RETURNING id,email,name,role`)).rows;
  [{ id: marbellaId }] = (await db.query(`INSERT INTO ledens.projects(project_id,name,municipio,customer_name_source) VALUES
    ('P2026-050','Cocina Familia Ruiz','Málaga','Familia Ruiz') RETURNING id`)).rows;
  await db.query('INSERT INTO ledens.work_items(id_partida,categoria,name,definicion_partida,unit_source,sale_price_including_vat,activa) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['PA-090', 'Pintura', 'Pintura plástica lisa en paredes y techo', 'Dos manos de pintura plástica.', 'm2', 9, 'SI']);

  const as = (u) => new PresupuestosService(pool, u);
  let d = await as(admin).create({ title: 'Cocina Familia Ruiz', clientId: cliente.id, jefeId: jefe.id, projectId: marbellaId, chapters: [{ name: 'C', items: [{ name: 'P', unit: 'ud', quantity: '1', unitPrice: '1' }] }] });
  obraId = d.id;
  d = await as(admin).send(obraId);
  await as(cliente).approve(obraId, { versionId: d.version.id });
  await as(jefe).schedule(obraId, { startDate: '2026-11-04' });

  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agente-chat-'));
  storage = folderStorage(dir);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('El cliente quiere pintar toda la cocina, 10 m2.', { x: 40, y: 500, size: 12, font });
  const f = await new ObraArchivosService(pool, jefe, storage).upload(obraId, { content: Buffer.from(await doc.save()), name: 'notas.pdf', title: 'Notas de la visita' });
  fileId = f.id;
});
after(async () => { await db?.close(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

test('only an admin may use the chat', async () => {
  await assert.rejects(agenteChat({ role: 'jefe' }, { messages: [userMsg('x')] }, { db: pool, anthropic: scriptedAnthropic([textReply('x')]) }), { status: 403 });
  await assert.rejects(agenteChat({ role: 'client' }, { messages: [userMsg('x')] }, { db: pool, anthropic: scriptedAnthropic([textReply('x')]) }), { status: 403 });
});

test('a plain question mid-conversation comes back as a reply, not a draft', async () => {
  const anthropic = scriptedAnthropic([textReply('¿De qué proyecto se trata?')]);
  const r = await agenteChat(admin, { messages: [userMsg('Genera un presupuesto')] }, { db: pool, anthropic });
  assert.equal(r.done, false);
  assert.equal(r.reply, '¿De qué proyecto se trata?');
  assert.equal(r.messages.length, 2, 'the user message plus the assistant reply');
});

test('end to end: search the project, read its uploaded notes, propose a draft — never on its own, only on this call', async () => {
  const draftInput = { resumen: 'Pintura de cocina.', capitulos: [{ nombre: 'Pintura', partidas: [{ nombre: 'Pintura de paredes y techo', descripcion: 'x', unidad: 'm2', cantidad: 10, estado: 'confirmada' }] }] };
  const anthropic = scriptedAnthropic([
    toolUse('t1', 'buscar_proyectos', { texto: 'Ruiz' }),
    toolUse('t2', 'listar_archivos_obra', { obraId }),
    toolUse('t3', 'leer_archivo_obra', { obraId, fileId }),
    toolUse('t4', 'registrar_borrador', draftInput),
  ]);
  const r = await agenteChat(admin, { messages: [userMsg('Genera el presupuesto de la obra de los Ruiz')] }, { db: pool, anthropic, storage });
  assert.equal(r.done, true);
  assert.equal(r.draft.chapters[0].items[0].baseCode, 'PA-090', 'matched the real base de partidas, not invented by the chat');
  // The conversation kept every tool call and its result, in order.
  const kinds = r.messages.map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.type).join(',') : 'text'));
  assert.deepEqual(kinds, ['text', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use']);
});

test('a presupuesto still in draft (never sent/approved) shows up too — archivos.js never requires approval, only rules out an ampliación', async () => {
  const [{ id: velezId }] = (await db.query(`INSERT INTO ledens.projects(project_id,name,municipio) VALUES ('P2026-051','Baño Vélez','Vélez-Málaga') RETURNING id`)).rows;
  const borrador = await new PresupuestosService(pool, admin).create({ title: 'Baño Vélez', clientId: cliente.id, jefeId: jefe.id, projectId: velezId, chapters: [{ name: 'C', items: [{ name: 'P', unit: 'ud', quantity: '1', unitPrice: '1' }] }] });
  const anthropic = scriptedAnthropic([toolUse('t1', 'buscar_proyectos', { texto: 'Vélez' }), textReply('Visto.')]);
  const r = await agenteChat(admin, { messages: [userMsg('Busca el proyecto de Vélez')] }, { db: pool, anthropic, storage });
  const toolResultText = r.messages.find((m) => m.content?.[0]?.type === 'tool_result')?.content[0].content[0].text;
  assert.match(toolResultText, new RegExp(borrador.id), 'a never-sent draft is still a valid target for leer/listar_archivos_obra');
});

test('a tool_use the model invents, or a bad project search, never throws the whole conversation away', async () => {
  const anthropic = scriptedAnthropic([toolUse('t1', 'buscar_proyectos', { texto: 'nada-que-coincida-xyz' }), textReply('No he encontrado ningún proyecto con ese nombre.')]);
  const r = await agenteChat(admin, { messages: [userMsg('Genera el presupuesto de un proyecto que no existe')] }, { db: pool, anthropic, storage });
  assert.equal(r.done, false);
  assert.match(r.reply, /No he encontrado/);
});
