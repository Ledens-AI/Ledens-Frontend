import React, { useCallback, useEffect, useState } from 'react';
import { api, pctS } from './api.js';
import { api as finApi } from '../finanzas/api.js';
import { eur, fecha } from '../finanzas/format.js';
import { Empty, ErrorBox, Kpi, Badge } from '../finanzas/ui.jsx';
import { PhaseBadge, Progress } from './Detalle.jsx';
import { useObrasI18n } from './i18n.js';

/* «Presupuestos y obras» by project: every presupuesto belongs to a project of
 * Gestión financiera (ledens.projects) through its obra. The team (admin and
 * jefe de obra) sees one card per project and, inside, the project's figures:
 * what its presupuestos add up to (backend: PresupuestosService.projectView)
 * and what has actually come in and gone out (Rentabilidad por proyecto,
 * /api/finanzas, with its own permissions). Spanish only, like the team table. */

export const projectLabel = (p) => (p ? [p.code, p.name].filter(Boolean).join(' · ') : 'Sin proyecto');

// One group per project: every project the user may see (`projects`, newest
// code first, also those without presupuestos), plus any other project its
// presupuestos point to, and «Sin proyecto» last.
function groups(list, projects) {
  const map = new Map();
  for (const pr of projects || []) map.set(pr.id, { project: pr, rows: [] });
  for (const p of list) {
    const k = p.project?.id || '';
    const g = map.get(k) || { project: p.project || null, rows: [] };
    g.rows.push(p);
    map.set(k, g);
  }
  const out = [...map.values()].map((g) => {
    const approved = g.rows.filter((r) => ['aprobado', 'en_curso'].includes(r.phase));
    const open = g.rows.filter((r) => ['pendiente', 'cambios'].includes(r.phase));
    const obras = g.rows.filter((r) => !r.parent && r.obra);
    const base = obras.reduce((a, r) => a + Number(r.obra.base), 0);
    const executed = obras.reduce((a, r) => a + Number(r.obra.executedAmount), 0);
    return {
      ...g,
      approved: approved.reduce((a, r) => a + Number(r.total), 0),
      open: open.reduce((a, r) => a + Number(r.total), 0),
      openN: open.length,
      action: g.rows.filter((r) => ['borrador', 'cambios'].includes(r.phase)).length,
      enCurso: g.rows.filter((r) => r.phase === 'en_curso').length,
      executionPct: base > 0 ? Math.round(executed / base * 1000) / 10 : null,
    };
  });
  const code = (g) => String(g.project?.code || '');
  return out.sort((a, b) => (!a.project) - (!b.project) || code(b).localeCompare(code(a), 'es', { numeric: true }) || String(a.project?.name || '').localeCompare(String(b.project?.name || ''), 'es'));
}

// The project's client (Gestión financiera); else the clients its presupuestos were sent to.
const clientOf = (g) => g.project?.cliente || [...new Set(g.rows.map((r) => r.client?.name).filter(Boolean))].join(', ');

