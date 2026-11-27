import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { EMISOR } from '../facturas/emisor.js';
import { euros } from '../facturas/pdf.js';
import { PresupuestoError } from './service.js';

// PDFs a client can print or forward without using the platform:
//  - presupuesto(): the presupuesto as the screen shows it. For an approved
//    obra (root presupuesto) it is the budget in force: the original quote and
//    every approved ampliación, each with its chapters and lines, and the
//    totals of the obra; ampliaciones still waiting for approval are listed
//    apart, never added. Otherwise, the version on screen (`versionId`).
//  - avance(): the progress of every approved line of the obra (root +
//    approved ampliaciones), as % of its quantity, by chapter and overall.
// Both are built from PresupuestosService.get() — the same visibility and the
// same figures as the screen — and print only what a client reads there
// (never annotations, base codes or why a line was removed). The texts follow
// the screen's language (X-Ledens-Lang): labels here, budget texts through
// translateDoc (`localize`).
const fail = (status, message) => { throw new PresupuestoError(status, message); };

const LOGO = fs.readFileSync(new URL('../facturas/logo.png', import.meta.url));
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex('#1F1F1F'), muted: hex('#6B6B68'), brand: hex('#5567AE'), soft: hex('#E3E7F3'), line: hex('#D6D6D2'),
  track: hex('#E4E6EE'), done: hex('#3F8F84'), warn: hex('#9E2F2F'), white: rgb(1, 1, 1),
};
const W = 595.28, H = 841.89, L = 40, R = W - 40, TOP = H - 40, BOTTOM = 56, PAD = 5;
// Below the running header of every page after the first.
const CONT_TOP = TOP - 24;

const madridDay = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
// "YYYY-MM-DD" as written; a timestamp (Date or ISO) as its day in Madrid.
const dayOf = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : madridDay(d);
};
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUM = {
  es: new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3, useGrouping: 'always' }),
  en: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }),
};
const EUR_EN = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });

const FMT = {
  es: {
    eur: (v) => euros(v || 0),
    num: (v) => NUM.es.format(Number(v || 0)),
    pct: (v) => `${String(Number(v || 0)).replace('.', ',')} %`,
    date: (v) => { const d = dayOf(v); if (!d) return '—'; const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; },
  },
  en: {
    eur: (v) => EUR_EN.format(Number(v || 0)),
    num: (v) => NUM.en.format(Number(v || 0)),
    pct: (v) => `${Number(v || 0)}%`,
    date: (v) => { const d = dayOf(v); if (!d) return '—'; const [y, m, day] = d.split('-'); return `${Number(day)} ${MON_EN[Number(m) - 1]} ${y}`; },
  },
};

