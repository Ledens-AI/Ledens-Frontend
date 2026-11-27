import crypto from 'node:crypto';
import { audit } from '../db/audit.js';
import { hashToken } from '../auth/sessions.js';
import { isUuid } from '../presupuestos/service.js';
import { InvitacionError, InvitacionesService, appUrl, tx } from './service.js';

// «Usuarios con acceso» of an obra (root presupuesto), on the project page of
// «Presupuestos y obras», and «Compartir» (migration 051).
//
// Who sees an obra, besides the admins (who see every obra):
//  - Jefe de obra: presupuestos.jefe_id (an admin changes it: PUT /api/presupuestos/:id/jefe);
//  - Cliente principal: presupuestos.client_id, the only one who approves,
//    asks for changes, rejects and comments. Always exactly one;
//  - Clientes (solo lectura): obra_clientes. They see the obra — presupuestos,
//    avance, fotos y documentos — and decide nothing.
// The team of the obra (its jefe or an admin) changes who is the principal
// (the previous one stays as read-only), withdraws a read-only access, and
// creates links to share the obra: whoever opens one creates an account (or
// logs in) and joins as read-only. A link is a credential: only a SHA-256 of
// its token is kept, the token is shown once to whoever created it, it expires
// and can be revoked; revoking it does not take away the accesses it gave.
//
// A read-only client added by an invitation that is not accepted yet is shown
// with the name and email typed in the invitation, never the account's own
// data, as the «Clientes» tab does: inviting must not tell whoever invites
// whether an email already has an account (invitaciones/service.js).
export const LINK_DAYS = [7, 30, 90];
export const DEFAULT_LINK_DAYS = 30;
const MAX_OPEN_LINKS = 10;

const fail = (status, message, code) => { throw new InvitacionError(status, message, code); };
const invalidLink = () => fail(410, 'El enlace para compartir la obra no es válido o ha caducado', 'enlace_no_valido');
const linkStatus = (e) => (e.revoked_at ? 'revocado' : new Date(e.expires_at) <= new Date() ? 'caducado' : 'activo');
// The name a person gave, else nothing (an account created by invitation without a name carries its email as name).
const nameOf = (u) => (u.name && u.name !== u.email ? u.name : null);
// What the team is told about an account: in, still to register, or with an email nobody has proven yet.
const state = (u) => (u.held ? 'sin_verificar' : u.registered ? 'activo' : 'pendiente_registro');

export class AccesoService extends InvitacionesService {
  // The obra (root presupuesto) if this user is its jefe or an admin.
  async obra(db, id, { lock } = {}) {
    if (this.user.role !== 'admin' && this.user.role !== 'jefe') fail(403, 'Solo el equipo de la obra gestiona quién tiene acceso');
    const p = await this.presu.load(db, id, { lock });
    if (!this.presu.isTeam(p)) fail(403, 'No tienes permiso para gestionar el acceso a esta obra');
    if (p.parent_id) fail(400, 'El acceso se gestiona en la obra principal');
    return p;
  }

