import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, closePool } from '../db/pool.js';
import { agenteDraft, agenteFromEnv } from '../presupuestos/agente.js';
import { translatorFromEnv } from '../presupuestos/translate.js';

// Validation tool, not part of the product: feeds a real visit folder
// (notes, transcribed voice notes, photos, plans — whatever is already in
// the folder, read recursively) through the same agenteDraft() the web app
// uses, and writes the resulting draft so it can be compared by hand against
// the presupuesto that was actually sent for that obra. Needs DATABASE_URL
// (the real base de partidas) and ANTHROPIC_API_KEY. Run it locally, never
// against a folder with client data checked into the repo:
//   DATABASE_URL=... ANTHROPIC_API_KEY=... npm run validar-agente -- "C:\ruta\a\la\visita" borrador.json
const USAGE = 'Uso: npm run validar-agente -- <carpeta-de-la-visita> [fichero-salida.json]';

const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic', '.webp': 'image/webp' };
const SKIP = new Set(['.ds_store', 'thumbs.db']);

async function readFolder(dir) {
  const files = [];
  async function walk(d) {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      if (SKIP.has(entry.name.toLowerCase())) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk(dir);
  return Promise.all(files.map(async (p) => ({ name: path.relative(dir, p), mime: MIME[path.extname(p).toLowerCase()] || 'text/plain', dataBase64: (await fs.readFile(p)).toString('base64') })));
}

try {
  const [dir, out = 'borrador.json'] = process.argv.slice(2);
  if (!dir) throw new Error(USAGE);
  const anthropic = agenteFromEnv();
  if (!anthropic) throw new Error('Falta ANTHROPIC_API_KEY.');
  const files = await readFolder(dir);
  if (!files.length) throw new Error(`No hay archivos en ${dir}`);
  console.log(`Leyendo ${files.length} archivo(s) de ${dir}…`);
  const draft = await agenteDraft({ role: 'admin' }, { files }, { db: getPool(), translator: translatorFromEnv(), anthropic });
  await fs.writeFile(out, JSON.stringify(draft, null, 2), 'utf8');
  const items = draft.chapters.flatMap((c) => c.items);
  console.log(`\nCapítulos: ${draft.chapters.length} · Partidas: ${items.length} (${items.filter((i) => i.check).length} pendientes de revisión, ${items.filter((i) => i.proposal).length} propuestas de partida nueva)`);
  console.log(`Total (confirmado, sin pendientes): ${draft.totalDocument} €`);
  if (draft.warnings.length) { console.log(`\nA revisar (${draft.warnings.length}):`); draft.warnings.forEach((w) => console.log(`- ${w}`)); }
  console.log(`\nBorrador completo escrito en ${out}. Compáralo a mano con el presupuesto que de verdad se envió para esa obra.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
