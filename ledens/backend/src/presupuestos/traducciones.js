import crypto from 'node:crypto';

// A presupuesto in the client's language. Budgets are written in Spanish; a
// client who uses the platform in English reads the chapter names, the line
// names and descriptions and the version notes in English. Each text is
// translated once (Azure AI Translator) and kept in presupuesto_traducciones
// (migration 032). Only fields are added (`nameEn`, `descriptionEn`,
// `notesEn`): the Spanish stays as it is, so the team's editor never saves a
// translation. Without a translator, or if it fails, the Spanish is shown.
export const LANGS = ['en'];
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Every [object, field] of the doc a client reads.
function fields(doc) {
  const out = [];
  const add = (o, k) => { if (o && typeof o[k] === 'string' && o[k].trim()) out.push([o, k]); };
  for (const chapters of [doc?.version?.chapters, doc?.obra?.chapters]) {
    for (const c of chapters || []) {
      add(c, 'name');
      for (const i of c.items || []) { add(i, 'name'); add(i, 'description'); }
    }
  }
  add(doc?.version, 'notes');
  return out;
}

export async function translateDoc(db, translator, doc, lang) {
  if (!LANGS.includes(lang) || !translator || !doc) return doc;
  const list = fields(doc);
  if (!list.length) return doc;
  const texts = [...new Set(list.map(([o, k]) => o[k]))];
  const known = new Map();
  try {
    const hashes = texts.map(hash);
    const rows = (await db.query('SELECT source_hash, translated FROM presupuesto_traducciones WHERE lang=$1 AND source_hash = ANY($2::text[])', [lang, hashes])).rows;
    const byHash = new Map(rows.map((r) => [r.source_hash, r.translated]));
    texts.forEach((t, n) => { if (byHash.has(hashes[n])) known.set(t, byHash.get(hashes[n])); });
    const missing = texts.filter((t) => !known.has(t));
    if (missing.length) {
      const res = await translator.translate(missing, { to: lang });
      const fresh = missing.map((t, n) => [t, res[n]?.text]).filter(([, x]) => typeof x === 'string' && x.trim());
      for (const [t, x] of fresh) known.set(t, x);
      if (fresh.length) {
        await db.query(`INSERT INTO presupuesto_traducciones (lang, source_hash, translated)
          SELECT $1, h, x FROM unnest($2::text[], $3::text[]) AS u(h, x) ON CONFLICT DO NOTHING`,
        [lang, fresh.map(([t]) => hash(t)), fresh.map(([, x]) => x)]);
      }
    }
  } catch (e) {
    console.error('[traducciones]', e.message || e);
  }
  for (const [o, k] of list) if (known.has(o[k])) o[`${k}En`] = known.get(o[k]);
  return doc;
}
