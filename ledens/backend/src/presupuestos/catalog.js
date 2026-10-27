// Matches the lines of a budget PDF against the base de partidas (DimPartida,
// ledens.work_items), following the rules of the company's budget prompt:
// only active partidas, the most specific one, never forced when scope or unit
// do not fit; lines in another language are translated first (translate.js);
// differences with the base are annotated, never changed silently; a line no
// partida covers becomes a proposed new partida for an admin to approve.
// Read-only on ledens.*: nothing here writes to the base.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Units as written in PDFs and in the base → one comparable form.
const UNIT = [
  ['ml', /^(ml|m\.?\s*l\.?|lm|lin\.?\s*m|linear\s*m(etre|eter)?s?|metros?\s*lineales?|metro\s*lineal|m)$/],
  ['m2', /^(m2|m²|sq\.?\s*m|sqm|m\s*2|metros?\s*cuadrados?|square\s*met(re|er)s?)$/],
  ['m3', /^(m3|m³|cu\.?\s*m|m\s*3|metros?\s*cubicos?|cubic\s*met(re|er)s?)$/],
  ['ud', /^(ud|uds|u|un|und|unid|unidad(es)?|unit|units|pcs?|pieces?|ea|each|nr|no|item|items|pa|p\.a\.|partida\s*alzada|lump\s*sum|ls|global|gl)$/],
  ['kg', /^(kg|kgs|kilos?|kilogramos?)$/],
  ['dia', /^(dia|dias|day|days|jornada|jornadas|jor)$/],
  ['h', /^(h|hr|hrs|hora|horas|hour|hours)$/],
];
export const unitKey = (u) => { const t = norm(u).replace(/\s+/g, ' ').trim().replace(/\.$/, ''); return (UNIT.find(([, re]) => re.test(t)) || [t])[0]; };
const UNIT_LABEL = { ml: 'ml', m2: 'm²', m3: 'm³', ud: 'ud', kg: 'kg', dia: 'día', h: 'h' };
export const unitLabel = (u) => UNIT_LABEL[unitKey(u)] || String(u || '').trim();

// Spanish words that say nothing about the work.
const STOP = new Set(('de la el en con para por los las del una uno unos unas que sin sobre segun incluye incluido incluida incluyendo mediante hasta desde cada entre como mas otros otras otro otra todo toda todos todas este esta estos estas ese esa sus su al lo se no ni y o a e u ya muy tipo segun parte partes zona zonas metro metros lineal lineales cuadrado cuadrados unidad unidades aprox aproximadamente cm mm m2 m3 ml ud uds trabajo trabajos materiales material necesario necesarios existente existentes posterior posteriores previo previa').split(' '));
const stem = (t) => (t.length > 5 && t.endsWith('es') ? t.slice(0, -2) : t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t);
export const tokens = (s) => norm(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)).map(stem);

// Rough language check, for lines that cannot be translated.
const EN = new Set(['the', 'and', 'of', 'with', 'including', 'includes', 'for', 'from', 'to', 'excavation', 'supply', 'installation', 'removal', 'existing', 'wall', 'floor', 'trench', 'slab', 'cleaning']);
export const looksEnglish = (s) => { const w = norm(s).split(/[^a-z]+/).filter(Boolean); return w.length > 2 && w.filter((x) => EN.has(x)).length / w.length > 0.12; };

export async function loadCatalog(db) {
  const rows = (await db.query(`
    SELECT w.id_partida, w.name, w.definicion_partida, w.unit_source, w.sale_price_including_vat::text incl, w.sale_price_excluding_vat::text excl,
           w.activa, w.subcategoria, w.palabrasclave, w.categoria, c.id_categoria
      FROM ledens.work_items w LEFT JOIN ledens.work_categories c ON c.id = w.category_id
     WHERE w.id_partida IS NOT NULL`)).rows;
  return buildCatalog(rows);
}