  async members(obraId) {
    const p = await this.obra(this.pool, obraId);
    const q = (sql, params) => this.pool.query(sql, params);
    const ACCOUNT = "u.id, u.name, u.email, u.role, u.registered_at IS NOT NULL registered, (u.access_held AND NOT u.email_verified) held";
    const staff = (await q(`SELECT ${ACCOUNT} FROM users u WHERE u.id=ANY($1::uuid[])`, [[p.client_id, p.jefe_id].filter(Boolean)])).rows;
    const titular = staff.find((u) => u.id === p.client_id);
    const jefe = staff.find((u) => u.id === p.jefe_id);
    const readers = (await q(`
      SELECT ${ACCOUNT}, oc.created_at since, oc.invitacion_id, oc.enlace_id, i.email inv_email, i.name inv_name, i.accepted_at, a.name added_by
        FROM obra_clientes oc JOIN users u ON u.id=oc.user_id
        LEFT JOIN invitaciones i ON i.id=oc.invitacion_id LEFT JOIN users a ON a.id=oc.added_by
       WHERE oc.presupuesto_id=$1 AND oc.user_id<>$2 ORDER BY oc.created_at, u.id`, [p.id, p.client_id])).rows;
    // Invited, without access yet (an account whose email nobody has proven waits for the link).
    const invited = (await q(`
      SELECT i.id, i.email, i.name, i.expires_at, i.last_sent_at FROM invitaciones i
       WHERE i.presupuesto_id=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND i.user_id<>$2
         AND NOT EXISTS (SELECT 1 FROM obra_clientes oc WHERE oc.presupuesto_id=i.presupuesto_id AND oc.user_id=i.user_id)
       ORDER BY i.last_sent_at DESC`, [p.id, p.client_id])).rows;
    const links = (await q(`
      SELECT e.*, u.name created_by_name FROM obra_enlaces e LEFT JOIN users u ON u.id=e.created_by
       WHERE e.presupuesto_id=$1 ORDER BY e.created_at DESC LIMIT 50`, [p.id])).rows;
    const person = (u) => ({ userId: u.id, name: nameOf(u), email: u.email, estado: state(u) });
    return {
      obra: { id: p.id, ref: p.ref, title: p.title },
      jefe: jefe ? { userId: jefe.id, name: jefe.name || jefe.email, email: jefe.email } : null,
      miembros: [
        ...(titular ? [{ ...person(titular), rol: 'principal', via: null, since: null }] : []),
        ...readers.map((r) => {
          // Invited and not accepted yet: what the invitation says, as the «Clientes» tab shows it.
          const masked = r.invitacion_id && !r.accepted_at;
          return {
            ...(masked ? { userId: r.id, name: r.inv_name || null, email: r.inv_email, estado: 'invitacion' } : person(r)),
            rol: 'lectura', via: r.enlace_id ? 'enlace' : r.invitacion_id ? 'invitacion' : 'equipo', since: r.since, addedBy: r.added_by || null,
          };
        }),
      ],
      invitaciones: invited.map((i) => ({ id: i.id, email: i.email, name: i.name, expiresAt: i.expires_at, lastSentAt: i.last_sent_at })),
      enlaces: links.map((e) => ({ id: e.id, status: linkStatus(e), createdAt: e.created_at, createdBy: e.created_by_name || null, expiresAt: e.expires_at, revokedAt: e.revoked_at, uses: e.uses })),
      linkDays: LINK_DAYS, defaultLinkDays: DEFAULT_LINK_DAYS,
      can: { roles: true, jefe: this.user.role === 'admin' },
    };
  }

