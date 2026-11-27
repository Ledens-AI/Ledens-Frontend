import { isUuid } from '../presupuestos/service.js';
import { appUrl } from '../invitaciones/service.js';

// «Nueva alta» email (migration 052): one per user, queued when the account is
// registered and built here when the Logic App claims it, so it says what the
// account looks like a few minutes later — how it gets in and the obras it
// already sees (an invitation accepted or a link to share an obra used right
// after signing up). It goes to its own recipient, not to the fixed ones of the
// transaction alerts: AVISO_ALTAS_TO (several separated by «;»), by default
// alvaro.navarro@ledens.es. Returns null when the user no longer exists: the
// message is then closed without sending (AlertService.claim).
export const altasTo = () => (process.env.AVISO_ALTAS_TO || '').trim() || 'alvaro.navarro@ledens.es';

const ROLE = { client: 'Cliente', jefe: 'Jefe de obra', admin: 'Administrador' };
const PROVIDER = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (d) => new Date(d).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

export async function userRegisteredMessage(pool, alert) {
  const id = alert.payload?.user_id;
  if (!isUuid(id)) return null;
  const u = (await pool.query(`
    SELECT u.id, u.email, u.name, u.role, u.email_verified, (u.access_held AND NOT u.email_verified) held, u.registered_at,
           u.password_hash IS NOT NULL has_password,
           coalesce((SELECT array_agg(DISTINCT a.provider) FROM auth_identities a WHERE a.user_id=u.id), '{}') providers
      FROM users u WHERE u.id=$1`, [id])).rows[0];
  if (!u) return null;
  const obras = (await pool.query(`
    SELECT p.ref, p.title, p.client_id=$1 principal, oc.enlace_id IS NOT NULL por_enlace, oc.invitacion_id IS NOT NULL por_invitacion
      FROM presupuestos p LEFT JOIN obra_clientes oc ON oc.presupuesto_id=p.id AND oc.user_id=$1
     WHERE p.parent_id IS NULL AND (p.client_id=$1 OR oc.user_id IS NOT NULL)
     ORDER BY p.created_at DESC LIMIT 20`, [id])).rows;

  const name = u.name && u.name !== u.email ? u.name : null;
  const access = [...u.providers.map((p) => PROVIDER[p] || p).sort(), ...(u.has_password ? ['email y contraseña'] : [])];
  const obra = (o) => `${o.ref} · ${o.title} — ${o.principal ? 'cliente principal' : `solo lectura${o.por_enlace ? ' (enlace para compartir)' : o.por_invitacion ? ' (invitación)' : ''}`}`;
  const rows = [
    ['Nombre', name || '—'],
    ['Email', u.email],
    ['Rol', ROLE[u.role] || u.role],
    ['Fecha de alta', when(u.registered_at)],
    ['Acceso con', access.join(', ') || '—'],
    ['Email verificado', u.email_verified ? 'Sí' : 'No'],
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">
<h2 style="margin:0 0 12px">Nuevo usuario en Ledens</h2>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('')}</table>
${u.held ? '<p style="background:#FBF1DE;color:#7A4E0E;padding:10px 12px;border-radius:6px">Se ha registrado con un email que el equipo había preparado para una obra, sin confirmarlo todavía: no verá ninguna obra hasta que confirme su email (Google, Microsoft o el enlace para crear su contraseña).</p>' : ''}
<p style="margin:16px 0 4px"><strong>Obras que ve</strong></p>
${obras.length ? `<ul style="margin:0;padding-left:20px">${obras.map((o) => `<li>${esc(obra(o))}</li>`).join('')}</ul>` : '<p style="margin:0;color:#666">Ninguna por ahora.</p>'}
<p style="margin:24px 0"><a href="${esc(`${appUrl()}/plataforma`)}" style="background:#3E4D85;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Abrir Ledens</a></p>
<p style="color:#666;font-size:13px">Lo ves en Administración → Usuarios. Aviso automático de cada alta (evento ${esc(alert.id)}).</p>
</div>`;
  return { to: altasTo(), subject: `Ledens · Nueva alta: ${name ? `${name} (${u.email})` : u.email}`.replace(/[\r\n]+/g, ' ').slice(0, 250), html };
}