// Weighted TF-IDF vectors: name and keywords say most about a partida.
export function buildCatalog(rows) {
  const items = rows.map((r) => ({
    code: r.id_partida, name: r.name || '', definition: r.definicion_partida || '', unit: r.unit_source || '', unitKey: unitKey(r.unit_source),
    priceIncl: r.incl == null ? null : Number(r.incl), priceExcl: r.excl == null ? null : Number(r.excl),
    active: norm(r.activa) === 'si', category: r.id_categoria || null, categoryName: r.categoria || null,
    terms: weigh([[r.name, 3], [r.palabrasclave, 2.5], [r.subcategoria, 2], [r.categoria, 1], [r.definicion_partida, 0.6]]),
  }));
  const df = new Map();
  for (const it of items) for (const t of it.terms.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + items.length / (1 + (df.get(t) || 0)));
  for (const it of items) it.vec = vectorize(it.terms, idf);
  return { items, byCode: new Map(items.map((i) => [i.code.toUpperCase(), i])), idf };
}
function weigh(parts) {
  const m = new Map();
  for (const [text, w] of parts) for (const t of tokens(text)) m.set(t, (m.get(t) || 0) + w);
  return m;
}
function vectorize(terms, idf) {
  const v = new Map(); let n = 0;
  for (const [t, w] of terms) { const x = w * idf(t); v.set(t, x); n += x * x; }
  n = Math.sqrt(n) || 1;
  for (const [t, x] of v) v.set(t, x / n);
  return v;
}
const cosine = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of x) s += w * (y.get(t) || 0); return s; };

const MATCH = 0.22;      // minimum similarity to accept a partida by text
const MARGIN = 0.03;     // and clearly better than the next one…
const CLEAR = 0.4;       // …unless it is clearly similar anyway
const CODE_OK = 0.12;    // a PDF code is trusted if its text is at least this close
const NEAREST = 0.03;    // below this, no partida is cited as the nearest one
const unverifiableText = (foreign, t) => (foreign && !t ? ' (sin traducir, no se ha podido comparar con la base, que está en español)' : '');
const eur = (n) => `${n.toFixed(2).replace('.', ',')} €`;

/**
 * lines: [{ code, name, description, unit, unitPrice }] as read from the PDF;
 * pricesIncludeVat: whether those prices include VAT (rate vatRate).
 * translator: { translate(texts) → [{ text, from }] } or null.
 * Returns, per line: { baseCode, baseName, annotations: [{type,text}], proposal|null, translation|null }.
 */