const TXT = {
  es: {
    file: { budget: 'Presupuesto', progress: 'Avance' },
    budget: 'Presupuesto', budgetObra: 'Presupuesto de la obra', progress: 'Informe de avance de obra',
    budgetObraSub: (n) => (n ? `Presupuesto vigente: el inicial y ${n === 1 ? 'la ampliación aprobada' : `las ${n} ampliaciones aprobadas`}` : 'Presupuesto vigente de la obra'),
    progressSub: (d) => `Situación de cada partida a ${d}`,
    obra: 'Obra', ref: 'Referencia', address: 'Dirección', client: 'Cliente', jefe: 'Jefe de obra', version: 'Versión', issued: 'Fecha del documento',
    extensionOf: 'Ampliación de', start: 'Inicio de la obra', end: 'Fin previsto', noEnd: 'Sin fecha prevista', notAssigned: 'Sin asignar',
    status: {
      draft: () => 'Borrador (aún no enviado al cliente)', sent: (d) => `enviada el ${d}`, changes_requested: () => 'cambios solicitados',
      approved: (d) => `aprobada el ${d}`, rejected: () => 'rechazada', superseded: () => 'sustituida por una versión posterior',
    },
    versionN: (n, status) => `Versión ${n}${status ? ` · ${status}` : ''}`,
    hCode: 'Código', hItem: 'Partida', hUnit: 'Ud.', hQty: 'Cantidad', hPrice: 'Precio', hAmount: 'Importe',
    hBudgeted: 'Presupuestado', hExecuted: 'Ejecutado', hProgress: 'Avance', hChapter: 'Capítulo', hConcept: 'Concepto', hApproved: 'Aprobado',
    amountsNote: 'Importes en euros sin IVA. El IVA se suma en el total.',
    cont: 'continuación',
    kindCond: 'Partida condicionada', optChosen: 'Opción elegida', optOut: 'Opcional · no incluida en el total',
    base: 'Base imponible', vat: (r) => (r == null ? 'IVA' : `IVA (${FMT.es.pct(r)})`), total: 'Total con IVA',
    optNotIncluded: 'Opciones no incluidas (sin IVA)', optNotChosen: 'Opciones no elegidas (sin IVA)',
    summary: 'Resumen', initial: 'Presupuesto inicial', extension: 'Ampliación',
    sectionTotal: (amp) => (amp ? 'Total de la ampliación (sin IVA)' : 'Total del presupuesto inicial (sin IVA)'),
    pendingTitle: 'Ampliaciones pendientes de aprobación', pendingNote: 'No están incluidas en el total hasta que se aprueben.',
    notesTitle: 'Condiciones y exclusiones',
    overall: 'Avance general de la obra', executedOf: (a, b) => `Trabajo ejecutado: ${a} de ${b} (sin IVA)`,
    includesExt: (refs) => `Incluye las ampliaciones aprobadas: ${refs}.`,
    byChapter: 'Avance por capítulo', detail: 'Avance por partida', extTag: (ref) => `Ampliación ${ref}`,
    updated: (d) => `Actualizado el ${d}`, excess: 'Se ha ejecutado más de lo presupuestado',
    howTitle: 'Cómo leer este informe',
    how: 'El avance de cada partida es la cantidad ejecutada sobre la presupuestada, como máximo el 100 %. El avance de un capítulo y el de la obra tienen en cuenta el importe de cada partida: una partida grande pesa más que una pequeña.',
    page: (i, n) => `Página ${i} de ${n}`,
  },
  en: {
    file: { budget: 'Quote', progress: 'Progress' },
    budget: 'Quote', budgetObra: 'Works budget', progress: 'Works progress report',
    budgetObraSub: (n) => (n ? `Current budget: the original quote and ${n === 1 ? 'the approved extension' : `the ${n} approved extensions`}` : 'Current budget of the works'),
    progressSub: (d) => `Status of each item as of ${d}`,
    obra: 'Works', ref: 'Reference', address: 'Address', client: 'Client', jefe: 'Site manager', version: 'Version', issued: 'Document date',
    extensionOf: 'Extension of', start: 'Start of works', end: 'Planned end', noEnd: 'No planned date', notAssigned: 'Not assigned',
    status: {
      draft: () => 'Draft (not yet sent to the client)', sent: (d) => `sent on ${d}`, changes_requested: () => 'changes requested',
      approved: (d) => `approved on ${d}`, rejected: () => 'rejected', superseded: () => 'superseded by a later version',
    },
    versionN: (n, status) => `Version ${n}${status ? ` · ${status}` : ''}`,
    hCode: 'Code', hItem: 'Item', hUnit: 'Unit', hQty: 'Quantity', hPrice: 'Price', hAmount: 'Amount',
    hBudgeted: 'Budgeted', hExecuted: 'Carried out', hProgress: 'Progress', hChapter: 'Chapter', hConcept: 'Item', hApproved: 'Approved',
    amountsNote: 'Amounts in euros excluding VAT. VAT is added in the total.',
    cont: 'continued',
    kindCond: 'Conditional item', optChosen: 'Chosen option', optOut: 'Optional · not included in the total',
    base: 'Taxable base', vat: (r) => (r == null ? 'VAT' : `VAT (${FMT.en.pct(r)})`), total: 'Total incl. VAT',
    optNotIncluded: 'Options not included (excl. VAT)', optNotChosen: 'Options not chosen (excl. VAT)',
    summary: 'Summary', initial: 'Original quote', extension: 'Extension',
    sectionTotal: (amp) => (amp ? 'Extension total (excl. VAT)' : 'Original quote total (excl. VAT)'),
    pendingTitle: 'Extensions awaiting approval', pendingNote: 'They are not included in the total until approved.',
    notesTitle: 'Terms and exclusions',
    overall: 'Overall progress of the works', executedOf: (a, b) => `Work carried out: ${a} of ${b} (excl. VAT)`,
    includesExt: (refs) => `Includes the approved extensions: ${refs}.`,
    byChapter: 'Progress by chapter', detail: 'Progress by item', extTag: (ref) => `Extension ${ref}`,
    updated: (d) => `Updated on ${d}`, excess: 'More than budgeted has been carried out',
    howTitle: 'How to read this report',
    how: 'The progress of each item is the quantity carried out over the budgeted quantity, at most 100%. The progress of a chapter and of the works takes each item’s amount into account: a large item weighs more than a small one.',
    page: (i, n) => `Page ${i} of ${n}`,
  },
};

// A file name with ASCII letters, digits and dashes only (it also goes in a header).
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_')
  .replace(/^_+|_+$/g, '').slice(0, 60).replace(/_+$/, '');
const fileName = (...parts) => `${parts.map(plain).filter(Boolean).join('_')}.pdf`;
const cents = (v) => Math.round(Number(v || 0) * 100);

