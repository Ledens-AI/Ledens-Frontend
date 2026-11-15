import { appUrl } from '../invitaciones/service.js';
import { translateDoc } from './traducciones.js';
import { translatorFromEnv } from './translate.js';
import { COUNTED, isUuid } from './service.js';

// Aviso al cliente cuando el equipo actualiza el avance de su obra
// («Actualizar avance», PresupuestosService.declare). Goes through the same
// notification queue and Logic App as invitations (NOTIFICATIONS.md), with
// `event_type = 'obra_avance'` and its own `to`.
//
// One email summarises a working session, not each click: the first
// declaration queues one message per client of the obra, due
// AVISO_AVANCE_MINUTOS later (default 30); declarations made before it is
// claimed add to that same message. The row only stores ids
// (`{ obra_id, user_id, desde, lang }`): the summary is built when the mail
// sender claims it, from presupuesto_produccion rows `desde`..`hasta`, and
// `hasta` is fixed then, so a retry after an Outlook failure sends the same
// summary and later declarations start a new message.
//
// Recipients: the titular client and the clients invited to the obra
// (obra_clientes) — whoever sees its progress in the client area — once they
// have got in (registered_at) and unless their access is held (migration 024).
// Checked again when the message is built.
export const delayMinutes = (env = process.env) => {
  const n = Number(env.AVISO_AVANCE_MINUTOS);
  return env.AVISO_AVANCE_MINUTOS !== undefined && env.AVISO_AVANCE_MINUTOS !== '' && Number.isFinite(n) && n >= 0 && n <= 1440 ? Math.round(n) : 30;
};

const recipients = (extra = '') => `
  SELECT u.id, u.email, nullif(u.name, u.email) name,
         coalesce((SELECT i.lang FROM invitaciones i WHERE i.presupuesto_id=$1 AND i.user_id=u.id ORDER BY i.created_at DESC LIMIT 1), 'es') lang
    FROM users u
   WHERE u.role='client' AND u.registered_at IS NOT NULL AND NOT (u.access_held AND NOT u.email_verified)
     AND (u.id=(SELECT client_id FROM presupuestos WHERE id=$1)
          OR EXISTS (SELECT 1 FROM obra_clientes oc WHERE oc.presupuesto_id=$1 AND oc.user_id=u.id)) ${extra}`;

// Called by declare(), inside its transaction, with the root presupuesto locked
// and the id of the first production row it recorded.
export async function queueProgressAlerts(db, obraId, fromId) {
  for (const r of (await db.query(recipients(), [obraId])).rows) {
    const open = await db.query(`SELECT 1 FROM ledens.transaction_alerts WHERE event_type='obra_avance' AND delivered_at IS NULL
      AND payload->>'obra_id'=$1 AND payload->>'user_id'=$2 AND NOT payload ? 'hasta' FOR UPDATE`, [obraId, r.id]);
    if (open.rows.length) continue; // the message already waiting will include it
    await db.query(`INSERT INTO ledens.transaction_alerts (event_key, event_type, status, payload, next_attempt_at)
      VALUES ($1, 'obra_avance', 'obra_avance', $2, now() + make_interval(mins => $3::int)) ON CONFLICT (event_key) DO NOTHING`,
    [`obra_avance:${obraId}:${r.id}:${fromId}`, JSON.stringify({ obra_id: obraId, user_id: r.id, desde: String(fromId), lang: r.lang }), delayMinutes()]);
  }
}

const num = (v, lang) => Number(v).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', { maximumFractionDigits: 2 });
const pctOf = (ex, qty) => (Number(qty) > 0 ? Math.round(Math.min(Number(ex), Number(qty)) / Number(qty) * 1000) / 10 : 0);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_LINES = 25;

