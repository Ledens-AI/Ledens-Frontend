/* Real data for the admin screens: turns /api/admin/* rows into the shapes
 * the design's markup expects (see Plataforma.jsx). Everything here is
 * derived from users, auth_identities, sessions and audit_log — nothing
 * invented. */

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAY = 864e5;

// Backend role → platform view. The view decides which screens exist.
export const ROLE_VIEW = { admin: 'admin', jefe: 'worker', client: 'client' };
export const ROLE_LABEL = { admin: 'Administrador', jefe: 'Jefe de obra', client: 'Cliente' };
const PROVIDER = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' };

export const initials = (name) =>
  (name || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
export const firstName = (u) => ((u && (u.name || u.email)) || '').trim().split(/[\s@]/)[0];

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export const fmtDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = (d) => `${d.getDate()} ${MES[d.getMonth()]}`;

export function fmtLast(iso, now = new Date()) {
  if (!iso) return 'Nunca';
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dayKey(d) === dayKey(now)) return `Hoy, ${time}`;
  if (dayKey(d) === dayKey(new Date(now - DAY))) return `Ayer, ${time}`;
  return fmtShort(d);
}

export function accessLabel(u) {
  // Chosen for an obra or invited, never signed in (migration 024).
  if (!u.registered_at) return 'Pendiente de registro';
  const ways = u.providers.map((p) => PROVIDER[p] || p);
  if (u.has_password) ways.push('Email y contraseña');
  return ways.length ? ways.join(' · ') : 'Sin acceso todavía';
}

const normName = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/* Automatic checks on real fields. They clear by themselves once the data
 * changes, so they carry no "resolve" action. */
export function issuesFor(u, all) {
  const out = [];
  // A client chosen for an obra or invited has no way in until they accept:
  // expected, not something to fix (migration 024).
  if (!u.registered_at) return out;
  if (!u.has_password && !u.providers.length) {
    out.push({ id: `${u.id}-access`, type: 'Automática', title: 'Sin método de acceso',
      detail: 'Cuenta creada por un administrador: aún no tiene contraseña ni login de Google/Microsoft. Genera una contraseña temporal con "npm run users -- set-password" o pide que entre con Google/Microsoft.',
      field: 'Acceso' });
  }
  if (normName(u.name).split(' ').length < 2) {
    out.push({ id: `${u.id}-name`, type: 'Automática', title: 'Nombre incompleto',
      detail: 'Solo se ha indicado una palabra como nombre.', field: 'Nombre y apellidos' });
  }
  const twins = all.filter((o) => o.id !== u.id && normName(o.name) === normName(u.name));
  if (twins.length) {
    out.push({ id: `${u.id}-dup`, type: 'Automática', title: 'Posible duplicado',
      detail: `Mismo nombre que ${twins.map((t) => t.email).join(', ')}.`, field: 'Cuenta' });
  }
  return out;
}

export function userRow(u, all, now = new Date()) {
  const issues = issuesFor(u, all);
  return {
    ...u,
    initials: initials(u.name),
    since: fmtDate(u.created_at),
    kind: u.role === 'client' ? 'Cliente' : 'Interno',
    roleL: ROLE_LABEL[u.role] || u.role,
    ver: u.email_verified ? 'Verificado' : 'Sin verificar',
    verOk: u.email_verified,
    verBg: u.email_verified ? '#DEF3F0' : '#FBF1DE',
    verFg: u.email_verified ? '#2F6B63' : '#7A4E0E',
    prov: accessLabel(u),
    profS: accessLabel(u),
    profFg: u.has_password || u.providers.length ? '#2F6B63' : '#7A4E0E',
    works: '—',
    last: fmtLast(u.last_seen, now),
    phone: '—',
    city: '—',
    issues,
  };
}

/* Sign-ups per day over the last 30 days, last 7 highlighted. */
export function signupBars(users, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const counts = Array.from({ length: 30 }, () => 0);
  users.forEach((u) => {
    if (!u.registered_at) return; // not signed up yet (migration 024)
    const i = Math.floor((new Date(u.registered_at) - start) / DAY);
    if (i >= 0 && i < 30) counts[i] += 1;
  });
  const max = Math.max(1, ...counts);
  return {
    bars: counts.map((c, i) => ({ h: `${Math.round((c / max) * 88) + 4}px`, bg: i >= 23 ? '#5567AE' : '#BFC7E4' })),
    from: fmtShort(start),
    to: fmtShort(now),
  };
}

export function adminKpis(users, rows, audit, now = new Date()) {
  // Clients chosen for an obra or invited count once they sign in (registered_at).
  const registered = users.filter((u) => u.registered_at);
  const since = (days) => registered.filter((u) => now - new Date(u.registered_at) < days * DAY).length;
  const count = (role) => users.filter((u) => u.role === role).length;
  const open = rows.reduce((n, r) => n + r.issues.length, 0);
  const dups = rows.filter((r) => r.issues.some((i) => i.title === 'Posible duplicado')).length;
  const roleChanges = audit.filter((a) => /^Rol /.test(a.action) && now - new Date(a.at) < 30 * DAY).length;
  return [
    ['Usuarios registrados', registered.length, `+${since(7)} en 7 días · ${users.length - registered.length} pendientes de registro`],
    ['Pendientes de revisión', open, 'Avisos automáticos abiertos'],
    ['Email sin verificar', registered.filter((u) => !u.email_verified).length, 'Lo verifica un login de Google/Microsoft'],
    ['Posibles duplicados', dups, 'Cuentas con el mismo nombre'],
    ['Clientes', count('client'), 'Rol cliente'],
    ['Jefes de obra', count('jefe'), 'Rol jefe de obra'],
    ['Administradores', count('admin'), 'Rol administrador'],
    ['Cambios de rol', roleChanges, 'Últimos 30 días'],
  ].map(([label, value, sub]) => ({ label, value: String(value), sub }));
}

export const auditRow = (a) => {
  const d = new Date(a.at);
  return { when: `${fmtShort(d)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`, actor: a.actor_label, action: a.action, target: a.target_label || '—', detail: a.detail || '' };
};