export class InformesService {
  // svc: the PresupuestosService of the request (its user, «Ver como» included);
  // localize(doc): the doc with its budget texts in `lang` (translateDoc).
  constructor(svc, { lang, localize = async (d) => d, now = () => new Date() } = {}) {
    this.svc = svc;
    this.lang = lang === 'en' ? 'en' : 'es';
    this.t = TXT[this.lang];
    this.fx = FMT[this.lang];
    this.localize = localize;
    this.now = now;
    // A budget text in the document's language: `nameEn` / `nameEs` when the
    // translator found it written in another one, else as written.
    const suffix = this.lang === 'en' ? 'En' : 'Es';
    this.tr = (o, k) => o?.[`${k}${suffix}`] || o?.[k] || '';
  }

  async presupuesto(id, { versionId } = {}) {
    const doc = await this.localize(await this.svc.get(id, { versionId }));
    const obra = doc.obra && !versionId;
    const model = obra ? await this.obraModel(doc) : this.versionModel(doc);
    const version = obra ? null : `v${doc.version.number}`;
    return { filename: fileName(this.t.file.budget, doc.ref, version, doc.title), bytes: await render(model, this) };
  }

  async avance(id) {
    const doc = await this.localize(await this.svc.get(id));
    if (doc.parent) fail(400, 'El informe de avance se descarga desde la obra principal');
    if (!doc.obra) fail(409, 'La obra todavía no tiene un presupuesto aprobado');
    if (!doc.obra.startDate) fail(409, 'La obra aún no tiene fecha de inicio: todavía no hay avance');
    const today = madridDay(this.now());
    return { filename: fileName(this.t.file.progress, doc.ref, today), bytes: await render(this.avanceModel(doc, today), this) };
  }

  people(doc) {
    const { t } = this;
    return [[t.client, doc.client?.name || '—'], [t.jefe, doc.jefe?.name || t.notAssigned]];
  }

  // One version: its counted lines, the optional ones apart, its totals and notes.
  versionModel(doc) {
    const { t, fx, tr } = this;
    const v = doc.version;
    const status = t.status[v.status]?.(fx.date(v.status === 'sent' ? v.sentAt : v.decidedAt));
    const meta = [[t.obra, doc.title], [t.ref, doc.ref], ...(doc.parent ? [[t.extensionOf, `${doc.parent.ref} · ${doc.parent.title}`]] : []),
      [t.address, doc.address || '—'], ...this.people(doc), [t.version, t.versionN(v.number, status)], [t.issued, fx.date(this.now())]];
    const chapters = v.chapters.map((c) => ({ name: tr(c, 'name'), base: fx.eur(c.base), items: c.items.filter((i) => !i.removed).map((i) => this.line(i)) }))
      .filter((c) => c.items.length);
    const totals = [[t.base, fx.eur(v.base)], [t.vat(v.vatRate), fx.eur(v.vat)], [t.total, fx.eur(v.total), true]];
    if (Number(v.optionalBase) > 0) totals.push([v.status === 'approved' ? t.optNotChosen : t.optNotIncluded, fx.eur(v.optionalBase), false, true]);
    return {
      kind: 'presupuesto', title: t.budget, subtitle: null, running: `${doc.ref} · ${doc.title}`, meta,
      sections: [{ chapters }], totals, notes: v.notes ? [{ text: tr(v, 'notes') }] : [],
    };
  }

  // A line as a client reads it: the optional ones say whether they count.
  line(i) {
    const { t, fx, tr } = this;
    const optional = i.kind === 'decision' || i.kind === 'opcion';
    const counted = i.counted !== false;
    const tag = i.kind === 'condicionada' ? t.kindCond : optional ? (counted ? t.optChosen : t.optOut) : null;
    return {
      code: i.code || '—', name: tr(i, 'name'), description: tr(i, 'description'), unit: i.unit, quantity: fx.num(i.quantity),
      price: fx.eur(i.unitPrice), amount: fx.eur(i.amount), tag, out: !counted,
    };
  }