  // rol 'principal': this person becomes the cliente principal of the obra and
  // its ampliaciones; the previous one stays as read-only. 'lectura' on the
  // principal is refused: there is always one, so another person takes it first.
  async setRole(obraId, userId, body = {}) {
    if (!isUuid(userId)) fail(404, 'Esa persona no tiene acceso a esta obra');
    if (!['principal', 'lectura'].includes(body.rol)) fail(400, 'Rol no válido');
    await tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      const isPrincipal = p.client_id === userId;
      const member = isPrincipal || (await db.query('SELECT 1 FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2 FOR UPDATE', [p.id, userId])).rows.length > 0;
      if (!member) fail(404, 'Esa persona no tiene acceso a esta obra');
      if (body.rol === 'lectura') {
        if (isPrincipal) fail(409, 'La obra necesita un cliente principal: haz antes principal a otra persona y esta pasará a solo lectura');
        return;
      }
      if (isPrincipal) return;
      const account = async (id) => (await db.query('SELECT id, name, email, role FROM users WHERE id=$1', [id])).rows[0];
      const next = await account(userId), prev = await account(p.client_id);
      if (next?.role !== 'client') fail(400, 'El cliente principal debe ser una cuenta de cliente');
      await db.query('INSERT INTO obra_clientes (presupuesto_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT (presupuesto_id, user_id) DO NOTHING', [p.id, p.client_id, this.user.id]);
      await db.query('DELETE FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2', [p.id, userId]);
      await db.query('UPDATE presupuestos SET client_id=$2, updated_at=now() WHERE id=$1 OR parent_id=$1', [p.id, userId]);
      await audit({ actor: this.actor(), action: 'Cliente principal de la obra cambiado', target: { id: userId, label: next.email },
        detail: `${p.ref} · ${p.title} · ${prev?.email || '—'} → ${next.email} (el anterior pasa a solo lectura)` }, db);
    });
    return this.members(obraId);
  }

  // A read-only client leaves the obra; an invitation of theirs still open ends
  // too (its link would give the access back). The principal can't be removed.
  async removeAccess(obraId, userId) {
    if (!isUuid(userId)) fail(404, 'Esa persona no tiene acceso a esta obra');
    await tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      if (p.client_id === userId) fail(409, 'No se puede quitar al cliente principal: haz antes principal a otra persona');
      const gone = (await db.query('DELETE FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2 RETURNING user_id', [p.id, userId])).rows.length;
      if (!gone) fail(404, 'Esa persona no tiene acceso a esta obra');
      await db.query(`UPDATE invitaciones SET revoked_at=now(), revoked_by=$3, token_hash=NULL
                       WHERE presupuesto_id=$1 AND user_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL`, [p.id, userId, this.user.id]);
      const u = (await db.query('SELECT email FROM users WHERE id=$1', [userId])).rows[0];
      await audit({ actor: this.actor(), action: 'Acceso a la obra retirado', target: { id: userId, label: u?.email || userId }, detail: `${p.ref} · ${p.title}` }, db);
    });
    return this.members(obraId);
  }

  // A new link to share the obra. The answer carries the only copy of its token.
  async createLink(obraId, body = {}) {
    const days = body.dias === undefined ? DEFAULT_LINK_DAYS : Number(body.dias);
    if (!LINK_DAYS.includes(days)) fail(400, 'Caducidad del enlace no válida');
    const token = crypto.randomBytes(32).toString('base64url');
    const e = await tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      const open = (await db.query('SELECT count(*)::int n FROM obra_enlaces WHERE presupuesto_id=$1 AND revoked_at IS NULL AND expires_at > now()', [p.id])).rows[0].n;
      if (open >= MAX_OPEN_LINKS) fail(409, `Esta obra ya tiene ${MAX_OPEN_LINKS} enlaces activos: revoca alguno antes de crear otro`);
      const row = (await db.query(`INSERT INTO obra_enlaces (presupuesto_id, token_hash, created_by, expires_at) VALUES ($1,$2,$3, now() + make_interval(days => $4)) RETURNING *`,
        [p.id, hashToken(token), this.user.id || null, days])).rows[0];
      await audit({ actor: this.actor(), action: 'Enlace para compartir la obra creado', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} · ${p.title} · caduca en ${days} días` }, db);
      return row;
    });
    // The token travels in the fragment, like invitations: never sent to a server or in a Referer.
    return { enlace: { id: e.id, status: 'activo', createdAt: e.created_at, createdBy: this.user.name || null, expiresAt: e.expires_at, uses: 0 }, url: `${appUrl()}/obra-compartida#${token}` };
  }

  async revokeLink(obraId, enlaceId) {
    if (!isUuid(enlaceId)) fail(404, 'Enlace no encontrado');
    await tx(this.pool, async (db) => {
      const p = await this.obra(db, obraId, { lock: true });
      const e = (await db.query('SELECT * FROM obra_enlaces WHERE id=$1 AND presupuesto_id=$2 FOR UPDATE', [enlaceId, p.id])).rows[0];
      if (!e) fail(404, 'Enlace no encontrado');
      if (e.revoked_at) fail(409, 'El enlace ya está revocado');
      await db.query('UPDATE obra_enlaces SET revoked_at=now(), revoked_by=$2 WHERE id=$1', [e.id, this.user.id || null]);
      await audit({ actor: this.actor(), action: 'Enlace para compartir la obra revocado', target: { id: p.client_id, label: p.ref }, detail: `${p.ref} · ${p.title} · ${e.uses} ${e.uses === 1 ? 'persona entró' : 'personas entraron'} con él` }, db);
    });
    return this.members(obraId);
  }
}

