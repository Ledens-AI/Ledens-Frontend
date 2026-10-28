import crypto from 'node:crypto';
import { audit } from '../db/audit.js';
import { hashToken } from './sessions.js';
import { hashPassword } from './passwords.js';
import { appUrl, isEmail, acceptOpenInvitations } from '../invitaciones/service.js';

// Links to create or reset a password (migration 025). Anyone can ask for one
// for their email (the answer never says whether an account exists); an admin
// can send one from the user's page. The email goes through the notification
// queue with only the link id: the token is minted when the mail sender claims
// it, and only its hash is stored, as with client invitations.
//
// Using the link proves the email: the account is verified, and whatever an
// unverified account had (a password, a Google/Microsoft login that didn't
// vouch for the email) may belong to someone else, so it goes, with every
// session. Open invitations of that person are accepted too.
export const TTL = { self: 2, admin: 72 }; // hours
const PER_HOUR = 3; // links per account and hour, whoever asks

export class PasswordLinkError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new PasswordLinkError(status, message, code); };
const invalid = () => fail(410, 'El enlace para crear la contraseña no es válido o ha caducado', 'enlace_no_valido');
const isPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 200;

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

// Creates the link and queues the email; false when the hourly limit is reached.
async function create(db, user, { lang, requestedBy }) {
  const { rows: [n] } = await db.query("SELECT count(*)::int n FROM password_links WHERE user_id=$1 AND created_at > now() - interval '1 hour'", [user.id]);
  if (n.n >= PER_HOUR) return false;
  await db.query('UPDATE password_links SET ended_at=now(), token_hash=NULL WHERE user_id=$1 AND used_at IS NULL AND ended_at IS NULL', [user.id]);
  const hours = requestedBy ? TTL.admin : TTL.self;
  const link = (await db.query(`INSERT INTO password_links (user_id, lang, requested_by, expires_at)
                                VALUES ($1,$2,$3, now() + make_interval(hours => $4)) RETURNING id`, [user.id, lang === 'en' ? 'en' : 'es', requestedBy || null, hours])).rows[0];
  await db.query(`INSERT INTO ledens.transaction_alerts (event_key, event_type, status, payload) VALUES ($1,'password_link','password_link',$2)
                  ON CONFLICT (event_key) DO NOTHING`, [`password_link:${link.id}`, JSON.stringify({ link_id: link.id })]);
  return true;
}

// Self-service: same answer whether the account exists or not.
export async function requestLink(pool, email, lang) {
  if (!isEmail(typeof email === 'string' ? email.trim() : '')) fail(400, 'Email no válido');
  await tx(pool, async (db) => {
    const user = (await db.query('SELECT id, email FROM users WHERE lower(email)=lower($1) FOR UPDATE', [email.trim()])).rows[0];
    if (!user) return;
    if (await create(db, user, { lang })) {
      await audit({ actor: { id: user.id, name: user.email }, action: 'Enlace de contraseña pedido', target: { id: user.id, label: user.email }, detail: 'Desde «Iniciar sesión»' }, db);
    }
  });
  return { ok: true };
}

