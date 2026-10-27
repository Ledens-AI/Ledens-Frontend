import crypto from 'node:crypto';
import { audit } from '../db/audit.js';
import { hashToken } from '../auth/sessions.js';
import { hashPassword } from '../auth/passwords.js';
import { PresupuestosService, isUuid } from '../presupuestos/service.js';

// Invitaciones de cliente (migration 023). The jefe de obra assigned to an obra
// (or an admin) invites a client by email:
//  - no account yet → one is created, role client, no password, not verified;
//  - an account already → nothing about it changes (never its role or name).
// The client gets access to the obra at once, except when the account has a
// password nobody has proven (users.email_verified = false): that password may
// belong to someone who registered another person's email, so access waits for
// the link, exactly like a verified Google/Microsoft login reclaims such an
// account (src/auth/identities.js). The answer to whoever invites is the same
// in every case, so inviting can't be used to find out who has an account.
//
// The email goes through the transaction-alert queue (ledens.transaction_alerts,
// NOTIFICATIONS.md) with only the invitation id. The link's token is minted
// when the mail sender claims the message (invitationMessage below) and only
// its hash is stored: the token never sits in the database, and a resend or a
// revocation invalidates any earlier link.
export const TTL_DAYS = 7;
export const LIMITS = { hour: 20, day: 100 };

export class InvitacionError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new InvitacionError(status, message, code); };

export const isEmail = (v) => typeof v === 'string' && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 200;
// One message for every link that can't be used (unknown, used, revoked or
// expired): the page asks for a new one either way.
const invalidLink = () => fail(410, 'El enlace de invitación no es válido o ha caducado', 'invitacion_no_valida');

export function status(i) {
  if (i.revoked_at) return 'revocada';
  if (i.accepted_at) return 'aceptada';
  if (new Date(i.expires_at) <= new Date()) return 'caducada';
  return 'pendiente';
}

async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Access to the obra for a client: the titular needs no row.
async function grantAccess(db, inv, user, addedBy) {
  const obra = (await db.query('SELECT client_id FROM presupuestos WHERE id=$1', [inv.presupuesto_id])).rows[0];
  if (obra.client_id !== user.id) {
    await db.query(`INSERT INTO obra_clientes (presupuesto_id, user_id, invitacion_id, added_by) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (presupuesto_id, user_id) DO NOTHING`, [inv.presupuesto_id, user.id, inv.id, addedBy || null]);
  }
  await db.query('UPDATE invitaciones SET access_granted=true WHERE id=$1', [inv.id]);
}
const accessNow = (u) => u.role === 'client' && !(u.password_hash && !u.email_verified);

/* What the team does: invite, list, resend, revoke. One service per request,
 * built with the effective user (after «Ver como»). */
export class InvitacionesService {
  constructor(pool, user) { this.pool = pool; this.user = user; this.presu = new PresupuestosService(pool, user); }
  actor() { return { id: this.user.id, name: this.user.name || this.user.email }; }

  // The obra (root presupuesto) if this user is its jefe or an admin.
  async obra(db, id, { lock } = {}) {
    if (this.user.role !== 'admin' && this.user.role !== 'jefe') fail(403, 'Solo el equipo de la obra puede invitar clientes');
    const p = await this.presu.load(db, id, { lock });
    if (!this.presu.isTeam(p)) fail(403, 'No tienes permiso para invitar clientes a esta obra');
    if (p.parent_id) fail(400, 'Invita al cliente desde la obra principal');
    return p;
  }

  async list(obraId) {
    const p = await this.obra(this.pool, obraId);
    const { rows } = await this.pool.query(`
      SELECT i.*, u.name invited_by_name FROM invitaciones i LEFT JOIN users u ON u.id=i.invited_by
       WHERE i.presupuesto_id=$1 ORDER BY i.created_at DESC`, [p.id]);
    const titular = (await this.pool.query('SELECT name, email FROM users WHERE id=$1', [p.client_id])).rows[0];
    return { obra: { id: p.id, ref: p.ref, title: p.title, titular }, ttlDays: TTL_DAYS, invitaciones: rows.map((i) => this.dto(i)) };
  }

  dto(i) {
    const s = status(i);
    return {
      id: i.id, email: i.email, name: i.name, lang: i.lang, status: s,
      createdAt: i.created_at, lastSentAt: i.last_sent_at, sentCount: i.sent_count, expiresAt: i.expires_at,
      acceptedAt: i.accepted_at, revokedAt: i.revoked_at, invitedBy: i.invited_by_name || null,
      can: { resend: s === 'pendiente' || s === 'caducada', revoke: s === 'pendiente' || s === 'caducada' },
    };
  }