/* What whoever opens the link does (/obra-compartida#<token>): the token only
 * ever travels in a POST body. The link is the credential: no email is
 * checked, the person joins with whatever account they create or log in with. */
async function linkByToken(db, token, { lock } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalidLink();
  // The obra is the root presupuesto, also for a link of an obra since joined to another as an ampliación.
  const e = (await db.query(`SELECT e.*, coalesce(p.parent_id, p.id) obra_id FROM obra_enlaces e JOIN presupuestos p ON p.id=e.presupuesto_id
                              WHERE e.token_hash=$1 AND e.revoked_at IS NULL AND e.expires_at > now()${lock ? ' FOR UPDATE OF e' : ''}`, [hashToken(token)])).rows[0];
  if (!e) invalidLink();
  return e;
}

const isMember = async (db, obraId, clientId, userId) => clientId === userId
  || (await db.query('SELECT 1 FROM obra_clientes WHERE presupuesto_id=$1 AND user_id=$2', [obraId, userId])).rows.length > 0;

export async function describeLink(pool, token, sessionUser, { providers = {} } = {}) {
  const e = await linkByToken(pool, token);
  const { rows: [r] } = await pool.query('SELECT p.title, p.client_id, u.name shared_by FROM presupuestos p LEFT JOIN users u ON u.id=$2 WHERE p.id=$1', [e.obra_id, e.created_by]);
  const session = sessionUser ? {
    email: sessionUser.email, client: sessionUser.role === 'client',
    member: sessionUser.role === 'client' && await isMember(pool, e.obra_id, r.client_id, sessionUser.id),
  } : null;
  return { obra: r.title, sharedBy: r.shared_by || null, expiresAt: e.expires_at, providers, session };
}

// Joins the obra as read-only with the account of the session. Only client
// accounts: the team sees obras by its role, never through obra_clientes.
// `held`: the account took a row the team had prepared for that email without
// proving it (migration 024) and sees no obra until it does.
export async function joinWithLink(pool, token, user) {
  if (user?.role !== 'client') fail(409, 'Has entrado con una cuenta del equipo de Ledens: este enlace es para clientes', 'cuenta_equipo');
  return tx(pool, async (db) => {
    const e = await linkByToken(db, token, { lock: true });
    const p = (await db.query('SELECT id, ref, title, client_id FROM presupuestos WHERE id=$1', [e.obra_id])).rows[0];
    const joined = p.client_id !== user.id && (await db.query(`INSERT INTO obra_clientes (presupuesto_id, user_id, enlace_id, added_by) VALUES ($1,$2,$3,$4)
                                                              ON CONFLICT (presupuesto_id, user_id) DO NOTHING RETURNING user_id`, [p.id, user.id, e.id, e.created_by])).rows.length > 0;
    if (joined) {
      await db.query('UPDATE obra_enlaces SET uses=uses+1 WHERE id=$1', [e.id]);
      await audit({ actor: { id: user.id, name: user.name || user.email }, action: 'Entrada en la obra con un enlace para compartir', target: { id: user.id, label: user.email }, detail: `${p.ref} · ${p.title}` }, db);
    }
    const held = (await db.query('SELECT access_held AND NOT email_verified held FROM users WHERE id=$1', [user.id])).rows[0]?.held === true;
    return { joined, obra: p.title, held };
  });
}