const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function ProjectsGrid({ list, projects, onOpenProject, onUnlinked }) {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const all = groups(list, projects);
  const statuses = [...new Set(all.map((g) => g.project?.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const gs = all.filter((g) => (!estado || g.project?.status === estado)
    && (!q || norm([g.project?.code, g.project?.name, g.project?.municipio, g.project?.address, g.project?.cliente, ...g.rows.map((r) => r.title), ...g.rows.map((r) => r.client?.name)].join(' ')).includes(norm(q))));
  return (
    <div className="fin-stack">
      {all.length > 6 || statuses.length > 1 ? (
        <div className="fin-filters">
          <label className="fin-field obr-grow"><span>Buscar proyecto</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, municipio, cliente u obra…" />
          </label>
          {statuses.length > 1 ? (
            <label className="fin-field"><span>Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todos</option>
                {statuses.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {gs.length ? (
        <div className="obr-cards">
          {gs.map((g) => (
            <button key={g.project?.id || 'none'} type="button" className={'fin-card obr-card' + (g.project ? '' : ' obr-card-none')} onClick={() => (g.project ? onOpenProject(g.project.id) : onUnlinked())}>
              <span className="obr-card-top">
                <span className="fin-muted fin-small">{g.project ? g.project.code || 'Sin código' : 'Pendiente de vincular'}</span>
                {g.action ? <Badge bg="#FBE0EA" fg="#B84371" icon="ri-error-warning-line">{`${g.action} por hacer`}</Badge>
                  : g.enCurso ? <PhaseBadge phase="en_curso" />
                    : g.project?.status ? <Badge bg="#EDEDEA" fg="#3A3A38">{g.project.status}</Badge> : null}
              </span>
              <strong className="obr-card-title">{g.project ? g.project.name : 'Sin proyecto'}</strong>
              {g.project && clientOf(g) ? <span className="obr-card-client"><i className="ri-user-3-line" aria-hidden="true"></i>{clientOf(g)}</span> : null}
              <span className="fin-muted fin-small">
                {g.project ? [g.project.municipio, g.rows.length ? `${g.rows.length} ${g.rows.length === 1 ? 'presupuesto' : 'presupuestos'}` : null].filter(Boolean).join(' · ') || ' '
                  : `${g.rows.length} ${g.rows.length === 1 ? 'presupuesto' : 'presupuestos'} sin proyecto: vincúlalos desde cada obra`}
              </span>
              {g.rows.length ? (
                <span className="obr-proj-figs">
                  <span><span className="fin-muted fin-small">Aprobado</span><strong>{eur(g.approved)}</strong></span>
                  <span><span className="fin-muted fin-small">{`En negociación${g.openN ? ` · ${g.openN}` : ''}`}</span><strong>{eur(g.open)}</strong></span>
                </span>
              ) : <span className="fin-muted fin-small obr-card-empty"><i className="ri-file-add-line" aria-hidden="true"></i> Aún sin presupuestos: entra para crear el primero</span>}
              {g.executionPct !== null ? <><span className="obr-meter"><span>Ejecución</span></span><Progress value={g.executionPct} color="#5567AE" compact /></> : null}
            </button>
          ))}
        </div>
      ) : <Empty icon="ri-search-line" title="Ningún proyecto coincide" text="Prueba con otro código, nombre o estado." />}
    </div>
  );
}

// «Actualizar avance»: every open project the user may see, with or without
// presupuestos, each with its obras en curso (button straight into the
// progress editor). A project closed in Gestión financiera still shows while
// it has an obra en curso; obras with no project go last. Projects with obras
// en curso come first, then the rest, newest code first.
export function AvanceProyectos({ obras, projects, readOnly, panel, onUpdate, onOpenProject }) {
  const [q, setQ] = useState('');
  const map = new Map();
  for (const pr of projects || []) map.set(pr.id, { project: pr, rows: [] });
  for (const p of obras) {
    const k = p.project?.id || '';
    const g = map.get(k) || { project: p.project || null, rows: [] };
    g.rows.push(p);
    map.set(k, g);
  }
  const code = (g) => String(g.project?.code || '');
  const all = [...map.values()]
    .filter((g) => g.rows.length || g.project?.open !== false)
    .sort((a, b) => (!a.project) - (!b.project) || (!a.rows.length) - (!b.rows.length) || code(b).localeCompare(code(a), 'es', { numeric: true }) || String(a.project?.name || '').localeCompare(String(b.project?.name || ''), 'es'));
  const gs = all.filter((g) => !q || norm([g.project?.code, g.project?.name, g.project?.municipio, g.project?.address, g.project?.cliente, ...g.rows.map((r) => r.title), ...g.rows.map((r) => r.client?.name)].join(' ')).includes(norm(q)));
  if (!all.length) {
    return <Empty icon="ri-building-4-line" title="No hay proyectos abiertos" text={panel === 'admin' ? 'Los proyectos abiertos de Gestión financiera aparecen aquí, tengan o no presupuesto.' : 'Aquí verás los proyectos abiertos que tienes asignados y sus obras en curso.'} />;
  }
  return (
    <div className="fin-stack">
      {all.length > 6 ? (
        <div className="fin-filters">
          <label className="fin-field obr-grow"><span>Buscar proyecto</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, municipio, cliente u obra…" />
          </label>
        </div>
      ) : null}
      {gs.length ? gs.map((g) => (
        <section key={g.project?.id || 'none'} className="fin-stack obr-avance-proj">
          <div className="obr-avance-head">
            <div>
              <span className="fin-muted fin-small">{g.project ? g.project.code || 'Sin código' : 'Pendiente de vincular'}</span>
              <h3 className="obr-avance-title">{g.project ? g.project.name : 'Obras sin proyecto'}</h3>
              <span className="fin-muted fin-small">{[g.project?.cliente || [...new Set(g.rows.map((r) => r.client?.name).filter(Boolean))].join(', '), g.project?.municipio].filter(Boolean).join(' · ') || ' '}</span>
            </div>
            <div className="obr-actions">
              {g.project?.status ? <Badge bg="#EDEDEA" fg="#3A3A38">{g.project.status}</Badge> : null}
              {g.project && !g.project.missing ? <button type="button" className="fin-btn is-small" onClick={() => onOpenProject(g.project.id)}>Ver proyecto<i className="ri-arrow-right-s-line"></i></button> : null}
            </div>
          </div>
          {g.rows.length ? <div className="obr-cards">{g.rows.map((p) => <ObraCard key={p.id} p={p} team cta={readOnly ? null : 'Actualizar avance'} onClick={() => onUpdate(p)} />)}</div>
            : <p className="fin-muted fin-small obr-card-empty"><i className="ri-information-line" aria-hidden="true"></i> Sin obras en curso: una obra aparece aquí cuando su presupuesto está aprobado y tiene fecha de inicio.</p>}
        </section>
      )) : <Empty icon="ri-search-line" title="Ningún proyecto coincide" text="Prueba con otro código, nombre o cliente." />}
    </div>
  );
}

// The team's table of presupuestos (the project column is left out inside a project).
export function PresupuestosTable({ rows, onOpen, showProject = true }) {
  const open = (p) => () => onOpen(p, p.phase === 'en_curso' ? 'obra' : undefined);
  return (
    <div className="fin-card is-flush">
      <div className="fin-table-wrap">
        <table className="fin-table obr-click">
          <thead><tr><th>Presupuesto</th>{showProject ? <th>Proyecto</th> : null}<th>Cliente</th><th>Jefe de obra</th><th>Estado</th><th className="fin-num">Total con IVA</th><th>Avance</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} onClick={open(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(p)()}>
                <td><strong>{p.title}</strong><div className="fin-muted fin-small">{`${p.ref} · v${p.version.number}${p.parent ? ` · ampliación de ${p.parent.ref}` : ''}`}</div></td>
                {showProject ? <td>{p.project ? <><span>{p.project.name}</span><div className="fin-muted fin-small">{p.project.code}</div></> : <span className="fin-muted">Sin proyecto</span>}</td> : null}
                <td>{p.client.name}</td>
                <td>{p.jefe?.name || <span className="fin-muted">Sin asignar</span>}</td>
                <td><PhaseBadge phase={p.phase} /></td>
                <td className="fin-num fin-nowrap">{eur(p.total)}</td>
                <td className="fin-nowrap">{p.obra && p.startDate ? `${pctS(p.obra.executionPct)} ejecutado · ${pctS(p.obra.consumedPct)} consumido` : <span className="fin-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ObraCard({ p, onClick, team, cta }) {
  const { t, eur: money, fecha: fmt } = useObrasI18n();
  const o = p.obra || { executionPct: 0, consumedPct: 0 };
  const started = p.startDate && p.startDate <= new Date().toISOString().slice(0, 10);
  return (
    <button type="button" className="fin-card obr-card" onClick={onClick}>
      <span className="obr-card-top"><PhaseBadge phase="en_curso" /><span className="fin-muted fin-small">{started ? t.since(fmt(p.startDate)) : t.startsOn(fmt(p.startDate))}</span></span>
      <strong className="obr-card-title">{p.title}</strong>
      <span className="fin-muted fin-small">{[p.ref, p.address, team ? p.client.name : p.jefe ? t.jefe(p.jefe.name) : null].filter(Boolean).join(' · ')}</span>
      <span className="obr-meter"><span>{t.execution}</span></span>
      <Progress value={o.executionPct} color="#5567AE" />
      <span className="obr-meter"><span>{t.consumed}</span></span>
      <Progress value={o.consumedPct} color={o.consumedPct > 100 ? '#D14A4A' : '#55A89D'} />
      <span className="fin-muted fin-small">{p.obra ? t.ofExVat(money(p.obra.consumed), money(p.obra.base)) : ''}</span>
      {cta ? <span className="fin-btn is-primary is-small obr-card-cta"><i className="ri-edit-2-line"></i>{cta}</span> : null}
    </button>
  );
}

const pctOf = (part, whole) => (whole > 0 ? Math.round(part / whole * 1000) / 10 : null);

/* One project: its data, what its presupuestos add up to, its obras, its
 * presupuestos and, for whoever may see Gestión financiera of this project,
 * ingresos, costes and the latest movements assigned to it. */
export function Proyecto({ projectId, readOnly, onNew, onImport, onAgente, onBack, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fin, setFin] = useState(null); // { totales, rows, materiales, trabajadores } | { error }

  const load = useCallback(() => api.project(projectId).then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    setFin(null);
    Promise.all([
      finApi.projectResults({ proyecto: projectId, tam: 8, orden: 'fecha', dir: 'desc' }),
      finApi.projectResults({ proyecto: projectId, tipo: 'materiales', tam: 1 }),
      finApi.projectResults({ proyecto: projectId, tipo: 'trabajadores', tam: 1 }),
    ]).then(([all, mat, lab]) => { if (!cancelled) setFin({ totales: all.totales, rows: all.rows, materiales: mat.totales.costes, trabajadores: lab.totales.costes }); },
      (e) => { if (!cancelled) setFin({ error: e.status === 403 ? 'No tienes acceso a la gestión financiera de este proyecto.' : e.message }); });
    return () => { cancelled = true; };
  }, [projectId]);

  const back = <div><button type="button" className="fin-btn is-ghost is-small" onClick={onBack}><i className="ri-arrow-left-line"></i>Todos los proyectos</button></div>;
  if (error) return <div className="fin-stack">{back}<ErrorBox message={error} onRetry={load} /></div>;
  if (!data) return <div className="fin-loading fin-muted">Cargando el proyecto…</div>;

  const { project: pr, kpis: k, presupuestos: rows } = data;
  const obras = rows.filter((r) => r.phase === 'en_curso');
  const approvedTotal = Number(k.aprobado.total), approvedBase = Number(k.aprobado.base);
  const t = fin?.totales;
  const cobrado = t ? Number(t.ingresos) : null, costes = t ? Number(t.costes) : null;
  const pendienteCobro = t ? approvedTotal - cobrado : null;
  const costePct = t ? pctOf(costes, approvedBase) : null;
  const dates = [pr.startDate ? `Inicio ${fecha(pr.startDate)}` : null, pr.endDate ? `Fin ${fecha(pr.endDate)}` : null].filter(Boolean).join(' · ');

  return (
    <div className="fin-stack obr">
      {back}
      <div className="obr-head">
        <div className="fin-project-head">
          <span className="fin-muted">{['Proyecto', pr.code].filter(Boolean).join(' ')}</span>
          <h2>{pr.name}</h2>
          <span className="fin-muted">{[pr.municipio, pr.address, pr.cliente ? `Cliente: ${pr.cliente}` : null, dates].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="obr-actions">
          {pr.status ? <Badge bg="#E3E7F3" fg="#3E4D85" icon="ri-building-2-line">{pr.status}</Badge> : null}
          {!readOnly && onNew ? <button type="button" className="fin-btn" onClick={() => onNew(pr)}><i className="ri-add-line"></i>Nuevo presupuesto</button> : null}
          {!readOnly && onImport ? <button type="button" className="fin-btn is-primary" onClick={() => onImport(pr)}><i className="ri-file-upload-line"></i>Subir PDF de presupuesto</button> : null}
          {!readOnly && onAgente ? <button type="button" className="fin-btn" onClick={() => onAgente(pr)}><i className="ri-magic-line"></i>Generar con la documentación de la visita</button> : null}
        </div>
      </div>

      <h3 className="obr-h3">Presupuestos del proyecto</h3>
      <div className="fin-kpis">
        <Kpi label="Aprobado (con IVA)" value={eur(k.aprobado.total)} icon="ri-checkbox-circle-line"
          hint={`${k.aprobado.n} ${k.aprobado.n === 1 ? 'presupuesto' : 'presupuestos'} · ${eur(k.aprobado.base)} sin IVA`} />
        <Kpi label="En negociación (con IVA)" value={eur(k.enNegociacion.total)} icon="ri-time-line" tone={k.enNegociacion.n ? 'warn' : undefined}
          hint={`${k.enNegociacion.n} esperando al cliente o con cambios pedidos${k.borradores ? ` · ${k.borradores} en borrador` : ''}`} />
        <Kpi label="Ejecución de obra" value={pctS(k.ejecucion.executionPct)} icon="ri-bar-chart-horizontal-line"
          hint={`${eur(k.ejecucion.executedAmount)} ejecutado de ${eur(k.ejecucion.base)} sin IVA`} />
        <Kpi label="Presupuesto consumido" value={pctS(k.ejecucion.consumedPct)} icon="ri-pie-chart-line" tone={k.ejecucion.consumedPct > 100 ? 'bad' : undefined}
          hint={`${eur(k.ejecucion.consumed)} declarado (incluye excesos)`} />
      </div>

      <h3 className="obr-h3">Rentabilidad</h3>
      {fin === null ? <p className="fin-muted">Cargando ingresos y costes…</p>
        : fin.error ? <p className="fin-muted"><i className="ri-lock-line"></i> {fin.error}</p> : (
          <>
            <div className="fin-kpis">
              <Kpi label="Cobrado" value={eur(cobrado)} icon="ri-hand-coin-line"
                hint={approvedTotal > 0 ? `${pctS(pctOf(cobrado, approvedTotal))} de lo aprobado con IVA` : 'Cobros de clientes asignados al proyecto'} />
              <Kpi label="Pendiente de cobro" value={eur(Math.max(0, pendienteCobro))} icon="ri-time-line" tone={pendienteCobro > 0 ? 'warn' : undefined}
                hint={pendienteCobro < 0 ? `Cobrado ${eur(-pendienteCobro)} por encima de lo aprobado` : 'Aprobado con IVA − cobrado'} />
              <Kpi label="Costes" value={eur(costes)} icon="ri-shopping-cart-2-line"
                hint={`Materiales ${eur(fin.materiales)} · Mano de obra ${eur(fin.trabajadores)}`} />
              <Kpi label="Resultado" value={eur(t.resultado)} icon="ri-line-chart-line" tone={Number(t.resultado) < 0 ? 'bad' : undefined}
                hint={costePct !== null ? `Costes: ${pctS(costePct)} del presupuesto aprobado sin IVA` : 'Ingresos − costes'} />
            </div>
            <p className="fin-muted fin-small obr-hint-tight">{`Desde Rentabilidad por proyecto: los ${t.movimientos} movimientos asignados al proyecto, validados o no.`}</p>
          </>
        )}

      {obras.length ? (
        <>
          <h3 className="obr-h3">{`Obras en curso · ${obras.length}`}</h3>
          <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} team onClick={() => onOpen(p, 'obra')} />)}</div>
        </>
      ) : null}

      <h3 className="obr-h3">{`Presupuestos · ${rows.length}`}</h3>
      {rows.length ? <PresupuestosTable rows={rows} onOpen={onOpen} showProject={false} />
        : <Empty icon="ri-file-list-3-line" title="Este proyecto no tiene presupuestos" text="Crea el primero con «Subir PDF de presupuesto» o «Nuevo presupuesto» (queda en este proyecto), o vincula una obra existente desde su ficha." />}

      {fin?.rows?.length ? (
        <>
          <h3 className="obr-h3">Últimos movimientos</h3>
          <div className="fin-card is-flush">
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead><tr><th>Fecha</th><th>Tercero</th><th>Concepto</th><th className="fin-num">Importe</th></tr></thead>
                <tbody>
                  {fin.rows.map((r) => (
                    <tr key={`${r.id}-${r.project_id}`}>
                      <td className="fin-nowrap">{fecha(r.fecha)}</td>
                      <td>{r.tercero || '—'}</td>
                      <td>{r.concepto || r.numerodocumento || '—'}</td>
                      <td className="fin-num fin-nowrap" style={{ color: r.ingreso ? '#3E8C82' : '#C9507E' }}>{eur(r.resultado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
