import { useMemo } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { eur as eurEs, num as numEs, fecha as fechaEs, fechaHora as fechaHoraEs } from '../finanzas/format.js';
import { PHASE as PHASE_ES, VSTATUS as VSTATUS_ES, KIND as KIND_ES, pctS } from './api.js';

/* Texts and formats of the client-facing presupuesto / obra screens. Spanish
 * keeps the finance formatters it always used; English uses en-GB. Screens
 * only the team sees (editor, scheduling, declaring production, sending)
 * stay in Spanish. */
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EUR_EN = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
const NUM_EN = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const blank = (v) => v === null || v === undefined || v === '';

const EN_FMT = {
  eur: (v) => (blank(v) ? '—' : EUR_EN.format(Number(v))),
  num: (v) => (blank(v) ? '—' : NUM_EN.format(Number(v))),
  // "YYYY-MM-DD" is read as written, never shifted by timezone (same as fecha()).
  fecha: (v) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${Number(m[3])} ${MON_EN[Number(m[2]) - 1]} ${m[1]}` : '—';
  },
  fechaHora: (v) => {
    if (!v) return '—';
    const d = new Date(v);
    return `${d.getDate()} ${MON_EN[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  pct: (n) => `${n}%`,
};
const ES_FMT = { eur: eurEs, num: numEs, fecha: fechaEs, fechaHora: fechaHoraEs, pct: pctS };

const LABELS_EN = {
  phase: { borrador: 'Draft', pendiente: 'Awaiting decision', cambios: 'Changes requested', rechazado: 'Rejected', aprobado: 'Approved', en_curso: 'Works in progress' },
  vstatus: { draft: 'Draft', sent: 'Sent', changes_requested: 'Changes requested', superseded: 'Superseded', approved: 'Approved', rejected: 'Rejected' },
  kind: { confirmada: 'Confirmed', condicionada: 'Conditional', decision: 'Awaiting decision', opcion: 'Option' },
};
const relabel = (base, labels) => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v, label: labels[k] || v.label }]));