  // The obra: original quote + approved ampliaciones (in the order they were
  // approved), each with its chapters; the obra's totals.
  async obraModel(doc) {
    const { t, fx, tr } = this;
    const o = doc.obra;
    const root = doc.versions.find((v) => v.status === 'approved');
    const amps = new Map(doc.ampliaciones.filter((a) => a.version.status === 'approved').map((a) => [a.id, a]));
    const sections = [];
    for (const c of o.chapters) {
      let s = sections[sections.length - 1];
      if (!s || s.id !== c.presupuesto.id) {
        const a = amps.get(c.presupuesto.id);
        const info = a ? { number: a.version.number, decidedAt: a.version.decidedAt, base: a.base, vatRate: a.vatRate }
          : { number: root?.number, decidedAt: root?.decidedAt, base: root?.base, vatRate: root?.vatRate };
        sections.push(s = { id: c.presupuesto.id, ampliacion: c.presupuesto.ampliacion, ref: c.presupuesto.ref, title: c.presupuesto.title, ...info, chapters: [] });
      }
      s.chapters.push({ name: tr(c, 'name'), base: fx.eur(c.base), items: c.items.map((i) => this.line(i)) });
    }
    const multi = sections.length > 1;
    for (const s of sections) {
      const approved = t.versionN(s.number, t.status.approved(fx.date(s.decidedAt)));
      s.heading = s.ampliacion ? `${t.extension} ${s.ref} · ${s.title}` : `${t.initial} · ${s.ref}`;
      s.subheading = approved;
      s.footer = [t.sectionTotal(s.ampliacion), fx.eur(s.base)];
      if (!multi) s.heading = s.subheading = s.footer = null;
    }
    const rates = new Set(sections.map((s) => String(Number(s.vatRate))));
    const vatRate = rates.size === 1 ? [...rates][0] : null;
    const totals = [[t.base, fx.eur(o.base)], [t.vat(vatRate), fx.eur(o.vat)], [t.total, fx.eur(o.total), true]];
    const summary = multi ? {
      rows: sections.map((s) => [s.ampliacion ? `${t.extension} ${s.ref} · ${s.title}` : `${t.initial} · ${s.ref}`, fx.date(s.decidedAt), fx.eur(s.base)]),
      totals,
    } : null;
    // Ampliaciones sent but not approved yet: listed, never added.
    const pending = doc.ampliaciones.filter((a) => ['pendiente', 'cambios'].includes(a.phase))
      .map((a) => `${a.ref} · ${a.title} · ${t.total}: ${fx.eur(a.total)}`);
    // The conditions of each approved presupuesto, in the document's language.
    const ids = sections.map((s) => s.id);
    const rows = (await this.svc.pool.query("SELECT presupuesto_id, notes FROM presupuesto_versiones WHERE presupuesto_id=ANY($1::uuid[]) AND status='approved' AND notes IS NOT NULL",
      [ids])).rows;
    const notes = [];
    for (const s of sections) {
      const r = rows.find((x) => x.presupuesto_id === s.id);
      if (!r?.notes?.trim()) continue;
      const translated = await this.localize({ version: { notes: r.notes } });
      notes.push({ heading: multi ? (s.ampliacion ? `${t.extension} ${s.ref}` : `${t.initial} · ${s.ref}`) : null, text: tr(translated.version, 'notes') });
    }
    const meta = [[t.obra, doc.title], [t.ref, doc.ref], [t.address, doc.address || '—'], ...this.people(doc),
      ...(o.startDate ? [[t.start, fx.date(o.startDate)]] : []), [t.issued, fx.date(this.now())]];
    return {
      kind: 'presupuesto', title: t.budgetObra, subtitle: t.budgetObraSub(sections.length - 1), running: `${doc.ref} · ${doc.title}`, meta,
      summary, sections, totals, pending, notes,
    };
  }

  avanceModel(doc, today) {
    const { t, fx, tr } = this;
    const o = doc.obra;
    const exts = [...new Set(o.chapters.filter((c) => c.presupuesto.ampliacion).map((c) => c.presupuesto.ref))];
    const chapters = o.chapters.map((c) => ({
      name: tr(c, 'name'), ext: c.presupuesto.ampliacion ? t.extTag(c.presupuesto.ref) : null, pct: c.executionPct,
      items: c.items.map((i) => ({
        code: i.code || '—', name: tr(i, 'name'),
        notes: [i.lastDeclared?.at ? t.updated(fx.date(i.lastDeclared.at)) : null, i.excess ? t.excess : null].filter(Boolean),
        excess: i.excess,
        budgeted: `${fx.num(i.quantity)} ${i.unit}`, executed: `${fx.num(i.executed)} ${i.unit}`, pct: i.executionPct,
      })),
    }));
    const meta = [[t.obra, doc.title], [t.ref, doc.ref], [t.address, doc.address || '—'], ...this.people(doc),
      [t.start, fx.date(o.startDate)], [t.end, o.endDate ? fx.date(o.endDate) : t.noEnd]];
    return {
      kind: 'avance', title: t.progress, subtitle: t.progressSub(fx.date(today)), running: `${doc.ref} · ${doc.title}`, meta,
      overall: { pct: o.executionPct, text: t.executedOf(fx.eur(o.executedAmount), fx.eur(o.base)), exts: exts.length ? t.includesExt(exts.join(', ')) : null },
      chapters,
    };
  }
}