// From the admin panel.
export async function sendLink(pool, admin, userId, lang) {
  return tx(pool, async (db) => {
    const user = (await db.query('SELECT id, email, password_hash FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!user) fail(404, 'Usuario no encontrado');
    if (!(await create(db, user, { lang, requestedBy: admin.id }))) fail(429, 'Ya se han enviado varios enlaces a este usuario en la última hora. Inténtalo más tarde.');
    await audit({ actor: { id: admin.id, name: admin.name || admin.email }, action: 'Enlace de contraseña enviado', target: { id: user.id, label: user.email },
      detail: user.password_hash ? 'Para restablecer la contraseña' : 'Para crear la contraseña' }, db);
    return { ok: true, email: user.email };
  });
}

const OPEN = 'l.used_at IS NULL AND l.ended_at IS NULL AND l.expires_at > now()';
async function byToken(db, token, { lock } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalid();
  const l = (await db.query(`SELECT l.*, u.email, u.name, u.password_hash IS NOT NULL has_password, u.email_verified
                               FROM password_links l JOIN users u ON u.id=l.user_id WHERE l.token_hash=$1 AND ${OPEN}${lock ? ' FOR UPDATE OF l' : ''}`, [hashToken(token)])).rows[0];
  if (!l) invalid();
  return l;
}

export async function describeLink(pool, token) {
  const l = await byToken(pool, token);
  return { email: l.email, name: l.name && l.name !== l.email ? l.name : null, lang: l.lang, hasPassword: l.has_password && l.email_verified, expiresAt: l.expires_at };
}

// Returns the user; the route opens the session.
export async function usePasswordLink(pool, token, password) {
  if (!isPassword(password)) fail(400, 'La contraseña debe tener al menos 8 caracteres');
  return tx(pool, async (db) => {
    // Same lock order as asking for a link (user, then its links), or the two
    // could deadlock: find the account, lock it, then lock and recheck the link.
    const { user_id: userId } = await byToken(db, token);
    const u = (await db.query('SELECT id, email, name, role, email_verified FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    const l = await byToken(db, token, { lock: true });
    if (!u.email_verified) await db.query('DELETE FROM auth_identities WHERE user_id=$1', [u.id]);
    await db.query('UPDATE users SET password_hash=$2, email_verified=true, updated_at=now() WHERE id=$1', [u.id, hashPassword(password)]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [u.id]); // a new password closes every session
    await db.query('UPDATE password_links SET used_at=now(), token_hash=NULL WHERE id=$1', [l.id]);
    await audit({ actor: { id: u.id, name: u.name || u.email }, action: l.has_password ? 'Contraseña restablecida' : 'Contraseña creada', target: { id: u.id, label: u.email },
      detail: l.requested_by ? 'Con el enlace enviado por un administrador' : 'Con el enlace pedido desde «Iniciar sesión»' }, db);
    await acceptOpenInvitations(db, u, 'enlace de contraseña');
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  });
}

/* The email, built when the mail sender claims the queued message; null when
 * the link was used, replaced or expired (the message closes unsent). */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAIL = {
  es: {
    subject: (reset) => (reset ? 'Ledens · Restablece tu contraseña' : 'Ledens · Crea tu contraseña'),
    hello: (n) => `Hola${n ? ` ${n}` : ''}:`,
    body: (reset) => (reset ? 'Has pedido restablecer la contraseña de tu cuenta de Ledens.' : 'Ya puedes crear la contraseña de tu cuenta de Ledens para entrar en tu área de cliente.'),
    cta: (reset) => (reset ? 'Restablecer mi contraseña' : 'Crear mi contraseña'),
    expires: (d) => `El enlace es personal, sirve una sola vez y caduca el ${d}.`,
    ignore: 'Si no lo has pedido tú, ignora este correo: tu cuenta no cambia.',
    date: (d) => d.toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }),
  },
  en: {
    subject: (reset) => (reset ? 'Ledens · Reset your password' : 'Ledens · Create your password'),
    hello: (n) => `Hello${n ? ` ${n}` : ''},`,
    body: (reset) => (reset ? 'You asked to reset the password of your Ledens account.' : 'You can now create the password of your Ledens account to open your client area.'),
    cta: (reset) => (reset ? 'Reset my password' : 'Create my password'),
    expires: (d) => `This link is personal, works only once and expires on ${d} (Madrid time).`,
    ignore: 'If you didn’t ask for it, ignore this email: your account doesn’t change.',
    date: (d) => d.toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }),
  },
};
export async function passwordLinkMessage(pool, alert) {
  const id = alert.payload?.link_id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const l = (await pool.query(`UPDATE password_links l SET token_hash=$2 FROM users u WHERE l.id=$1 AND u.id=l.user_id AND ${OPEN}
                               RETURNING l.lang, l.expires_at, u.email, nullif(u.name, u.email) name, u.password_hash IS NOT NULL AND u.email_verified reset`, [id, hashToken(token)])).rows[0];
  if (!l) return null;
  const m = MAIL[l.lang] || MAIL.es;
  const link = `${appUrl()}/contrasena#${token}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">
<p>${esc(m.hello(l.name))}</p>
<p>${esc(m.body(l.reset))}</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#3E4D85;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(m.cta(l.reset))}</a></p>
<p style="color:#666;font-size:13px">${esc(m.expires(m.date(new Date(l.expires_at))))}<br>${esc(m.ignore)}</p>
</div>`;
  return { to: l.email, subject: m.subject(l.reset), html };
}