  // Sending limit per person who invites (sends and resends together).
  async checkLimit(db) {
    const { rows: [n] } = await db.query(`SELECT count(*) FILTER (WHERE sent_at > now() - interval '1 hour')::int in_hour,
      count(*)::int in_day FROM invitacion_envios WHERE sent_by=$1 AND sent_at > now() - interval '1 day'`, [this.user.id]);
    if (n.in_hour >= LIMITS.hour || n.in_day >= LIMITS.day) fail(429, 'Has enviado demasiadas invitaciones. Inténtalo de nuevo más tarde.');
  }

  async queue(db, inv) {
    await db.query('INSERT INTO invitacion_envios (invitacion_id, sent_by) VALUES ($1,$2)', [inv.id, this.user.id]);
    await db.query(`INSERT INTO ledens.transaction_alerts (event_key, event_type, status, payload) VALUES ($1,'invitation','invitation',$2)
                    ON CONFLICT (event_key) DO NOTHING`, [`invitation:${inv.id}:${inv.sent_count}`, JSON.stringify({ invitacion_id: inv.id, sent_count: inv.sent_count })]);
  }

  async invite(obraId, body = {}) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isEmail(email)) fail(400, 'Email no válido');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
    if (name && name.length > 120) fail(400, 'El nombre es demasiado largo');
    const lang = body.lang === 'en' ? 'en' : 'es';
    return tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      await this.checkLimit(db);
      // Never anything but a client, whatever the request says.
      const created = (await db.query(`INSERT INTO users (email, name, password_hash, email_verified, role) VALUES ($1,$2,NULL,false,'client')
                                       ON CONFLICT DO NOTHING RETURNING id`, [email, name])).rows.length > 0;
      const user = (await db.query('SELECT id, email, role, password_hash, email_verified FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
      let inv = (await db.query(`UPDATE invitaciones SET email=$3, name=$4, lang=$5, token_hash=NULL, expires_at=now() + make_interval(days => $6),
                                  sent_count=sent_count+1, last_sent_at=now(), invited_by=$7
                                  WHERE presupuesto_id=$1 AND user_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING *`,
        [p.id, user.id, email, name, lang, TTL_DAYS, this.user.id])).rows[0];
      const resent = !!inv;
      if (!inv) {
        inv = (await db.query(`INSERT INTO invitaciones (presupuesto_id, user_id, email, name, lang, invited_by, expires_at)
                               VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7)) RETURNING *`,
          [p.id, user.id, email, name, lang, this.user.id, TTL_DAYS])).rows[0];
      }
      if (accessNow(user)) await grantAccess(db, inv, user, this.user.id);
      await this.queue(db, inv);
      // The audit trail may say what happened to the account: only admins read it.
      if (created) await audit({ actor: this.actor(), action: 'Cuenta de cliente creada por invitación', target: { id: user.id, label: email }, detail: `${p.ref} · ${p.title}` }, db);
      await audit({ actor: this.actor(), action: resent ? 'Invitación reenviada' : 'Invitación enviada', target: { id: user.id, label: email },
        detail: `${p.ref} · ${p.title}${accessNow(user) ? '' : user.role === 'client' ? ' · acceso al aceptar (cuenta sin verificar)' : ` · sin acceso: la cuenta es de rol ${user.role}`}` }, db);
      return { invitacion: this.dto((await db.query('SELECT i.*, u.name invited_by_name FROM invitaciones i LEFT JOIN users u ON u.id=i.invited_by WHERE i.id=$1', [inv.id])).rows[0]) };
    });
  }

  async openInvitation(db, p, invId) {
    if (!isUuid(invId)) fail(404, 'Invitación no encontrada');
    const inv = (await db.query('SELECT * FROM invitaciones WHERE id=$1 AND presupuesto_id=$2 FOR UPDATE', [invId, p.id])).rows[0];
    if (!inv) fail(404, 'Invitación no encontrada');
    if (inv.accepted_at || inv.revoked_at) fail(409, inv.accepted_at ? 'La invitación ya está aceptada' : 'La invitación está revocada');
    return inv;
  }

  async resend(obraId, invId) {
    return tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      await this.openInvitation(db, p, invId);
      await this.checkLimit(db);
      const inv = (await db.query(`UPDATE invitaciones SET token_hash=NULL, expires_at=now() + make_interval(days => $2), sent_count=sent_count+1, last_sent_at=now()
                                   WHERE id=$1 RETURNING *`, [invId, TTL_DAYS])).rows[0];
      await this.queue(db, inv);
      await audit({ actor: this.actor(), action: 'Invitación reenviada', target: { id: inv.user_id, label: inv.email }, detail: `${p.ref} · ${p.title}` }, db);
      return { invitacion: this.dto((await db.query('SELECT i.*, u.name invited_by_name FROM invitaciones i LEFT JOIN users u ON u.id=i.invited_by WHERE i.id=$1', [inv.id])).rows[0]) };
    });
  }

  // The link stops working and the access this invitation gave is withdrawn.
  async revoke(obraId, invId) {
    return tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      await this.openInvitation(db, p, invId);
      const inv = (await db.query('UPDATE invitaciones SET revoked_at=now(), revoked_by=$2, token_hash=NULL WHERE id=$1 RETURNING *', [invId, this.user.id])).rows[0];
      await db.query('DELETE FROM obra_clientes WHERE presupuesto_id=$1 AND invitacion_id=$2', [p.id, inv.id]);
      await audit({ actor: this.actor(), action: 'Invitación revocada', target: { id: inv.user_id, label: inv.email }, detail: `${p.ref} · ${p.title}` }, db);
      return { invitacion: this.dto((await db.query('SELECT i.*, u.name invited_by_name FROM invitaciones i LEFT JOIN users u ON u.id=i.invited_by WHERE i.id=$1', [inv.id])).rows[0]) };
    });
  }
}