// Page writer on pdf-lib: standard fonts, wrapping, page breaks with a
// running header (and the open table's header again), page numbers at the end.
class Writer {
  static async create(model, lang) {
    const doc = await PDFDocument.create();
    doc.setTitle(`${model.title} · ${model.running}`);
    doc.setAuthor(EMISOR.nombre);
    doc.setCreator('Ledens');
    doc.setProducer('Ledens');
    doc.setLanguage(lang === 'en' ? 'en-GB' : 'es-ES');
    const f = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    };
    return new Writer(doc, f, await doc.embedPng(LOGO), model.running);
  }

  constructor(doc, f, logo, running) {
    Object.assign(this, { doc, f, logo, running, ok: new Map(), page: null, y: 0, onPage: null, headH: 0 });
  }

  // Standard fonts only encode WinAnsi: anything else becomes «?» instead of failing.
  safe(fnt, s) {
    return [...String(s ?? '').replace(/[\r\n\t]+/g, ' ')].map((ch) => {
      const k = fnt.name + ch;
      if (!this.ok.has(k)) { try { fnt.encodeText(ch); this.ok.set(k, true); } catch { this.ok.set(k, false); } }
      return this.ok.get(k) ? ch : '?';
    }).join('');
  }

  width(fnt, s, size) { return fnt.widthOfTextAtSize(s, size); }

  text(s, x, y, { f = this.f.regular, size = 9, color = C.ink, align = 'left' } = {}) {
    const t = this.safe(f, s);
    const w = this.width(f, t, size);
    this.page.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y, size, font: f, color });
  }

  // Lines of at most maxWidth; a word longer than the line is cut.
  wrap(s, fnt, size, maxWidth) {
    const lines = [];
    for (const para of String(s ?? '').split(/\r?\n/)) {
      let line = '';
      for (let word of this.safe(fnt, para).split(/\s+/).filter(Boolean)) {
        while (this.width(fnt, word, size) > maxWidth) {
          let n = word.length - 1;
          while (n > 1 && this.width(fnt, word.slice(0, n), size) > maxWidth) n--;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, n));
          word = word.slice(n);
        }
        const next = line ? `${line} ${word}` : word;
        if (this.width(fnt, next, size) <= maxWidth) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  rect(x, y, w, h, color) { this.page.drawRectangle({ x, y, width: w, height: h, color }); }
  hline(y, color = C.line, x0 = L, x1 = R, thickness = 0.6) { this.page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness, color }); }

  // 0–100 bar; full and green at 100 %.
  bar(x, y, w, h, pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    this.rect(x, y, w, h, C.track);
    if (p > 0) this.rect(x, y, Math.max(1, w * p / 100), h, p >= 100 ? C.done : C.brand);
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = TOP;
    if (this.doc.getPageCount() > 1) {
      this.text(this.running, L, TOP, { size: 8, color: C.muted });
      this.hline(TOP - 7);
      this.y = CONT_TOP;
    }
    this.onPage?.();
  }

  room() { return this.y - BOTTOM; }
  // h points below, else a new page.
  ensure(h) { if (this.room() < h) this.newPage(); }

  // Paragraphs of text across pages, line by line.
  paragraph(s, { f = this.f.regular, size = 9, color = C.ink, x = L, width = R - L, gap = 1.35 } = {}) {
    for (const l of this.wrap(s, f, size, width)) {
      this.ensure(size * gap);
      this.text(l, x, this.y - size, { f, size, color });
      this.y -= size * gap;
    }
  }

  // Columns from their widths; the one without a width takes the rest.
  static columns(defs) {
    const fixed = defs.reduce((a, d) => a + (d.w || 0), 0);
    let x = L;
    return defs.map((d) => { const w = d.w || R - L - fixed; const c = { ...d, x0: x, x1: x + w }; x += w; return c; });
  }

  head(cols) {
    const h = 19;
    this.rect(L, this.y - h, R - L, h, C.brand);
    for (const c of cols) this.text(c.label, c.align === 'right' ? c.x1 - PAD : c.x0 + PAD, this.y - 12.8, { f: this.f.bold, size: 8, color: C.white, align: c.align || 'left' });
    this.y -= h;
  }

  // A table row. A cell is { parts: [{ s, f, size, color }] } (wrapped text) or
  // { h, draw(x0, x1, top) }. The row stays on one page when it fits on one;
  // a taller one (a very long description) runs on, its tallest cell
  // continuing below the table header of the next page.
  row(cols, cells) {
    const laid = cells.map((cell, i) => {
      if (!cell) return { lines: [], h: 0 };
      if (cell.draw) return cell;
      const width = cols[i].x1 - cols[i].x0 - 2 * PAD;
      const lines = [];
      for (const p of cell.parts) {
        const size = p.size || 9;
        for (const l of this.wrap(p.s, p.f || this.f.regular, size, width)) lines.push({ s: l, f: p.f || this.f.regular, size, color: p.color || C.ink, lh: size * 1.32 });
      }
      return { lines, h: lines.reduce((a, l) => a + l.lh, 0) };
    });
    const tallest = laid.reduce((best, c, i) => (c.h > laid[best].h ? i : best), 0);
    const h = laid[tallest].h + 2 * PAD;
    const fresh = CONT_TOP - BOTTOM - this.headH;
    const others = Math.max(0, ...laid.filter((_, i) => i !== tallest).map((c) => c.h)) + 2 * PAD;
    if (h > this.room() && (h <= fresh || others > this.room() || this.room() < 30)) this.newPage();
    const top = this.y - PAD;
    const cellX = (c, i) => (cols[i].align === 'right' ? cols[i].x1 - PAD : cols[i].x0 + PAD);
    laid.forEach((c, i) => {
      if (i === tallest) return;
      if (c.draw) { c.draw(cols[i].x0 + PAD, cols[i].x1 - PAD, top); return; }
      let y = top;
      for (const l of c.lines) { this.text(l.s, cellX(c, i), y - l.size, { f: l.f, size: l.size, color: l.color, align: cols[i].align }); y -= l.lh; }
    });
    const flow = laid[tallest];
    const startPage = this.page;
    let y = top;
    if (flow.draw) { flow.draw(cols[tallest].x0 + PAD, cols[tallest].x1 - PAD, top); y = top - flow.h; }
    else {
      for (const l of flow.lines) {
        if (y - l.lh < BOTTOM) { this.newPage(); y = this.y - PAD; }
        this.text(l.s, cellX(flow, tallest), y - l.size, { f: l.f, size: l.size, color: l.color, align: cols[tallest].align });
        y -= l.lh;
      }
    }
    this.y = (this.page === startPage ? Math.min(y, top - others + 2 * PAD) : y) - PAD;
    this.hline(this.y);
  }

  // Page numbers and the issuer on every page.
  async save(t) {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      this.page = p;
      this.hline(BOTTOM - 16, C.line);
      this.text(`${EMISOR.nombre} · CIF ${EMISOR.cif}`, L, BOTTOM - 28, { size: 7.5, color: C.muted });
      this.text(t.page(i + 1, pages.length), R, BOTTOM - 28, { size: 7.5, color: C.muted, align: 'right' });
    });
    return this.doc.save();
  }
}