export async function matchLines(lines, catalog, { translator, pricesIncludeVat, vatRate = 21 } = {}) {
  // Translate name + description together (one request for the whole budget).
  const texts = lines.map((l) => [l.name, l.description].filter(Boolean).join('. '));
  let translated = null, translateError = null;
  if (translator && texts.some(Boolean)) {
    try { translated = await translator.translate(texts); } catch (e) { translateError = e.message || 'error'; }
  }
  return lines.map((l, i) => {
    const annotations = [];
    const t = translated?.[i];
    const foreign = t ? t.from && t.from !== 'es' : looksEnglish(texts[i]);
    const text = t && t.from !== 'es' ? t.text : texts[i];
    if (foreign && !t) annotations.push({ type: 'traduccion', text: translateError ? `No se ha podido traducir la línea (${translateError}); se ha casado con el texto original.` : 'Línea en otro idioma sin traducir: el traductor no está configurado; se ha casado con el texto original.' });
    const translatedOk = t && t.from !== 'es';
    const vec = vectorize(weigh([[translatedOk ? translatedName(t.text, l) : l.name, 2], [text, 1]]), catalog.idf);
    const unverifiable = foreign && !t; // English text vs a Spanish base: it cannot be compared
    const unit = unitKey(l.unit);
    const compatible = (it) => !l.unit || it.unitKey === unit;
    const scored = catalog.items.map((it) => ({ it, s: cosine(vec, it.vec) })).sort((a, b) => b.s - a.s);

    let match = null;
    // 1. The PDF's own code, when it is a partida of the base that fits.
    const byCode = l.code ? catalog.byCode.get(String(l.code).trim().toUpperCase()) : null;
    if (byCode) {
      const s = cosine(vec, byCode.vec);
      if (!byCode.active) annotations.push({ type: 'codigo', text: `El código ${byCode.code} del PDF es una partida inactiva en la base («${byCode.name}»): no se usa.` });
      else if (!compatible(byCode)) annotations.push({ type: 'codigo', text: `El código ${byCode.code} del PDF es en la base «${byCode.name}» con unidad ${unitLabel(byCode.unit)}, distinta de la del PDF (${l.unit}).` });
      else if (unverifiable) {
        match = { item: byCode, how: 'código' };
        annotations.push({ type: 'codigo', text: `Casada por el código ${byCode.code} «${byCode.name}» sin poder comprobar el texto (no traducido).` });
      } else if (s < CODE_OK) annotations.push({ type: 'codigo', text: `El código ${byCode.code} del PDF es en la base «${byCode.name}», que no corresponde a esta línea.` });
      else match = { item: byCode, how: 'código' };
    } else if (l.code && /^PA-\d+$/i.test(String(l.code).trim())) {
      annotations.push({ type: 'codigo', text: `El código ${l.code} del PDF no existe en la base.` });
    }
    // 2. Text: the most similar active partida with the same unit.
    if (!match) {
      const ok = scored.filter((x) => x.it.active && compatible(x.it));
      const [a, b] = ok;
      if (a && a.s >= MATCH && (a.s >= CLEAR || !b || a.s - b.s >= MARGIN)) match = { item: a.it, how: 'texto', score: a.s };
    }

    if (!match) {
      // A «nearest» partida that shares nothing with the line is no reference at all.
      const best = scored.find((x) => x.it.active) || scored[0];
      const nearest = best && best.s >= NEAREST ? best : null;
      const priceIncl = l.unitPrice == null ? null : pricesIncludeVat ? Number(l.unitPrice) : Number(l.unitPrice) * (1 + vatRate / 100);
      const reason = nearest
        ? `Ninguna partida activa de la base con unidad ${l.unit ? unitLabel(l.unit) : 'compatible'} cubre esta línea; la más próxima es ${nearest.it.code} «${nearest.it.name}» (${unitLabel(nearest.it.unit)}, similitud ${nearest.s.toFixed(2)}).`
        : `Ninguna partida de la base se parece a esta línea${unverifiableText(foreign, t)}.`;
      annotations.push({ type: 'nueva', text: `${reason} Se propone una partida nueva, pendiente de que la apruebe un administrador.` });
      return {
        baseCode: null, baseName: null, annotations, translation: t && t.from !== 'es' ? text : null,
        proposal: {
          name: (t && t.from !== 'es' ? translatedName(t.text, l) : l.name || '').slice(0, 300) || 'Partida sin nombre',
          definition: (t && t.from !== 'es' ? text : texts[i]).slice(0, 4000) || null,
          unit: unitLabel(l.unit) || 'ud',
          priceInclVat: priceIncl == null ? null : Math.round(priceIncl * 1e6) / 1e6,
          categoryCode: nearest?.it.category || null, categoryName: nearest?.it.categoryName || null,
          nearestCode: nearest?.it.code || null, reason,
        },
      };
    }

    const it = match.item;
    // Price: the PDF's is kept; a difference with the base is annotated.
    if (l.unitPrice != null) {
      const pdf = pricesIncludeVat ? Number(l.unitPrice) : Number(l.unitPrice);
      const base = pricesIncludeVat ? it.priceIncl : it.priceExcl;
      if (base == null) annotations.push({ type: 'precio', text: `La partida ${it.code} no tiene precio en la base; se usa el del PDF (${eur(pdf)}).` });
      else if (Math.abs(pdf - base) > 0.005) {
        const d = pdf - base;
        annotations.push({ type: 'precio', text: `Precio del PDF ${eur(pdf)} y de la base ${eur(base)} (${d > 0 ? '+' : '−'}${eur(Math.abs(d))}, ${d > 0 ? '+' : '−'}${Math.abs(d / base * 100).toFixed(1).replace('.', ',')} %) ${pricesIncludeVat ? 'IVA incluido' : 'sin IVA'}. Se usa el del PDF.` });
      }
    }
    if (it.priceIncl != null && it.priceExcl != null && Math.abs(it.priceExcl * (1 + vatRate / 100) - it.priceIncl) > 0.02) {
      annotations.push({ type: 'base', text: `Incoherencia en la base: ${it.code} tiene ${eur(it.priceIncl)} con IVA y ${eur(it.priceExcl)} sin IVA. No se ha corregido.` });
    }
    if (match.how === 'texto') {
      annotations.push({ type: 'codigo', text: `Casada por texto con ${it.code} «${it.name}» (similitud ${match.score.toFixed(2)}).` });
    }
    return { baseCode: it.code, baseName: it.name, annotations, proposal: null, translation: t && t.from !== 'es' ? text : null };
  });
}

// The translated name is the first sentence of the translated «name. description».
function translatedName(text, l) {
  const first = String(text).split(/(?<=\.)\s/)[0].replace(/\.$/, '');
  return l.description ? first : text;
}