const MAIL = {
  es: {
    subject: (t) => `Ledens · Avance de tu obra «${t}»`,
    hello: (n) => `Hola${n ? ` ${n}` : ''}:`,
    body: (by, t) => `${by ? `${by}, de Ledens,` : 'El equipo de Ledens'} ha actualizado el avance de tu obra «${t}».`,
    total: 'Ejecución de la obra',
    head: ['Partida', 'Antes', 'Ahora'],
    of: (ex, qty, unit) => `${ex} de ${qty} ${unit}`,
    noChange: 'Sin cambio de cantidad',
    more: (n) => `… y ${n} partida${n === 1 ? '' : 's'} más.`,
    cta: 'Ver el avance de mi obra',
    why: 'Recibes este aviso porque sigues esta obra en el área de cliente de Ledens.',
  },
  en: {
    subject: (t) => `Ledens · Progress on “${t}”`,
    hello: (n) => `Hello${n ? ` ${n}` : ''},`,
    body: (by, t) => `${by ? `${by} from Ledens` : 'The Ledens team'} has updated the progress of your project “${t}”.`,
    total: 'Project completion',
    head: ['Item', 'Before', 'Now'],
    of: (ex, qty, unit) => `${ex} of ${qty} ${unit}`,
    noChange: 'No change in quantity',
    more: (n) => `… and ${n} more item${n === 1 ? '' : 's'}.`,
    cta: 'See my project’s progress',
    why: 'You get this notice because you follow this project in the Ledens client area.',
  },
};