async function render(model, ctx) {
  const { t } = ctx;
  const w = await Writer.create(model, ctx.lang);
  w.newPage();
  header(w, model);
  if (model.kind === 'avance') drawAvance(w, model, ctx);
  else drawPresupuesto(w, model, ctx);
  return w.save(t);
}

// First page: logo, the issuer, the document's title and its data.
function header(w, model) {
  const { f } = w;
  w.page.drawImage(w.logo, { x: L, y: TOP - 52, width: 52, height: 52 });
  w.text('Ledens', L + 60, TOP - 30, { f: f.bold, size: 26, color: C.brand });
  w.text('DESCUBRE  |  ANALIZA  |  RENTABILIZA', L + 62, TOP - 42, { size: 5.5, color: C.muted });
  const issuer = [[EMISOR.nombre, f.bold], [`CIF: ${EMISOR.cif}`], [EMISOR.direccion], [[EMISOR.telefono, EMISOR.email].filter(Boolean).join(' · ')]];
  issuer.forEach(([s, fnt], i) => w.text(s, R, TOP - 8 - i * 12, { f: fnt || f.regular, size: 8.5, color: fnt ? C.ink : C.muted, align: 'right' }));
  w.y = TOP - 70;
  w.hline(w.y);
  w.y -= 30;
  w.text(model.title, L, w.y, { f: f.bold, size: 20, color: C.brand });
  w.y -= 8;
  if (model.subtitle) { w.y -= 12; w.text(model.subtitle, L, w.y, { size: 10.5, color: C.muted }); }
  w.y -= 16;
  // Its data, two per row: label above, value below.
  const colW = (R - L - 20) / 2;
  for (let n = 0; n < model.meta.length; n += 2) {
    const pair = model.meta.slice(n, n + 2).map(([label, value]) => ({ label, lines: w.wrap(value, f.regular, 10, colW) }));
    const h = 11 + Math.max(...pair.map((p) => p.lines.length)) * 13 + 6;
    w.ensure(h);
    pair.forEach((p, i) => {
      const x = L + i * (colW + 20);
      w.text(p.label, x, w.y - 8, { size: 7.5, color: C.muted });
      p.lines.forEach((l, k) => w.text(l, x, w.y - 21 - k * 13, { size: 10 }));
    });
    w.y -= h;
  }
  w.y -= 8;
}

