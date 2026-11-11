import { audit } from '../db/audit.js';
import { getStorage } from '../obras/storage.js';
import { readBudgetPdf } from './pdf.js';

// Restores partida names (and descriptions) that the old PDF reader cut: in a
// table whose chapter column repeats beside each partida («2. Demoliciones y»),
// the first wrapped line of a name was taken for a chapter and dropped, so
// «Retirada de tela existente en techo (aseo pequeño y entrada)» was saved as
// «(aseo pequeño y entrada)». The original PDF is kept as a document of the
// obra; it is read again with today's reader (text layer only, no OCR) and a
// stored line is corrected only when it has the same quantity and its text is
// a strict part of what the PDF says now (its words, in the same order, with
// more around or between them) — nothing else is ever touched. Chapter names
// cut the same way («desmontajes» for «Demoliciones y desmontajes») are
// restored by the same rule. Each
// correction is audited. Runs once at startup (mantenimientos) and from the CLI
// (`npm run presupuestos -- reparar-nombres [--simular]`).
export const JOB = 'nombres-partida-pdf-1';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);
export function restores(stored, read) {
  const o = words(stored), n = words(read);
  if (!o.length || n.length <= o.length) return false;
  let k = 0;
  for (const w of n) if (w === o[k]) k++;
  return k === o.length;
}
// storage.get() answers { size, stream } (folder or Blob).
async function bytes(storage, key) {
  const { stream } = await storage.get(key);
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
const sameQty = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0005;

export async function repararNombresDesdePdf(pool, { storage = getStorage(), simulate = false, log = console.log } = {}) {
  const out = { pdfs: 0, leidos: 0, cambios: [], capitulos: [] };
  if (!storage) { log('[reparar-nombres] sin almacenamiento de archivos de obra: nada que releer'); return out; }
  const files = (await pool.query(`SELECT a.id, a.presupuesto_id obra_id, a.storage_key, a.original_name, p.ref FROM obra_archivos a JOIN presupuestos p ON p.id = a.presupuesto_id
                                   WHERE a.kind = 'documento' AND a.deleted_at IS NULL ORDER BY a.uploaded_at`)).rows;
  for (const f of files) {
    out.pdfs++;
    let items, chapters;
    try {
      const b = await readBudgetPdf(await bytes(storage, f.storage_key));
      chapters = b.chapters.map((c) => c.name);
      items = b.chapters.flatMap((c) => c.items);
      out.leidos++;
    } catch { continue; } // not a budget (plans, permits…) or unreadable: nothing to compare
    const lines = (await pool.query(`SELECT pp.id, pp.name, pp.description, pp.quantity, p.ref FROM presupuesto_partidas pp
                                     JOIN presupuesto_versiones v ON v.id = pp.version_id JOIN presupuestos p ON p.id = v.presupuesto_id
                                     WHERE coalesce(p.parent_id, p.id) = $1`, [f.obra_id])).rows;
    for (const l of lines) {
      const hit = items.find((i) => sameQty(i.quantity, l.quantity) && (restores(l.name, i.name) || norm(l.name) === norm(i.name)));
      if (!hit) continue;
      const name = restores(l.name, hit.name) ? hit.name.slice(0, 300) : null;
      const description = hit.description && restores(l.description, hit.description) ? hit.description.slice(0, 4000) : null;
      if (!name && !description) continue;
      out.cambios.push({ id: l.id, ref: l.ref, from: l.name, to: name || l.name, description: !!description });
      if (simulate) continue;
      await pool.query('UPDATE presupuesto_partidas SET name = coalesce($2, name), description = coalesce($3, description) WHERE id = $1', [l.id, name, description]);
      await audit({ actor: { label: 'Sistema (relectura del PDF)' }, action: 'Partida corregida desde el PDF', target: { label: l.ref },
        detail: `«${l.name}» → «${name || l.name}»${description ? ' (y su descripción)' : ''} · releído de «${f.original_name}»` }, pool);
    }
    const caps = (await pool.query(`SELECT c.id, c.name, p.ref FROM presupuesto_capitulos c JOIN presupuesto_versiones v ON v.id = c.version_id
                                    JOIN presupuestos p ON p.id = v.presupuesto_id WHERE coalesce(p.parent_id, p.id) = $1`, [f.obra_id])).rows;
    for (const c of caps) {
      const to = chapters.find((n) => restores(c.name, n));
      if (!to || chapters.some((n) => norm(n) === norm(c.name))) continue; // a chapter really called so stays
      out.capitulos.push({ id: c.id, ref: c.ref, from: c.name, to });
      if (simulate) continue;
      await pool.query('UPDATE presupuesto_capitulos SET name = $2 WHERE id = $1', [c.id, to.slice(0, 200)]);
      await audit({ actor: { label: 'Sistema (relectura del PDF)' }, action: 'Capítulo corregido desde el PDF', target: { label: c.ref },
        detail: `«${c.name}» → «${to}» · releído de «${f.original_name}»` }, pool);
    }
  }
  log(`[reparar-nombres] ${out.pdfs} PDF, ${out.leidos} presupuestos leídos, ${out.cambios.length} partidas ${simulate ? 'por corregir' : 'corregidas'}`);
  for (const c of out.capitulos) log(`  ${c.ref} (capítulo): «${c.from}» → «${c.to}»`);
  for (const c of out.cambios) log(`  ${c.ref}: «${c.from}» → «${c.to}»${c.description ? ' (+ descripción)' : ''}`);
  return out;
}

// Once per database, at startup (never blocks the API: errors are logged and
// the job is retried at the next start).
export async function runRepararNombresOnce(pool, options = {}) {
  if ((await pool.query('SELECT 1 FROM mantenimientos WHERE name = $1', [JOB])).rows.length) return;
  const r = await repararNombresDesdePdf(pool, options);
  await pool.query('INSERT INTO mantenimientos (name, detail) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [JOB, `${r.cambios.length} partidas y ${r.capitulos.length} capítulos corregidos de ${r.leidos} PDF`]);
}
