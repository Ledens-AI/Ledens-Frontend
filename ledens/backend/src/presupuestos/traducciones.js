import crypto from 'node:crypto';

// A presupuesto in the client's language. Budgets are written in Spanish; a
// client who uses the platform in English reads the chapter names, the line
// names and descriptions and the version notes in English. Each text is
// translated once (Azure AI Translator) and kept in presupuesto_traducciones
// (migration 032). Only fields are added (`nameEn`, `descriptionEn`,
// `notesEn`): the Spanish stays as it is, so the team's editor never saves a
// translation. Without a translator, or if it fails, the Spanish is shown.
// Some lines are typed in another language (an ampliación written in
// English), so Spanish is a target too (`nameEs`, …): a text the translator
// already finds Spanish is kept as written and only cached, never rewritten.
export const LANGS = ['en', 'es'];
const SUFFIX = { en: 'En', es: 'Es' };
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Every [object, field] of the doc a client reads.
function fields(doc) {
  const out = [];
  const add = (o, k) => { if (o && typeof o[k] === 'string' && o[k].trim()) out.push([o, k]); };
  for (const chapters of [doc?.version?.chapters, doc?.obra?.chapters]) {
    for (const c of chapters || []) {
      add(c, 'name');
      for (const i of c.items || []) { add(i, 'name'); add(i, 'description'); add(i.lastDeclared, 'note'); }
    }
  }
  add(doc?.version, 'notes');
  return out;
}

// Adds the translations and `translation: { lang, complete, error }` so a
// failure can be seen on screen (the error text only for the team, `can.rename`).
// The cache and the translator fail apart: without the table, texts are still
// translated; without the translator, cached texts are still shown.
export async function translateDoc(db, translator, doc, lang) {
  if (!LANGS.includes(lang) || !doc) return doc;
  const list = fields(doc);
  const texts = [...new Set(list.map(([o, k]) => o[k]))];
  const known = new Map();
  const errors = [];
  const hashes = texts.map(hash);
  if (texts.length) {
    try {
      const rows = (await db.query('SELECT source_hash, translated FROM presupuesto_traducciones WHERE lang=$1 AND source_hash = ANY($2::text[])', [lang, hashes])).rows;
      const byHash = new Map(rows.map((r) => [r.source_hash, r.translated]));
      texts.forEach((t, n) => { if (byHash.has(hashes[n])) known.set(t, byHash.get(hashes[n])); });
    } catch (e) { errors.push(`caché: ${e.message || e}`); }
  }
  const missing = texts.filter((t) => !known.has(t));
  // Spanish without a translator is the text as written: nothing to report.
  if (missing.length && !translator && lang !== 'es') errors.push('traductor no configurado (AZURE_TRANSLATOR_KEY)');
  if (missing.length && translator) {
    let fresh = [];
    try {
      const res = await translator.translate(missing, { to: lang });
      fresh = missing.map((t, n) => [t, res[n]?.from === lang ? t : res[n]?.text]).filter(([, x]) => typeof x === 'string' && x.trim());
      for (const [t, x] of fresh) known.set(t, x);
    } catch (e) { errors.push(`traductor: ${e.message || e}`); }
    if (fresh.length) {
      try {
        await db.query(`INSERT INTO presupuesto_traducciones (lang, source_hash, translated)
          SELECT $1, h, x FROM unnest($2::text[], $3::text[]) AS u(h, x) ON CONFLICT DO NOTHING`,
        [lang, fresh.map(([t]) => hash(t)), fresh.map(([, x]) => x)]);
      } catch (e) { errors.push(`caché: ${e.message || e}`); }
    }
  }
  if (errors.length) console.error('[traducciones]', doc.ref || doc.id, errors.join(' · '));
  // A text already in the target language adds nothing.
  for (const [o, k] of list) if (known.has(o[k]) && known.get(o[k]) !== o[k]) o[`${k}${SUFFIX[lang]}`] = known.get(o[k]);
  const complete = texts.every((t) => known.has(t));
  // Budgets are written in Spanish, so an untranslated Spanish screen is
  // still readable: only the English screen reports what is missing.
  if (lang === 'es') return doc;
  doc.translation = { lang, complete, ...(!complete && doc.can?.rename ? { error: errors.join(' · ') || 'traducción incompleta' } : {}) };
  return doc;
}
