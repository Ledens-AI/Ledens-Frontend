import { audit } from '../db/audit.js';
import { PresupuestoError, isUuid } from './service.js';

// Calendario laboral de la Planificación (Gantt): días no laborables además de
// sábados y domingos (migration 045, gantt_festivos). Two scopes:
//   - empresa (project_id NULL): every project's Gantt skips them. Only an
//     admin adds or removes them; «Cargar festivos» fills a year with the
//     national and Andalusian ones by rule (festivosDeAnio), to be checked
//     against the official calendar (BOJA) — a moved holiday the rule cannot
//     know is added or removed by hand.
//   - proyecto: only that project's Gantt (the local holidays of the obra's
//     municipio, a rain day…). An admin or the jefe assigned to one of its
//     obras manages them.
// Every change is audited «Calendario laboral modificado».
const fail = (status, message) => { throw new PresupuestoError(status, message); };
const DAY = 86400000;
const fmt = (t) => new Date(t).toISOString().slice(0, 10);

// Easter Sunday (Gregorian, anonymous algorithm) as a UTC timestamp.
export function domingoDePascua(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

// National holidays of Spain plus Andalucía's (28 Feb, Jueves Santo). One that
// falls on a Sunday moves to the Monday, as Andalucía usually decrees — the
// official calendar of each year has the last word.
export function festivosDeAnio(year) {
  const pascua = domingoDePascua(year);
  const fixed = [
    ['01-01', 'Año Nuevo'], ['01-06', 'Epifanía del Señor'], ['02-28', 'Día de Andalucía'], ['05-01', 'Fiesta del Trabajo'],
    ['08-15', 'Asunción de la Virgen'], ['10-12', 'Fiesta Nacional de España'], ['11-01', 'Todos los Santos'],
    ['12-06', 'Día de la Constitución'], ['12-08', 'Inmaculada Concepción'], ['12-25', 'Natividad del Señor'],
  ].map(([md, nombre]) => ({ t: Date.UTC(year, +md.slice(0, 2) - 1, +md.slice(3)), nombre }));
  const list = [...fixed, { t: pascua - 3 * DAY, nombre: 'Jueves Santo' }, { t: pascua - 2 * DAY, nombre: 'Viernes Santo' }];
  const taken = new Set(list.map((f) => f.t));
  const out = [];
  for (const f of list.sort((x, y) => x.t - y.t)) {
    if (new Date(f.t).getUTCDay() === 0 && !taken.has(f.t + DAY)) { out.push({ fecha: fmt(f.t + DAY), nombre: `${f.nombre} (traslado al lunes)` }); taken.add(f.t + DAY); }
    else out.push({ fecha: fmt(f.t), nombre: f.nombre });
  }
  return out;
}

// Festivos that count in a project's Gantt: the company's and the project's.
export async function loadFestivos(db, projectId) {
  return (await db.query(`SELECT id, to_char(fecha, 'YYYY-MM-DD') fecha, nombre, project_id IS NOT NULL proyecto
                          FROM gantt_festivos WHERE project_id IS NULL OR project_id = $1 ORDER BY fecha`, [isUuid(projectId) ? projectId : null])).rows;
}

const validDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return fmt(t) === s && +s.slice(0, 4) >= 2000 && +s.slice(0, 4) <= 2100;
};

export class FestivosService {
  // gantt: (user) => GanttService, to check who runs the obras of a project.
  constructor(pool, user, gantt) { this.pool = pool; this.user = user; this.gantt = gantt; }

  team() { if (!['admin', 'jefe'].includes(this.user.role)) fail(403, 'Solo el equipo ve el calendario laboral'); }
  actor() { return { id: this.user.id, name: this.user.name || this.user.email }; }