function sectionTitle(w, s, { size = 12, color = C.brand, keep = 60 } = {}) {
  const lines = w.wrap(s, w.f.bold, size, R - L);
  w.ensure(lines.length * size * 1.3 + keep);
  for (const l of lines) { w.text(l, L, w.y - size, { f: w.f.bold, size, color }); w.y -= size * 1.3; }
  w.y -= 4;
}

// Label / value lines right-aligned under a table (totals).
function totalsBlock(w, rows) {
  const x0 = L + (R - L) * 0.45;
  w.ensure(rows.length * 21 + 6);
  for (const [label, value, strong, muted] of rows) {
    if (strong) w.rect(x0, w.y - 22, R - x0, 22, C.soft);
    const fnt = strong ? w.f.bold : w.f.regular, size = strong ? 11 : 9.5, color = muted ? C.muted : C.ink;
    w.text(label, x0 + 8, w.y - 15, { f: fnt, size, color });
    w.text(value, R - 8, w.y - 15, { f: fnt, size, color, align: 'right' });
    w.y -= 22;
    if (!strong) w.hline(w.y, C.line, x0, R);
  }
  w.y -= 6;
}

// A chapter heading on a soft band, with its figure on the right.
function chapterHead(w, title, right, { keep }) {
  const lines = w.wrap(title, w.f.bold, 10, R - L - 130);
  const h = lines.length * 13 + 9;
  w.ensure(h + keep);
  w.rect(L, w.y - h, R - L, h, C.soft);
  lines.forEach((l, i) => w.text(l, L + PAD, w.y - 14 - i * 13, { f: w.f.bold, size: 10 }));
  if (right) w.text(right, R - PAD, w.y - 14, { f: w.f.bold, size: 10, align: 'right' });
  w.y -= h;
}

// The open table's chapter and column titles again on each new page.
function withHeader(w, cols, title, fn) {
  w.headH = 19 + 22;
  w.onPage = () => {
    w.text(title, L, w.y - 10, { f: w.f.bold, size: 9, color: C.muted });
    w.y -= 22;
    w.head(cols);
  };
  try { fn(); } finally { w.onPage = null; w.headH = 0; }
}