export function formatProgress({ lang, name, obra, by, before, after, lines }) {
  const m = MAIL[lang] || MAIL.es;
  const td = 'padding:6px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top';
  const cell = (l, ex) => `${esc(m.of(num(ex, lang), num(l.quantity, lang), l.unit))}<br><span style="color:#666">${esc(num(pctOf(ex, l.quantity), lang))} %</span>`;
  const rows = lines.slice(0, MAX_LINES).map((l) => `<tr>
<td style="${td}">${esc(l.label)}${l.note ? `<br><em style="color:#555">${esc(l.note)}</em>` : ''}</td>
<td style="${td};white-space:nowrap;color:#666">${cell(l, l.before)}</td>
<td style="${td};white-space:nowrap">${Number(l.before) === Number(l.after) ? `<span style="color:#666">${esc(m.noChange)}</span>` : cell(l, l.after)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">
<p>${esc(m.hello(name))}</p>
<p>${esc(m.body(by, obra))}</p>
<p style="font-size:16px"><strong>${esc(m.total)}:</strong> ${esc(num(before, lang))} % → <strong>${esc(num(after, lang))} %</strong></p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>${m.head.map((h) => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #3E4D85">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
${lines.length > MAX_LINES ? `<p style="color:#666;font-size:13px">${esc(m.more(lines.length - MAX_LINES))}</p>` : ''}
<p style="margin:24px 0"><a href="${esc(`${appUrl()}/plataforma`)}" style="background:#3E4D85;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(m.cta)}</a></p>
<p style="color:#666;font-size:13px">${esc(m.why)}</p>
</div>`;
  return { subject: m.subject(obra).replace(/[\r\n]/g, ' ').slice(0, 250), html };
}

// The email, built when the mail sender claims the queued row; null when there
// is nothing to tell any more or the person no longer follows the obra.
export async function progressMessage(pool, alert, { translator = translatorFromEnv() } = {}) {
  const { obra_id: obraId, user_id: userId, desde, lang } = alert.payload || {};
  if (!isUuid(obraId) || !isUuid(userId) || !/^\d{1,18}$/.test(String(desde))) return null;
  const c = await pool.connect();
  let data;
  try {
    await c.query('BEGIN');
    // The same lock declare() takes, so `hasta` never splits a declaration in two.
    const p = (await c.query('SELECT id, parent_id FROM presupuestos WHERE id=$1 FOR UPDATE', [obraId])).rows[0];
    const root = p?.parent_id
      ? (await c.query('SELECT id, title FROM presupuestos WHERE id=$1 FOR UPDATE', [p.parent_id])).rows[0] // joined to another obra since
      : p && (await c.query('SELECT id, title FROM presupuestos WHERE id=$1', [p.id])).rows[0];
    if (!root) { await c.query('COMMIT'); return null; }
    const lineSql = `FROM presupuestos o JOIN presupuesto_versiones v ON v.presupuesto_id=o.id AND v.status='approved'
      JOIN presupuesto_partidas l ON l.version_id=v.id AND ${COUNTED} JOIN presupuesto_capitulos ch ON ch.id=l.capitulo_id
      WHERE coalesce(o.parent_id, o.id)=$1`;
    let hasta = alert.payload.hasta;
    if (!/^\d{1,18}$/.test(String(hasta ?? ''))) {
      hasta = String((await c.query(`SELECT coalesce(max(pr.id), 0)::text m FROM presupuesto_produccion pr WHERE pr.partida_id IN (SELECT l.id ${lineSql})`, [root.id])).rows[0].m);
      await c.query("UPDATE ledens.transaction_alerts SET payload = payload || jsonb_build_object('hasta', $2::text) WHERE id=$1", [alert.id, hasta]);
    }
    const to = (await c.query(recipients('AND u.id=$2'), [root.id, userId])).rows[0];
    const lines = (await c.query(`
      SELECT l.id, l.name, l.unit, l.quantity::text, l.unit_price::text,
             coalesce((SELECT pr.executed FROM presupuesto_produccion pr WHERE pr.partida_id=l.id AND pr.id<$2 ORDER BY pr.id DESC LIMIT 1), 0)::text before,
             coalesce((SELECT pr.executed FROM presupuesto_produccion pr WHERE pr.partida_id=l.id AND pr.id<=$3 ORDER BY pr.id DESC LIMIT 1), 0)::text after,
             (SELECT pr.note FROM presupuesto_produccion pr WHERE pr.partida_id=l.id AND pr.id BETWEEN $2 AND $3 AND pr.note IS NOT NULL ORDER BY pr.id DESC LIMIT 1) note,
             EXISTS (SELECT 1 FROM presupuesto_produccion pr WHERE pr.partida_id=l.id AND pr.id BETWEEN $2 AND $3) touched
        ${lineSql}
       ORDER BY o.parent_id NULLS FIRST, v.decided_at, ch.position, l.position`, [root.id, desde, hasta])).rows;
    const by = (await c.query(`SELECT string_agg(DISTINCT u.name, ', ') names FROM presupuesto_produccion pr JOIN users u ON u.id=pr.declared_by
      WHERE pr.id BETWEEN $1 AND $2 AND pr.partida_id IN (SELECT l.id ${lineSql.replace('$1', '$3')})`, [desde, hasta, root.id])).rows[0]?.names;
    await c.query('COMMIT');
    data = { root, to, lines, by };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  const { root, to, lines, by } = data;
  if (!to) return null;
  const changed = lines.filter((l) => l.touched && (Number(l.before) !== Number(l.after) || l.note));
  if (!changed.length) return null;
  // % de ejecución of the whole obra, as the client area shows it: each line capped at its quantity.
  const share = (key) => {
    let base = 0, done = 0;
    for (const l of lines) { const price = Number(l.unit_price), qty = Number(l.quantity); base += qty * price; done += Math.min(Number(l[key]), qty) * price; }
    return base > 0 ? Math.round(done / base * 1000) / 10 : 0;
  };
  const language = lang === 'en' ? 'en' : 'es';
  const items = changed.map((l) => ({ ...l, lastDeclared: l.note ? { note: l.note } : null }));
  const doc = { id: root.id, obra: { chapters: [{ name: root.title, items }] } };
  if (language === 'en') await translateDoc(pool, translator, doc, 'en');
  const en = language === 'en';
  return {
    to: to.email,
    ...formatProgress({
      lang: language, name: to.name, by,
      obra: (en && doc.obra.chapters[0].nameEn) || root.title,
      before: share('before'), after: share('after'),
      lines: items.map((l) => ({ ...l, label: (en && l.nameEn) || l.name, note: l.note ? ((en && l.lastDeclared.noteEn) || l.note) : null })),
    }),
  };
}