  // A project the user may see (404 otherwise); `edit`: and may change its
  // calendar — an admin, or the jefe assigned to one of its approved obras.
  async project(projectId, edit) {
    if (!isUuid(projectId)) fail(404, 'Proyecto no encontrado');
    const g = this.gantt(this.user);
    const view = await g.svc.projectView(projectId);
    if (edit && this.user.role !== 'admin' && !view.presupuestos.some((r) => !r.parent && r.jefe?.id === this.user.id)) {
      fail(403, 'Solo el jefe de una obra del proyecto o un administrador cambia sus festivos');
    }
    return view.project;
  }

  // { festivos } of the company, plus a project's when `projectId` is given.
  async list({ projectId } = {}) {
    this.team();
    if (projectId) await this.project(projectId, false);
    return { festivos: await loadFestivos(this.pool, projectId || null) };
  }

  // { fecha, nombre, projectId? } — without projectId it is the company's (admin).
  async add(body = {}) {
    this.team();
    const fecha = String(body.fecha || '').trim(), nombre = String(body.nombre || '').trim().slice(0, 120);
    if (!validDate(fecha)) fail(400, 'Indica una fecha válida');
    if (!nombre) fail(400, 'Indica el nombre del festivo');
    const projectId = body.projectId || null;
    let label = 'Empresa';
    if (projectId) { const p = await this.project(projectId, true); label = [p.code, p.name].filter(Boolean).join(' '); }
    else if (this.user.role !== 'admin') fail(403, 'Solo un administrador cambia los festivos de toda la empresa');
    const r = await this.pool.query(`INSERT INTO gantt_festivos (fecha, nombre, project_id, created_by) VALUES ($1,$2,$3,$4)
                                     ON CONFLICT DO NOTHING RETURNING id`, [fecha, nombre, projectId, this.user.id]);
    if (!r.rows.length) fail(409, 'Ese día ya es festivo');
    await audit({ actor: this.actor(), action: 'Calendario laboral modificado', target: { id: null, label }, detail: `Festivo añadido: ${fecha} · ${nombre}` }, this.pool);
    return this.list({ projectId });
  }

  async remove(id) {
    this.team();
    if (!isUuid(id)) fail(404, 'Festivo no encontrado');
    const f = (await this.pool.query("SELECT id, to_char(fecha, 'YYYY-MM-DD') fecha, nombre, project_id FROM gantt_festivos WHERE id=$1", [id])).rows[0];
    if (!f) fail(404, 'Festivo no encontrado');
    let label = 'Empresa';
    if (f.project_id) { const p = await this.project(f.project_id, true); label = [p.code, p.name].filter(Boolean).join(' '); }
    else if (this.user.role !== 'admin') fail(403, 'Solo un administrador cambia los festivos de toda la empresa');
    await this.pool.query('DELETE FROM gantt_festivos WHERE id=$1', [id]);
    await audit({ actor: this.actor(), action: 'Calendario laboral modificado', target: { id: null, label }, detail: `Festivo quitado: ${f.fecha} · ${f.nombre}` }, this.pool);
    return this.list({ projectId: f.project_id });
  }

  // { anio } — the national and Andalusian holidays of a year, for the whole
  // company (admin). Days already there are left as they are.
  async cargar(body = {}) {
    this.team();
    if (this.user.role !== 'admin') fail(403, 'Solo un administrador cambia los festivos de toda la empresa');
    const year = Number(body.anio);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) fail(400, 'Indica un año válido');
    const added = [];
    for (const f of festivosDeAnio(year)) {
      const r = await this.pool.query(`INSERT INTO gantt_festivos (fecha, nombre, created_by) VALUES ($1,$2,$3)
                                       ON CONFLICT DO NOTHING RETURNING id`, [f.fecha, f.nombre, this.user.id]);
      if (r.rows.length) added.push(`${f.fecha} · ${f.nombre}`);
    }
    if (added.length) await audit({ actor: this.actor(), action: 'Calendario laboral modificado', target: { id: null, label: 'Empresa' }, detail: `Festivos de ${year} cargados:\n${added.join('\n')}` }, this.pool);
    return { anadidos: added.length, ...(await this.list({ projectId: body.projectId || null })) };
  }
}