/* What the client does with the link. No session is needed except for
 * acceptWithSession; the link alone proves the email is theirs. */
const OPEN = 'i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()';

async function byToken(db, token, { lock } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalidLink();
  const inv = (await db.query(`SELECT i.* FROM invitaciones i WHERE i.token_hash=$1 AND ${OPEN}${lock ? ' FOR UPDATE' : ''}`, [hashToken(token)])).rows[0];
  if (!inv) invalidLink();
  return inv;
}

export async function describe(pool, token, { providers = {} } = {}) {
  const inv = await byToken(pool, token);
  const { rows: [r] } = await pool.query(`
    SELECT u.name user_name, u.password_hash IS NOT NULL AND u.email_verified has_password, p.title, j.name invited_by
      FROM invitaciones i JOIN users u ON u.id=i.user_id JOIN presupuestos p ON p.id=i.presupuesto_id LEFT JOIN users j ON j.id=i.invited_by
     WHERE i.id=$1`, [inv.id]);
  return {
    email: inv.email, name: inv.name || r.user_name || null, lang: inv.lang, obra: r.title, invitedBy: r.invited_by || null,
    expiresAt: inv.expires_at, hasPassword: r.has_password, providers,
  };
}

// Marks the email verified and accepts every open invitation of the user (the
// email is now proven for all of them), giving access where it was waiting.
async function finish(db, inv, user, method) {
  await db.query('UPDATE users SET email_verified=true, updated_at=now() WHERE id=$1', [user.id]);
  const open = (await db.query(`SELECT i.*, p.ref, p.title FROM invitaciones i JOIN presupuestos p ON p.id=i.presupuesto_id
                                 WHERE i.user_id=$1 AND ${OPEN} FOR UPDATE OF i`, [user.id])).rows;
  for (const i of open) {
    if (!i.access_granted && user.role === 'client') await grantAccess(db, i, user, i.invited_by);
    await db.query('UPDATE invitaciones SET accepted_at=now(), token_hash=NULL WHERE id=$1', [i.id]);
    await audit({ actor: { id: user.id, name: user.name || user.email }, action: 'Invitación aceptada', target: { id: user.id, label: user.email },
      detail: `${i.ref} · ${i.title} · ${method}${i.id === inv.id ? '' : ' (otra invitación al mismo email)'}` }, db);
  }
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const userOf = async (db, id) => (await db.query('SELECT id, email, name, role, password_hash, email_verified FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];

// Sets the password. An account that already has a proven password keeps it
// (the person logs in with it instead); one whose password was never proven
// loses it, together with every session open under it.
export async function acceptWithPassword(pool, token, password) {
  if (!isPassword(password)) fail(400, 'La contraseña debe tener al menos 8 caracteres');
  return tx(pool, async (db) => {
    const inv = await byToken(db, token, { lock: true });
    const user = await userOf(db, inv.user_id);
    if (user.password_hash && user.email_verified) fail(409, 'Ya tienes una contraseña: inicia sesión con ella para aceptar la invitación', 'ya_tiene_contrasena');
    await db.query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [user.id, hashPassword(password)]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    return finish(db, inv, user, 'contraseña nueva');
  });
}

// Logged in already (password or social) as the invited account.
export async function acceptWithSession(pool, token, sessionUser) {
  return tx(pool, async (db) => {
    const inv = await byToken(db, token, { lock: true });
    if (inv.user_id !== sessionUser.id) fail(403, 'Has iniciado sesión con otra cuenta. Cierra sesión y vuelve a abrir el enlace.', 'otra_cuenta');
    return finish(db, inv, await userOf(db, inv.user_id), 'sesión iniciada');
  });
}

// Google / Microsoft with the link: the provider account must carry the
// invited email; holding the link then proves that email, so the login counts
// as verified (link or reclaim, see findOrCreateUserFromIdentity).
export async function checkIdentity(pool, token, email) {
  const inv = await byToken(pool, token);
  if (typeof email !== 'string' || email.trim().toLowerCase() !== inv.email.trim().toLowerCase()) {
    fail(403, 'Entra con la cuenta del email al que se envió la invitación', 'otro_email');
  }
  return inv;
}
export async function acceptWithIdentity(pool, token, userId, provider) {
  return tx(pool, async (db) => {
    const inv = await byToken(db, token, { lock: true });
    if (inv.user_id !== userId) fail(403, 'Entra con la cuenta del email al que se envió la invitación', 'otro_email');
    return finish(db, inv, await userOf(db, inv.user_id), provider);
  });
}

/* The email, built when the mail sender claims the queued message. Returns
 * null when the invitation is no longer open or a newer send replaced this
 * one: the message is then closed without sending anything. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const appUrl = () => (process.env.PUBLIC_APP_URL || 'https://ambitious-island-05d1d8a03.2.azurestaticapps.net').replace(/\/+$/, '');

const MAIL = {
  es: {
    subject: (t) => `Ledens · Tu acceso a la obra «${t}»`,
    hello: (n) => `Hola${n ? ` ${n}` : ''}:`,
    body: (by, t) => `${by ? `${by}, de Ledens,` : 'El equipo de Ledens'} te invita a seguir tu obra «${t}» en el área de cliente: el presupuesto, el avance y las fotos y documentos.`,
    cta: 'Acceder a mi obra',
    how: 'Podrás entrar con Google o Microsoft usando este email, o crear una contraseña.',
    expires: (d) => `El enlace es personal, sirve una sola vez y caduca el ${d}.`,
    ignore: 'Si no esperabas este correo, puedes ignorarlo.',
    date: (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }),
  },
  en: {
    subject: (t) => `Ledens · Your access to “${t}”`,
    hello: (n) => `Hello${n ? ` ${n}` : ''},`,
    body: (by, t) => `${by ? `${by} from Ledens` : 'The Ledens team'} invites you to follow your project “${t}” in the client area: the quote, the progress, and the photos and documents.`,
    cta: 'Open my project',
    how: 'You can sign in with Google or Microsoft using this email, or create a password.',
    expires: (d) => `This link is personal, works only once and expires on ${d}.`,
    ignore: 'If you weren’t expecting this email, you can ignore it.',
    date: (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }),
  },
};

export function formatInvitation({ lang, name, obra, invitedBy, expiresAt, link }) {
  const m = MAIL[lang] || MAIL.es;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">
<p>${esc(m.hello(name))}</p>
<p>${esc(m.body(invitedBy, obra))}</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#3E4D85;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(m.cta)}</a></p>
<p>${esc(m.how)}</p>
<p style="color:#666;font-size:13px">${esc(m.expires(m.date(new Date(expiresAt))))}<br>${esc(m.ignore)}</p>
</div>`;
  return { subject: m.subject(obra).replace(/[\r\n]/g, ' ').slice(0, 250), html };
}

export async function invitationMessage(pool, alert) {
  const { invitacion_id: id, sent_count: sentCount } = alert.payload || {};
  if (!isUuid(id)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const inv = (await pool.query(`UPDATE invitaciones i SET token_hash=$3 WHERE i.id=$1 AND i.sent_count=$2 AND ${OPEN} RETURNING i.*`,
    [id, sentCount, hashToken(token)])).rows[0];
  if (!inv) return null;
  const { rows: [r] } = await pool.query(`SELECT p.title, j.name invited_by, u.name user_name FROM presupuestos p JOIN users u ON u.id=$2
    LEFT JOIN users j ON j.id=$3 WHERE p.id=$1`, [inv.presupuesto_id, inv.user_id, inv.invited_by]);
  // The token travels in the fragment: browsers never send it to a server or
  // in a Referer, so it stays out of the hosting logs.
  const link = `${appUrl()}/invitacion#${token}`;
  return { to: inv.email, ...formatInvitation({ lang: inv.lang, name: inv.name || r.user_name, obra: r.title, invitedBy: r.invited_by, expiresAt: inv.expires_at, link }) };
}