const TXT = {
  es: {
    loading: 'Cargando…', loadingDoc: 'Cargando presupuesto…', back: 'Volver', retry: 'Reintentar',
    hello: (n) => `Hola${n ? `, ${n}` : ''}`, homeText: 'Tus presupuestos y obras con Ledens.',
    kWaiting: 'Esperan tu decisión', kApproved: 'Presupuestos aprobados', kObras: 'Obras en curso',
    secPending: 'Pendientes de tu decisión', secPendingOther: 'Pendientes de decisión del titular', secPendingOtherHint: 'Te han invitado a seguir esta obra: decide sobre el presupuesto el titular.', secReview: 'En revisión por el equipo', secReviewHint: 'Has pedido cambios: te enviaremos una versión nueva.',
    secApproved: 'Presupuestos aprobados', secRejected: 'Rechazados',
    noBudgets: 'Todavía no tienes presupuestos', noBudgetsHome: 'Cuando te enviemos un presupuesto lo verás aquí para revisarlo y decidir.', noBudgetsList: 'Cuando te enviemos un presupuesto lo verás aquí.',
    presuTitle: 'Presupuestos', presuText: 'Cada presupuesto que te enviamos: apruébalo, pide cambios o recházalo. Las versiones anteriores siguen disponibles.',
    obrasTitle: 'Obra en curso', obrasText: 'Avance de tus obras: cuánto se ha ejecutado y cuánto del presupuesto se ha consumido, partida a partida.',
    noObras: 'Aún no tienes obras en curso', noObrasText: 'Cuando apruebes un presupuesto y fijemos la fecha de inicio, verás aquí su avance.',
    version: 'versión', extensionOf: (r) => `ampliación de ${r}`, sentOn: (d) => `enviado el ${d}`, vatIncl: 'IVA incluido',
    since: (d) => `Desde el ${d}`, startsOn: (d) => `Empieza el ${d}`, jefe: (n) => `Jefe de obra: ${n}`,
    execution: 'Ejecución', consumed: 'Presupuesto consumido', ofExVat: (a, b) => `${a} de ${b} sin IVA`,
    // Detalle
    client: (n) => `Cliente: ${n}`, jefeOf: (n) => `Jefe de obra: ${n || 'sin asignar'}`,
    extensionNoteA: 'Ampliación de la obra ', extensionNoteB: '. Se aprueba por separado y, al aprobarla, suma al presupuesto de la obra.',
    tabBudget: 'Presupuesto', tabObra: 'Obra en curso', tabChat: (n) => `Conversación${n ? ` (${n})` : ''}`,
    decideTitle: 'Este presupuesto espera tu decisión',
    decideOptions: 'Marca en la tabla las opciones que quieras incluir y elige qué hacer.',
    decideNoOptions: 'Revísalo y elige qué hacer. Si algo no te encaja, pide cambios y te enviaremos una versión nueva.',
    reject: 'Rechazar', askChanges: 'Pedir cambios', approve: 'Aprobar',
    changesPending: 'Has pedido cambios. El equipo está preparando una versión nueva; la verás aquí cuando te la envíe.',
    base: 'Base imponible', vat: (r) => `IVA ${r.replace('.', ',')} %`, total: 'Total con IVA',
    optNotChosen: 'Opciones no elegidas', optExVat: 'Opciones (sin IVA)', optHint: 'Solo suman si se eligen al aprobar',
    versionLabel: 'Versión',
    hCode: 'Código', hItem: 'Partida', hUnit: 'Unidad', hQty: 'Cantidad', hPrice: 'Precio', hAmount: 'Importe',
    include: (n) => `Incluir ${n}`, chosen: 'elegida',
    noItems: 'Sin partidas', noItemsText: 'Edita el borrador para añadir capítulos y partidas.',
    notes: 'Condiciones y exclusiones', extensions: 'Ampliaciones',
    askedChanges: ' · pidió cambios', rejected: ' · rechazó',
    noMessages: 'Sin mensajes', noMessagesText: 'Las preguntas y los cambios pedidos sobre este presupuesto aparecerán aquí.',
    writeMessage: 'Escribe un mensaje', send: 'Enviar', messageSent: 'Mensaje enviado',
    approveTitle: 'Aprobar presupuesto', cancel: 'Cancelar', approvedToast: 'Presupuesto aprobado',
    approveIntro: (n, r) => `Apruebas la versión ${n} de ${r}.`, chosenOptions: 'Opciones elegidas', none: 'Ninguna',
    approveNote: 'Pasará a «Presupuestos aprobados». Cuando fijemos la fecha de inicio, lo verás como obra en curso.',
    changesTitle: 'Pedir cambios', rejectTitle: 'Rechazar presupuesto',
    changesSent: 'Cambios enviados al equipo', rejectedToast: 'Presupuesto rechazado', sendComments: 'Enviar comentarios',
    changesIntro: 'Cuéntanos qué quieres cambiar. El equipo lo revisará y te enviará una versión nueva.',
    rejectIntro: 'El presupuesto quedará cerrado. Si quieres, dinos el motivo.',
    comments: 'Comentarios', reasonOpt: 'Motivo (opcional)',
    // Obra tab
    budgetDocs: 'Documentos del presupuesto',
    noStart: 'Obra pendiente de fecha de inicio', noStartText: 'El presupuesto está aprobado. Cuando el equipo fije la fecha de inicio, aquí verás el avance.',
    executed: (a) => `${a} ejecutado`, current: 'Presupuesto vigente',
    currentHint: (b, v, amp) => `${b} + ${v} de IVA${amp ? ' · incluye ampliaciones aprobadas' : ''}`,
    dates: 'Fechas', plannedEnd: (d) => `Fin previsto: ${d}`, noEnd: 'Sin fecha de fin prevista',
    obraExplain: 'Ejecución: lo hecho de cada partida hasta su cantidad presupuestada. Consumido: cantidad ejecutada × precio unitario; si una partida supera lo presupuestado, el exceso solo cuenta en el consumido.',
    extension: (r) => `Ampliación ${r}`, chExecution: (p) => `Ejecución ${p}`, chConsumed: (p, a, b) => `Consumido ${p} · ${a} de ${b}`, chConsumedOf: (a, b) => `Consumido · ${a} de ${b}`,
    hBudgeted: 'Presupuestado', hExecuted: 'Ejecutado', hProgress: 'Avance', hConsumed: 'Consumido',
    declaredBy: (who, at) => `Declarado por ${who} · ${at}`, excess: 'supera lo presupuestado', imported: 'Avance importado',
    tabFiles: 'Fotos y documentos',
    // Fotos y documentos (the client's side; uploading is team-only)
    filesLoading: 'Cargando fotos y documentos…', photos: 'Fotos', documents: 'Documentos',
    noPhotos: 'Aún no hay fotos', noPhotosTeam: 'Sube las fotos del avance de la obra.', noPhotosClient: 'Aquí verás las fotos del avance de tu obra.',
    noDocs: 'Aún no hay documentos', noDocsTeam: 'Sube actas, planos, certificados o cualquier PDF de la obra.', noDocsClient: 'Aquí podrás descargar los documentos de tu obra.',
    docBy: (n) => `subido por ${n}`, photoBy: (n) => `subida por ${n}`, download: 'Descargar',
    heic: 'Tu navegador no puede mostrar esta foto (formato HEIC).',
    prevPhoto: 'Foto anterior', nextPhoto: 'Foto siguiente', closeFull: 'Cerrar pantalla completa', openFull: 'Ver a pantalla completa',
    carousel: 'carrusel', carouselLabel: 'Fotos de la obra', photoN: (k, n) => `Foto ${k}: ${n}`, fullLabel: 'Fotos a pantalla completa',
  },
  en: {
    loading: 'Loading…', loadingDoc: 'Loading quote…', back: 'Back', retry: 'Retry',
    hello: (n) => `Hello${n ? `, ${n}` : ''}`, homeText: 'Your quotes and works with Ledens.',
    kWaiting: 'Awaiting your decision', kApproved: 'Approved quotes', kObras: 'Works in progress',
    secPending: 'Awaiting your decision', secPendingOther: 'Awaiting the account holder’s decision', secPendingOtherHint: 'You were invited to follow this project: the account holder decides on the quote.', secReview: 'Being reviewed by the team', secReviewHint: 'You asked for changes: we’ll send you a new version.',
    secApproved: 'Approved quotes', secRejected: 'Rejected',
    noBudgets: 'You don’t have any quotes yet', noBudgetsHome: 'When we send you a quote you’ll see it here to review it and decide.', noBudgetsList: 'When we send you a quote you’ll see it here.',
    presuTitle: 'Quotes', presuText: 'Every quote we send you: approve it, ask for changes or reject it. Previous versions remain available.',
    obrasTitle: 'Works in progress', obrasText: 'Progress of your works: how much has been carried out and how much of the budget has been used, item by item.',
    noObras: 'You don’t have any works in progress yet', noObrasText: 'When you approve a quote and we set the start date, you’ll see its progress here.',
    version: 'version', extensionOf: (r) => `extension of ${r}`, sentOn: (d) => `sent on ${d}`, vatIncl: 'VAT included',
    since: (d) => `Since ${d}`, startsOn: (d) => `Starts on ${d}`, jefe: (n) => `Site manager: ${n}`,
    execution: 'Progress', consumed: 'Budget used', ofExVat: (a, b) => `${a} of ${b} excl. VAT`,
    client: (n) => `Client: ${n}`, jefeOf: (n) => `Site manager: ${n || 'not assigned'}`,
    extensionNoteA: 'Extension of the works ', extensionNoteB: '. It is approved separately and, once approved, adds to the works budget.',
    tabBudget: 'Quote', tabObra: 'Works in progress', tabChat: (n) => `Conversation${n ? ` (${n})` : ''}`,
    decideTitle: 'This quote is waiting for your decision',
    decideOptions: 'Tick the options you want to include in the table and choose what to do.',
    decideNoOptions: 'Review it and choose what to do. If something doesn’t suit you, ask for changes and we’ll send you a new version.',
    reject: 'Reject', askChanges: 'Ask for changes', approve: 'Approve',
    changesPending: 'You asked for changes. The team is preparing a new version; you’ll see it here when they send it.',
    base: 'Taxable base', vat: (r) => `VAT ${Number(r)}%`, total: 'Total incl. VAT',
    optNotChosen: 'Options not chosen', optExVat: 'Options (excl. VAT)', optHint: 'Only added if chosen when approving',
    versionLabel: 'Version',
    hCode: 'Code', hItem: 'Item', hUnit: 'Unit', hQty: 'Quantity', hPrice: 'Price', hAmount: 'Amount',
    include: (n) => `Include ${n}`, chosen: 'chosen',
    noItems: 'No items', noItemsText: 'Edit the draft to add chapters and items.',
    notes: 'Terms and exclusions', extensions: 'Extensions',
    askedChanges: ' · asked for changes', rejected: ' · rejected',
    noMessages: 'No messages', noMessagesText: 'Questions and requested changes about this quote will appear here.',
    writeMessage: 'Write a message', send: 'Send', messageSent: 'Message sent',
    approveTitle: 'Approve quote', cancel: 'Cancel', approvedToast: 'Quote approved',
    approveIntro: (n, r) => `You are approving version ${n} of ${r}.`, chosenOptions: 'Chosen options', none: 'None',
    approveNote: 'It will move to “Approved quotes”. When we set the start date, you’ll see it as works in progress.',
    changesTitle: 'Ask for changes', rejectTitle: 'Reject quote',
    changesSent: 'Changes sent to the team', rejectedToast: 'Quote rejected', sendComments: 'Send comments',
    changesIntro: 'Tell us what you’d like to change. The team will review it and send you a new version.',
    rejectIntro: 'The quote will be closed. If you like, tell us why.',
    comments: 'Comments', reasonOpt: 'Reason (optional)',
    budgetDocs: 'Quote documents',
    noStart: 'Works awaiting a start date', noStartText: 'The quote is approved. When the team sets the start date, you’ll see the progress here.',
    executed: (a) => `${a} carried out`, current: 'Current budget',
    currentHint: (b, v, amp) => `${b} + ${v} VAT${amp ? ' · includes approved extensions' : ''}`,
    dates: 'Dates', plannedEnd: (d) => `Planned end: ${d}`, noEnd: 'No planned end date',
    obraExplain: 'Progress: what has been done on each item, up to its budgeted quantity. Used: quantity carried out × unit price; if an item exceeds its budget, the excess only counts in the amount used.',
    extension: (r) => `Extension ${r}`, chExecution: (p) => `Progress ${p}`, chConsumed: (p, a, b) => `Used ${p} · ${a} of ${b}`, chConsumedOf: (a, b) => `Used · ${a} of ${b}`,
    hBudgeted: 'Budgeted', hExecuted: 'Carried out', hProgress: 'Progress', hConsumed: 'Used',
    declaredBy: (who, at) => `Reported by ${who} · ${at}`, excess: 'exceeds the budget', imported: 'Imported progress',
    tabFiles: 'Photos and documents',
    filesLoading: 'Loading photos and documents…', photos: 'Photos', documents: 'Documents',
    noPhotos: 'No photos yet', noPhotosTeam: 'Upload photos of the works’ progress.', noPhotosClient: 'You’ll see photos of your works’ progress here.',
    noDocs: 'No documents yet', noDocsTeam: 'Upload minutes, plans, certificates or any PDF of the works.', noDocsClient: 'You’ll be able to download your works’ documents here.',
    docBy: (n) => `uploaded by ${n}`, photoBy: (n) => `uploaded by ${n}`, download: 'Download',
    heic: 'Your browser can’t display this photo (HEIC format).',
    prevPhoto: 'Previous photo', nextPhoto: 'Next photo', closeFull: 'Close full screen', openFull: 'View full screen',
    carousel: 'carousel', carouselLabel: 'Photos of the works', photoN: (k, n) => `Photo ${k}: ${n}`, fullLabel: 'Full-screen photos',
  },
};

function build(lang) {
  if (lang === 'en') {
    return { lang, t: TXT.en, ...EN_FMT, PHASE: relabel(PHASE_ES, LABELS_EN.phase), VSTATUS: LABELS_EN.vstatus, KIND: relabel(KIND_ES, LABELS_EN.kind) };
  }
  return { lang, t: TXT.es, ...ES_FMT, PHASE: PHASE_ES, VSTATUS: VSTATUS_ES, KIND: KIND_ES };
}

export function useObrasI18n() {
  const { lang } = useI18n();
  return useMemo(() => build(lang), [lang]);
}