function drawPresupuesto(w, m, { t }) {
  const { f } = w;
  if (m.summary) {
    sectionTitle(w, t.summary);
    const cols = Writer.columns([{ label: t.hConcept }, { label: t.hApproved, w: 90 }, { label: t.hAmount, w: 100, align: 'right' }]);
    w.ensure(19 + 30);
    w.head(cols);
    for (const [concept, date, amount] of m.summary.rows) w.row(cols, [{ parts: [{ s: concept }] }, { parts: [{ s: date }] }, { parts: [{ s: amount }] }]);
    w.y -= 6;
    totalsBlock(w, m.summary.totals);
    w.y -= 10;
  }
  w.ensure(30);
  w.text(t.amountsNote, L, w.y - 9, { size: 8.5, color: C.muted });
  w.y -= 22;
  const cols = Writer.columns([{ label: t.hCode, w: 54 }, { label: t.hItem }, { label: t.hUnit, w: 36 }, { label: t.hQty, w: 58, align: 'right' },
    { label: t.hPrice, w: 66, align: 'right' }, { label: t.hAmount, w: 74, align: 'right' }]);
  for (const s of m.sections) {
    if (s.heading) {
      sectionTitle(w, s.heading, { keep: 90 });
      w.text(s.subheading, L, w.y - 6, { size: 9, color: C.muted });
      w.y -= 18;
    }
    s.chapters.forEach((c, ci) => {
      const title = `${ci + 1}. ${c.name}`;
      chapterHead(w, title, c.base, { keep: 19 + 34 });
      w.head(cols);
      withHeader(w, cols, `${title} (${t.cont})`, () => {
        for (const i of c.items) {
          const color = i.out ? C.muted : C.ink;
          const parts = [{ s: i.name, f: f.bold, size: 9, color }];
          if (i.tag) parts.push({ s: i.tag, f: f.italic, size: 7.5, color: i.out ? C.warn : C.muted });
          if (i.description) parts.push({ s: i.description, size: 8, color: C.muted });
          w.row(cols, [{ parts: [{ s: i.code, size: 8, color: C.muted }] }, { parts }, { parts: [{ s: i.unit, size: 8.5, color }] },
            { parts: [{ s: i.quantity, size: 8.5, color }] }, { parts: [{ s: i.price, size: 8.5, color }] }, { parts: [{ s: i.amount, f: f.bold, size: 8.5, color }] }]);
        }
      });
      w.y -= 10;
    });
    if (s.footer) {
      w.ensure(24);
      w.text(s.footer[0], R - 110, w.y - 10, { f: f.bold, size: 9.5, align: 'right' });
      w.text(s.footer[1], R - PAD, w.y - 10, { f: f.bold, size: 9.5, align: 'right' });
      w.y -= 30;
    }
  }
  totalsBlock(w, m.totals);
  if (m.pending?.length) {
    w.y -= 10;
    sectionTitle(w, t.pendingTitle, { size: 11, keep: 30 });
    w.paragraph(t.pendingNote, { size: 8.5, color: C.muted });
    for (const p of m.pending) w.paragraph(`· ${p}`, { size: 9 });
  }
  if (m.notes.length) {
    w.y -= 10;
    sectionTitle(w, t.notesTitle, { size: 11, keep: 30 });
    for (const n of m.notes) {
      if (n.heading) { w.y -= 2; w.paragraph(n.heading, { f: f.bold, size: 9 }); }
      w.paragraph(n.text, { size: 9 });
      w.y -= 4;
    }
  }
}
function drawAvance(w, m, { t, fx }) {
  const { f } = w;
  // The obra at a glance: overall %, what it means in money, what it includes.
  const exts = m.overall.exts ? w.wrap(m.overall.exts, f.regular, 8.5, R - L - 24) : [];
  const boxH = 64 + exts.length * 11;
  w.ensure(boxH + 10);
  w.rect(L, w.y - boxH, R - L, boxH, C.soft);
  w.text(t.overall, L + 12, w.y - 22, { f: f.bold, size: 12 });
  w.text(fx.pct(m.overall.pct), R - 12, w.y - 26, { f: f.bold, size: 22, color: Number(m.overall.pct) >= 100 ? C.done : C.brand, align: 'right' });
  w.bar(L + 12, w.y - 40, R - L - 24, 10, m.overall.pct);
  w.text(m.overall.text, L + 12, w.y - 55, { size: 9 });
  exts.forEach((l, i) => w.text(l, L + 12, w.y - 69 - i * 11, { size: 8.5, color: C.muted }));
  w.y -= boxH + 20;

  const pctCell = (pct, barW) => ({
    h: 11,
    draw: (x0, x1, top) => {
      w.text(fx.pct(pct), x1, top - 8.5, { f: f.bold, size: 8.5, color: Number(pct) >= 100 ? C.done : C.ink, align: 'right' });
      w.bar(x0, top - 8, Math.min(barW, x1 - x0 - 42), 6, pct);
    },
  });

  // Every chapter's progress on the first pages.
  sectionTitle(w, t.byChapter);
  const sumCols = Writer.columns([{ label: t.hChapter }, { label: t.hProgress, w: 190 }]);
  w.ensure(19 + 30);
  w.head(sumCols);
  withHeader(w, sumCols, `${t.byChapter} (${t.cont})`, () => {
    for (const c of m.chapters) {
      const parts = [{ s: c.name, f: f.bold, size: 9 }];
      if (c.ext) parts.push({ s: c.ext, size: 7.5, color: C.muted });
      w.row(sumCols, [{ parts }, pctCell(c.pct, 130)]);
    }
  });
  w.y -= 18;

  // Line by line.
  sectionTitle(w, t.detail, { keep: 90 });
  const cols = Writer.columns([{ label: t.hCode, w: 54 }, { label: t.hItem }, { label: t.hBudgeted, w: 78, align: 'right' },
    { label: t.hExecuted, w: 78, align: 'right' }, { label: t.hProgress, w: 112 }]);
  m.chapters.forEach((c) => {
    const title = c.ext ? `${c.name} · ${c.ext}` : c.name;
    chapterHead(w, title, fx.pct(c.pct), { keep: 19 + 34 });
    w.head(cols);
    withHeader(w, cols, `${title} (${t.cont})`, () => {
      for (const i of c.items) {
        const parts = [{ s: i.name, f: f.bold, size: 9 }];
        for (const n of i.notes) parts.push({ s: n, size: 7.5, color: n === t.excess ? C.warn : C.muted });
        w.row(cols, [{ parts: [{ s: i.code, size: 8, color: C.muted }] }, { parts }, { parts: [{ s: i.budgeted, size: 8.5 }] },
          { parts: [{ s: i.executed, size: 8.5 }] }, pctCell(i.pct, 60)]);
      }
    });
    w.y -= 10;
  });

  w.y -= 6;
  sectionTitle(w, t.howTitle, { size: 10, color: C.ink, keep: 40 });
  w.paragraph(t.how, { size: 8.5, color: C.muted });
}
