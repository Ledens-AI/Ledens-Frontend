import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { fecha } from '../finanzas/format.js';
import { ErrorBox, Empty } from '../finanzas/ui.jsx';

/* Planificación (Gantt) of a project with an approved presupuesto (backend:
 * presupuestos/gantt.js). Tasks come ordered by dependencies: each one right
 * below the task it depends on (`nivel` = how deep, indented here). One task per approved line of its obras: its
 * duration comes from the rendimiento of the partida in the base (or the one
 * set here), its start from the predecessors table below. Every change in the
 * table is saved and the server answers with the whole plan recalculated, so
 * the chart moves at once. Working days Mon–Fri minus the festivos of the
 * company and of the project («Calendario laboral»). The server also returns
 * each task's holgura (backward pass): the critical path is outlined in
 * orange. Spanish only (team). */

const REL = [
  ['FS', 'Fin → inicio (FC)'],
  ['SS', 'Inicio → inicio (CC)'],
  ['FF', 'Fin → fin (FF)'],
  ['SF', 'Inicio → fin (CF)'],
];
const DAY = 86400000;
const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Bar colours: red = no predecessor yet, blue = has one; the executed share
// of the line (% de avance) fills the bar in green from the left.
const BAR = { sinPredecesora: '#D14A4A', conPredecesora: '#4A7FB8', avance: '#3E9A5A' };
// Outline of a task that breaks the sobreasignación limitación.
const SOBRE = '#8E3FB5'; // purple, dashed: orange is the ruta crítica
// Ruta crítica (holgura total 0): outlined in orange, and so are the arrows
// between two critical tasks. Festivos are shaded like weekends, warmer.
const CRIT = '#E07B00';
const FESTIVO = '#FBE9D7';
const dias = (n) => `${num(n)} ${n === 1 ? 'día' : 'días'}`;
const num = (v) => String(v).replace('.', ',');

// Changes to the table are a draft: each one asks the server for the plan as
// it would be (POST …/gantt/simular, nothing saved) and the chart shows it.
// «Guardar» saves the whole draft at once and stays disabled while the draft
// breaks a limitación (e.g. sobreasignación: more tasks at once than the
// obra's cuadrillas) in an obra it changes — the server refuses it too.
export default function Gantt({ projectId, readOnly, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(null);
  const [draft, setDraft] = useState(() => new Map()); // task id → { duration?, predecessors }
  const [simulating, setSimulating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const seq = useRef(0);
  // The latest draft, ahead of the render: two quick changes in a row both count.
  const latest = useRef(draft);
  const load = useCallback(() => api.gantt(projectId).then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  const items = (m) => [...m.entries()].map(([id, b]) => ({ id, ...b }));
  const setBoth = (m) => { latest.current = m; setDraft(m); };

  // Recalculates the plan with the draft `next`; on a refusal (a cycle…) the
  // draft stays as it was before that change.
  const simulate = async (next, prev) => {
    const n = ++seq.current;
    setBoth(next);
    setSimulating(true); setSaveError(''); setSavedMsg('');
    try {
      const plan = next.size ? await api.simulateGantt(projectId, items(next)) : await api.gantt(projectId);
      if (n !== seq.current) return;
      setData(plan);
    } catch (e) {
      if (n !== seq.current) return;
      setBoth(prev); setSaveError(e.message);
      setData((d) => (d ? { ...d, tasks: d.tasks.map((t) => ({ ...t })) } : d)); // rows go back to what the plan shows
    }
    if (n === seq.current) setSimulating(false);
  };

  // One task's choices go into the draft.
  const stage = (task, next) => {
    const body = {
      duration: next.duration !== undefined ? next.duration : task.durationOverride,
      predecessors: (next.predecessors || task.predecessors).filter((p) => p.id).map((p) => ({ id: p.id, type: p.type, lag: p.lag === '' ? 0 : Number(p.lag) })),
    };
    const prev = latest.current, m = new Map(prev); m.set(task.id, body);
    simulate(m, prev);
  };
  // The agent's predecessors go into the draft too (the duration stays as it is).
  const stageMany = (list) => {
    const prev = latest.current, m = new Map(prev);
    for (const t of list) m.set(t.id, { ...(m.get(t.id) || {}), predecessors: t.predecessors });
    simulate(m, prev);
  };
  const discard = () => { seq.current++; setBoth(new Map()); setSaveError(''); setSimulating(false); load(); };
  // After a change outside the draft (festivos): the plan again, keeping the draft.
  const refresh = () => (latest.current.size ? simulate(latest.current, latest.current) : load());

  const obraOfTask = new Map((data?.tasks || []).map((t) => [t.id, t.obraId]));
  const touched = new Set([...draft.keys()].map((id) => obraOfTask.get(id)));
  const limitaciones = data?.limitaciones || [];
  const blocking = limitaciones.filter((x) => touched.has(x.obraId));
  const dirty = draft.size > 0;

  const commit = async () => {
    setCommitting(true); setSaveError('');
    try {
      const plan = await api.saveGanttMany(projectId, items(draft));
      seq.current++; setBoth(new Map()); setData(plan);
      setSavedMsg(`Planificación guardada (${draft.size} ${draft.size === 1 ? 'tarea' : 'tareas'}).`);
    } catch (e) { setSaveError(e.message); }
    setCommitting(false);
  };

  // Number of cuadrillas and their oficial + peón: saved at once (not part of
  // the draft); the draft, if any, is recalculated with the new cuadrillas.
  const saveCuadrillas = async (obra, n, equipos) => {
    setSaving(obra.id); setSaveError('');
    try {
      const plan = await api.saveGanttCuadrillas(projectId, obra.id, n, equipos);
      if (latest.current.size) await simulate(latest.current, latest.current); else setData(plan);
    } catch (e) { setSaveError(`${obra.ref}: ${e.message}`); }
    setSaving(null);
  };

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const leave = () => { if (!dirty || window.confirm('Hay cambios en la planificación sin guardar. ¿Salir y descartarlos?')) onBack(); };

  const back = <div><button type="button" className="fin-btn is-ghost is-small" onClick={leave}><i className="ri-arrow-left-line"></i>Volver al proyecto</button></div>;
  if (error) return <div className="fin-stack">{back}<ErrorBox message={error} onRetry={load} /></div>;
  if (!data) return <div className="fin-loading fin-muted">Calculando la planificación…</div>;

  const { tasks } = data;
  const missing = tasks.filter((t) => t.warning).length;
  const save = stage;
  const obras = data.obras || [];
  return (
    <div className="fin-stack obr">
      {back}
      <div className="fin-project-head">
        <span className="fin-muted">{['Proyecto', data.project.code].filter(Boolean).join(' ')}</span>
        <h2>{`Planificación · ${data.project.name}`}</h2>
        <span className="fin-muted">{`${fecha(data.start)} → ${fecha(data.end)} · ${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'} · días laborables (lunes a viernes, sin festivos)`}</span>
      </div>
      {tasks.length ? (
        <ul className="obr-gantt-resumen">
          {obras.map((o) => (
            <li key={o.id}>
              <strong>{obras.length > 1 ? o.ref : 'Obra'}</strong>
              <span>{`Fin previsto ${fecha(o.plannedEnd)}`}</span>
              <span className="obr-gantt-crit-text">{`${o.criticas} ${o.criticas === 1 ? 'tarea crítica' : 'tareas críticas'}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="fin-muted fin-small obr-hint-tight">
        {data.rendimiento ? `Duración = cantidad ÷ rendimiento de la partida en la base («${data.rendimiento.column}», ${data.rendimiento.unit}), redondeada a la décima de día (dos tareas de 0,5 seguidas ocupan un día). ` : 'La base de partidas no tiene columna de rendimiento: cada tarea dura 1 día hasta que indiques su duración. '}
        Cada obra empieza en su fecha de inicio. Cambia una predecesora, su relación, el desfase o la duración y el Gantt se recalcula al momento; los cambios no se guardan hasta pulsar «Guardar».
        {' '}Cada cuadrilla hace una tarea a la vez: en una obra no puede haber más tareas a la vez que cuadrillas.
        {' '}Las tareas sin planificar tienen «Inicio de obra» como predecesora por defecto; si la quitas, la tarea se queda sin predecesora.
        {' '}La ruta crítica son las tareas sin holgura: si una se retrasa, se retrasa el fin de la obra. La holgura es lo que una tarea puede retrasarse sin mover el fin de su obra.
      </p>
      <Cuadrillas obras={obras} trabajadores={data.trabajadores} readOnly={readOnly} saving={saving} onSave={saveCuadrillas} />
      <Calendario data={data} projectId={projectId} readOnly={readOnly} onChanged={refresh} />
      {missing ? <p className="fin-warn"><i className="ri-error-warning-line"></i><span>{`${missing} ${missing === 1 ? 'tarea no tiene' : 'tareas no tienen'} rendimiento en la base: cuentan 1 día hasta que indiques su duración.`}</span></p> : null}
      <Limitaciones list={limitaciones} touched={touched} />
      {!readOnly && tasks.length ? (
        <div className={`obr-gantt-savebar${dirty ? ' is-dirty' : ''}`}>
          <button type="button" className="fin-btn is-primary" onClick={commit} disabled={!dirty || simulating || committing || blocking.length > 0}
            title={blocking.length ? 'Resuelve las limitaciones de las obras que has cambiado para poder guardar' : undefined}>
            <i className="ri-save-line"></i>{committing ? 'Guardando…' : 'Guardar'}
          </button>
          {dirty ? <button type="button" className="fin-btn is-ghost" onClick={discard} disabled={committing}>Descartar cambios</button> : null}
          <span className="fin-small fin-muted">
            {simulating ? 'Recalculando…'
              : blocking.length ? `No se puede guardar: ${blocking.length === 1 ? 'hay una limitación' : `hay ${blocking.length} limitaciones`} sin cumplir.`
                : dirty ? `${draft.size} ${draft.size === 1 ? 'tarea cambiada' : 'tareas cambiadas'} sin guardar.`
                  : savedMsg || 'Sin cambios.'}
          </span>
        </div>
      ) : null}
      {saveError ? <ErrorBox message={saveError} /> : null}
      {tasks.length ? <Chart data={data} /> : <Empty icon="ri-calendar-line" title="Sin tareas" text="Los presupuestos aprobados de este proyecto no tienen partidas." />}
      {!readOnly && tasks.length > 1 ? <Sugerencias projectId={projectId} tasks={tasks} onStage={stageMany} /> : null}
      {tasks.length ? <Tabla tasks={tasks} hitos={data.hitos || []} readOnly={readOnly} saving={saving} changed={draft} onSave={save} /> : null}
    </div>
  );
}

// «Inicio de obra» (hitos: one per obra, id = the obra's id) can be chosen as a
// predecessor like any task; it is listed first.
// Cuadrillas per obra: the rendimiento of the base is per cuadrilla, so with
// N cuadrillas a duration computed from it is divided by N (a typed duration
// stays as typed). Each cuadrilla is one oficial and one peón from the list of
// workers (Gestión financiera → Trabajadores): choosing the number opens the
// choice of who, and nothing is saved until every cuadrilla has both.
const CREW_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);
const ROLES = [['oficial', 'Oficial'], ['peon', 'Peón']];
function Cuadrillas({ obras, trabajadores, readOnly, saving, onSave }) {
  if (!obras.length) return null;
  return (
    <div className="obr-gantt-crews">
      {obras.map((o) => <CuadrillasObra key={o.id} o={o} many={obras.length > 1} trabajadores={trabajadores} editable={!readOnly && o.canEdit} busy={saving === o.id} onSave={onSave} />)}
    </div>
  );
}

function CuadrillasObra({ o, many, trabajadores, editable, busy, onSave }) {
  // draft: null (showing what is saved) or [{ oficial, peon }] being chosen.
  const [draft, setDraft] = useState(null);
  const saved = JSON.stringify(o.equipos);
  useEffect(() => { setDraft(null); }, [saved]);
  const n = draft ? draft.length : o.cuadrillas;
  const start = (count) => setDraft(Array.from({ length: count }, (_, i) => {
    const e = (draft || o.equipos.map((x) => ({ oficial: x.oficial?.activo ? x.oficial.id : '', peon: x.peon?.activo ? x.peon.id : '' })))[i];
    return e ? { ...e } : { oficial: '', peon: '' };
  }));
  const set = (i, rol, id) => setDraft((d) => d.map((e, j) => (j === i ? { ...e, [rol]: id } : e)));
  const chosen = draft ? draft.flatMap((e) => [e.oficial, e.peon]).filter(Boolean) : [];
  const missing = draft ? draft.reduce((a, e) => a + (e.oficial ? 0 : 1) + (e.peon ? 0 : 1), 0) : 0;
  const repeated = new Set(chosen).size !== chosen.length;
  const save = () => onSave(o, draft.length, draft);
  const noList = editable && !trabajadores;

  return (
    <div className={`obr-gantt-crew-box${!o.equiposCompletos ? ' is-incomplete' : ''}`}>
      <div className="obr-gantt-crew">
        <span>{`Cuadrillas en la obra${many ? ` ${o.ref}` : ''}`}</span>
        {editable && !noList ? (
          <select value={n} disabled={busy} onChange={(e) => start(Number(e.target.value))} aria-label="Número de cuadrillas">
            {[...new Set([...CREW_OPTIONS, n])].sort((a, b) => a - b).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : <strong>{o.cuadrillas}</strong>}
        <span className="fin-muted fin-small">{n > 1 ? `las duraciones por rendimiento se dividen entre ${n}` : 'una cuadrilla trabajando'}</span>
      </div>

      {draft ? (
        <>
          <p className="fin-muted fin-small">Cada cuadrilla es un oficial y un peón de la lista de trabajadores. Elige los dos de cada una para guardar.</p>
          <ul className="obr-gantt-crew-list">
            {draft.map((e, i) => (
              <li key={i}>
                <strong>{`Cuadrilla ${i + 1}`}</strong>
                {ROLES.map(([rol, label]) => (
                  <label key={rol} className="obr-gantt-crew-pick">
                    <span>{label}</span>
                    <WorkerSelect rol={rol} value={e[rol]} trabajadores={trabajadores} taken={chosen.filter((id) => id !== e[rol])} onChange={(id) => set(i, rol, id)} label={`${label} de la cuadrilla ${i + 1}`} />
                  </label>
                ))}
              </li>
            ))}
          </ul>
          <div className="obr-actions obr-start">
            <button type="button" className="fin-btn is-primary is-small" disabled={busy || missing > 0 || repeated} onClick={save}><i className="ri-save-line"></i>{busy ? 'Guardando…' : 'Guardar cuadrillas'}</button>
            <button type="button" className="fin-btn is-ghost is-small" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
            {missing ? <span className="fin-warn-text fin-small">{`Falta${missing === 1 ? '' : 'n'} ${missing} ${missing === 1 ? 'trabajador' : 'trabajadores'} por elegir`}</span>
              : repeated ? <span className="fin-warn-text fin-small">Un trabajador solo puede estar en una cuadrilla</span> : null}
          </div>
        </>
      ) : (
        <>
          <ul className="obr-gantt-crew-list is-read">
            {o.equipos.map((e) => (
              <li key={e.cuadrilla}>
                <strong>{`Cuadrilla ${e.cuadrilla}`}</strong>
                {ROLES.map(([rol, label]) => (
                  <span key={rol} className="obr-gantt-crew-pick">
                    <span className="fin-muted">{label}</span>
                    {e[rol] ? <span>{e[rol].name}{e[rol].activo ? '' : <em className="fin-muted"> (de baja)</em>}</span> : <em className="fin-warn-text">sin elegir</em>}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          {!o.equiposCompletos ? (
            <div className="obr-actions obr-start">
              <span className="fin-warn-text fin-small"><i className="ri-error-warning-line"></i> Falta elegir el oficial y el peón de cada cuadrilla.</span>
              {editable && !noList ? <button type="button" className="fin-btn is-small" onClick={() => start(o.cuadrillas)}><i className="ri-team-line"></i>Elegir trabajadores</button> : null}
            </div>
          ) : editable && !noList ? (
            <div><button type="button" className="fin-btn is-ghost is-small" onClick={() => start(o.cuadrillas)}><i className="ri-team-line"></i>Cambiar trabajadores</button></div>
          ) : null}
          {noList ? <p className="fin-muted fin-small">No se pudo cargar la lista de trabajadores: no se pueden cambiar las cuadrillas.</p> : null}
        </>
      )}
    </div>
  );
}

// Workers whose puesto fits the role first, then everyone else; a worker
// already chosen in another place of this obra cannot be picked twice.
function WorkerSelect({ rol, value, trabajadores, taken, onChange, label }) {
  const fit = trabajadores.filter((w) => w.rol === rol), rest = trabajadores.filter((w) => w.rol !== rol);
  const opt = (w) => (
    <option key={w.id} value={w.id} disabled={taken.includes(w.id)}>
      {`${w.name}${w.puesto ? ` · ${w.puesto}` : ''}${w.otrasObras?.length ? ` · también en ${w.otrasObras.join(', ')}` : ''}`}
    </option>
  );
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} required className={value ? '' : 'is-empty'}>
      <option value="">{`Elige ${rol === 'oficial' ? 'el oficial' : 'el peón'}…`}</option>
      {fit.length ? <optgroup label={rol === 'oficial' ? 'Oficiales' : 'Peones'}>{fit.map(opt)}</optgroup> : null}
      {rest.length ? <optgroup label="Otros trabajadores">{rest.map(opt)}</optgroup> : null}
    </select>
  );
}

// Limitaciones the plan breaks now (from the server, recalculated with the
// draft). Those in an obra the draft changes block «Guardar»; the others are
// shown so they can be fixed, but do not stop saving another obra.
function Limitaciones({ list, touched }) {
  if (!list.length) return null;
  return (
    <div className="fin-warn obr-gantt-limits" role="status">
      <i className="ri-error-warning-line"></i>
      <div>
        <strong>{list.length === 1 ? 'La planificación no cumple una limitación' : `La planificación no cumple ${list.length} limitaciones`}</strong>
        <ul>
          {list.map((x, i) => (
            <li key={i}>
              <span className="obr-gantt-limit-tag">Sobreasignación</span> {x.mensaje}
              {touched.has(x.obraId) ? null : <span className="fin-muted"> (no impide guardar cambios de otras obras)</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Calendario laboral (backend: presupuestos/festivos.js): the festivos that
// count in this plan — the company's (national and Andalusian, an admin loads
// them by year) and this project's (local ones of the obra's municipio, rain
// days…, an admin or the jefe of one of its obras adds them). Every change
// recalculates the plan.
function Calendario({ data, projectId, readOnly, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const canProject = !readOnly && data.canEditFestivos, canCompany = !readOnly && data.canEditFestivosEmpresa;
  const y0 = +data.start.slice(0, 4), y1 = +data.end.slice(0, 4);
  const [form, setForm] = useState({ fecha: '', nombre: '', ambito: 'proyecto' });
  const [anio, setAnio] = useState(y0);
  const all = data.festivos || [];
  // By default: every festivo of this project (whatever its year — adding one
  // can push the plan into the next year, and it must stay removable) and the
  // company's of the years the plan spans. «Ver todos» lists the rest too.
  const [todos, setTodos] = useState(false);
  const inYears = (f) => +f.fecha.slice(0, 4) >= y0 && +f.fecha.slice(0, 4) <= y1;
  const shown = todos ? all : all.filter((f) => f.proyecto || inYears(f));
  const hidden = all.length - all.filter((f) => f.proyecto || inYears(f)).length;
  const inPlan = all.filter((f) => f.fecha >= data.start && f.fecha <= data.end).length;
  const companyYears = new Set(all.filter((f) => !f.proyecto).map((f) => +f.fecha.slice(0, 4)));
  const missingYears = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).filter((y) => !companyYears.has(y));

  const run = async (fn, ok) => {
    setBusy(true); setError(''); setDone('');
    let saved = false;
    try { const r = await fn(); setDone(typeof ok === 'function' ? ok(r) : ok); saved = true; await onChanged(); } catch (e) { setError(e.message); }
    setBusy(false);
    return saved;
  };
  const add = (e) => {
    e.preventDefault();
    const body = { fecha: form.fecha, nombre: form.nombre.trim(), ...(form.ambito === 'proyecto' || !canCompany ? { projectId } : {}) };
    run(() => api.addFestivo(body), `Festivo del ${fecha(body.fecha)} añadido.`).then((ok) => { if (ok) setForm((f) => ({ ...f, fecha: '', nombre: '' })); });
  };
  const remove = (f) => run(() => api.removeFestivo(f.id), `Festivo del ${fecha(f.fecha)} quitado.`);
  const cargar = () => run(() => api.cargarFestivos(anio, projectId), (r) => (r.anadidos ? `${r.anadidos} festivos de ${anio} añadidos.` : `Los festivos de ${anio} ya estaban.`));
  const canRemove = (f) => (f.proyecto ? canProject : canCompany);

  return (
    <div className="fin-card obr-gantt-cal">
      <button type="button" className="obr-gantt-cal-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}></i>
        <strong>Calendario laboral</strong>
        <span className="fin-muted fin-small">{`Lunes a viernes · ${inPlan} ${inPlan === 1 ? 'festivo' : 'festivos'} dentro de esta planificación`}</span>
        {missingYears.length ? <span className="fin-warn-text fin-small">{`Sin festivos de la empresa para ${missingYears.join(', ')}`}</span> : null}
      </button>
      {open ? (
        <div className="obr-gantt-cal-body">
          {shown.length ? (
            <ul className="obr-gantt-cal-list">
              {shown.map((f) => (
                <li key={f.id} className={f.fecha >= data.start && f.fecha <= data.end ? '' : 'fin-muted'}>
                  <span className="fin-nowrap">{fecha(f.fecha)}</span>
                  <span>{f.nombre}</span>
                  <span className={`obr-gantt-cal-tag${f.proyecto ? ' is-project' : ''}`}>{f.proyecto ? 'Este proyecto' : 'Empresa'}</span>
                  {canRemove(f) ? <button type="button" className="fin-btn is-ghost is-small" disabled={busy} onClick={() => remove(f)} aria-label={`Quitar el festivo del ${fecha(f.fecha)}`}><i className="ri-close-line"></i></button> : <span></span>}
                </li>
              ))}
            </ul>
          ) : <p className="fin-muted fin-small">{`No hay festivos en ${y0 === y1 ? y0 : `${y0}–${y1}`}: solo se descansan sábados y domingos.`}</p>}
          {hidden ? (
            <div>
              <button type="button" className="fin-btn is-ghost is-small" onClick={() => setTodos(!todos)}>
                {todos ? `Ver solo ${y0 === y1 ? y0 : `${y0}–${y1}`}` : `Ver todos los festivos (${hidden} de otros años)`}
              </button>
            </div>
          ) : null}
          {canProject || canCompany ? (
            <form className="obr-gantt-cal-form" onSubmit={add}>
              <input type="date" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} aria-label="Fecha del festivo" />
              <input type="text" required maxLength={120} placeholder="Nombre (p. ej. Feria de Málaga, lluvia…)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} aria-label="Nombre del festivo" />
              {canCompany && canProject ? (
                <select value={form.ambito} onChange={(e) => setForm({ ...form, ambito: e.target.value })} aria-label="Para quién es festivo">
                  <option value="proyecto">Solo este proyecto</option>
                  <option value="empresa">Toda la empresa</option>
                </select>
              ) : <span className="fin-muted fin-small">{canProject ? 'Solo este proyecto' : 'Toda la empresa'}</span>}
              <button type="submit" className="fin-btn is-small" disabled={busy}><i className="ri-add-line"></i>Añadir festivo</button>
            </form>
          ) : null}
          {canCompany ? (
            <div className="obr-actions obr-start">
              <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} aria-label="Año">
                {Array.from({ length: y1 - y0 + 2 }, (_, i) => y0 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button type="button" className="fin-btn is-small" disabled={busy} onClick={cargar}><i className="ri-calendar-check-line"></i>Cargar festivos de España y Andalucía</button>
            </div>
          ) : null}
          <p className="fin-muted fin-small">
            Los de la empresa son los nacionales y los de Andalucía; uno que cae en domingo pasa al lunes. Compruébalos con el calendario oficial del año (BOJA).
            {' '}Los festivos locales del municipio de la obra van en «Solo este proyecto».
          </p>
          {error ? <ErrorBox message={error} /> : null}
          {done ? <p className="fin-muted fin-small">{done}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Tabla({ tasks, hitos, readOnly, saving, changed, onSave }) {
  const index = useMemo(() => new Map(tasks.map((t, i) => [t.id, i + 1])), [tasks]);
  const label = (t) => (t.hito ? `◆ ${t.name}` : `${index.get(t.id)}. ${t.code ? `${t.code} · ` : ''}${t.name}`);
  const choices = useMemo(() => [...hitos.map((h) => ({ ...h, hito: true })), ...tasks], [hitos, tasks]);
  return (
    <>
      <h3 className="obr-h3">Tareas y predecesoras</h3>
      <div className="fin-card is-flush">
        <div className="fin-table-wrap">
          <table className="fin-table obr-gantt-table">
            <thead><tr><th>#</th><th>Partida</th><th className="fin-num">Cantidad</th><th className="fin-num">Rendimiento</th><th>Duración (días, 0,1)</th><th>Predecesoras · relación · desfase (días)</th><th>Inicio</th><th>Fin</th><th>Holgura</th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <Fila key={t.id} t={t} n={index.get(t.id)} tasks={choices} label={label} editable={!readOnly && t.canEdit} busy={saving === t.id} changed={changed?.has(t.id)} onSave={onSave} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// El agente (backend: presupuestos/ganttAgente.js) solo propone — no guarda
// nada él mismo. Aquí se revisa la propuesta (se puede quitar una a una) y
// lo que quede pasa al borrador del Gantt: se ve en el diagrama, se comprueban
// las limitaciones y se guarda con «Guardar», como un cambio hecho a mano.
function Sugerencias({ projectId, tasks, onStage }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null); // { tasks: [{id, predecessors}], considered, accepted, warnings }
  const [removed, setRemoved] = useState(new Set()); // `${tareaId}:${predId}` quitadas a mano antes de pasarlas
  const [done, setDone] = useState('');

  const index = useMemo(() => new Map(tasks.map((t, i) => [t.id, i + 1])), [tasks]);
  const label = (id) => { const t = tasks.find((x) => x.id === id); return t ? `${index.get(id)}. ${t.code ? `${t.code} · ` : ''}${t.name}` : '?'; };

  const generate = async () => {
    setLoading(true); setError(''); setProposal(null); setRemoved(new Set()); setDone('');
    try { setProposal(await api.ganttAgente(projectId)); } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const kept = (proposal?.tasks || [])
    .map((t) => ({ ...t, predecessors: t.predecessors.filter((p) => !removed.has(`${t.id}:${p.id}`)) }))
    .filter((t) => t.predecessors.length);
  const total = kept.reduce((a, t) => a + t.predecessors.length, 0);

  const pasar = () => {
    onStage(kept.map((t) => ({ id: t.id, predecessors: t.predecessors.map((p) => ({ id: p.id, type: p.type, lag: p.lag })) })));
    setDone(`${total} predecesora${total === 1 ? '' : 's'} en el borrador: revisa el Gantt y pulsa «Guardar».`);
    setProposal(null);
  };

  return (
    <div className="fin-card obr-gantt-agente">
      <div className="obr-actions obr-start">
        <button type="button" className="fin-btn" onClick={generate} disabled={loading}><i className="ri-magic-line"></i>{loading ? 'Pensando…' : 'Generar predecesoras con el agente'}</button>
        {proposal ? <span className="fin-muted fin-small">{`Propone ${proposal.accepted} relación${proposal.accepted === 1 ? '' : 'es'} de ${proposal.considered} que ha mirado.`}</span> : null}
        {done ? <span className="fin-muted fin-small">{done}</span> : null}
      </div>
      {error ? <ErrorBox message={error} /> : null}
      {proposal?.warnings?.length ? <ul className="obr-gantt-agente-warn fin-muted fin-small">{proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      {kept.length ? (
        <>
          <p className="fin-muted fin-small">Todavía no se ha guardado nada. Quita lo que no te cuadre y pasa el resto al borrador: se verá en el Gantt y se guarda con «Guardar» si cumple las limitaciones.</p>
          <ul className="obr-gantt-agente-list">
            {kept.flatMap((t) => t.predecessors.map((p) => (
              <li key={`${t.id}:${p.id}`}>
                <span>
                  <strong>{label(t.id)}</strong> espera a <strong>{label(p.id)}</strong>
                  {` · ${REL.find((r) => r[0] === p.type)?.[1]}`}{p.lag ? ` · ${p.lag > 0 ? '+' : ''}${p.lag} d` : ''}
                  {p.motivo ? <span className="fin-muted"> — {p.motivo}</span> : null}
                </span>
                <button type="button" className="fin-btn is-ghost is-small" onClick={() => setRemoved(new Set([...removed, `${t.id}:${p.id}`]))} aria-label="Quitar esta relación"><i className="ri-close-line"></i></button>
              </li>
            )))}
          </ul>
          <div className="obr-actions obr-start">
            <button type="button" className="fin-btn is-primary" onClick={pasar}>{`Pasar estas ${total} predecesora${total === 1 ? '' : 's'} al borrador`}</button>
            <button type="button" className="fin-btn is-ghost" onClick={() => setProposal(null)}>Descartar la propuesta</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Fila({ t, n, tasks, label, editable, busy, changed, onSave }) {
  const [dur, setDur] = useState(t.durationOverride ?? '');
  const [preds, setPreds] = useState(t.predecessors);
  useEffect(() => { setDur(t.durationOverride ?? ''); setPreds(t.predecessors); }, [t]);
  const commitDur = () => {
    const v = dur === '' ? null : Math.round(Number(String(dur).replace(',', '.')) * 10) / 10;
    if (v === (t.durationOverride ?? null)) return;
    onSave(t, { duration: v });
  };
  const change = (i, patch, now) => {
    const next = preds.map((p, k) => (k === i ? { ...p, ...patch } : p));
    setPreds(next);
    if (now) onSave(t, { predecessors: next });
  };
  const commitLag = () => { if (JSON.stringify(preds) !== JSON.stringify(t.predecessors)) onSave(t, { predecessors: preds }); };
  const used = new Set(preds.map((p) => p.id));
  const options = (current) => tasks.filter((x) => x.id !== t.id && (x.id === current || !used.has(x.id)));
  return (
    <tr className={[busy ? 'is-staged' : '', changed ? 'is-draft' : '', t.sobreasignada ? 'is-sobre' : ''].filter(Boolean).join(' ')}>
      <td className="fin-muted">{n}</td>
      <td style={t.nivel ? { paddingLeft: 12 + Math.min(t.nivel, 6) * 14 } : undefined}>{t.nivel ? <span className="fin-muted">↳ </span> : null}<strong>{`${t.code ? `${t.code} · ` : ''}${t.name}`}</strong><div className="fin-muted fin-small">{[t.presupuesto.ref, t.presupuesto.ampliacion ? 'ampliación' : null, t.chapter].filter(Boolean).join(' · ')}</div></td>
      <td className="fin-num fin-nowrap">{`${num(Number(t.quantity))} ${t.unit}`}</td>
      <td className="fin-num fin-nowrap">{t.rendimiento !== null ? `${num(t.rendimiento)} ${t.unit}/jornada` : <span className="fin-muted">—</span>}</td>
      <td className="fin-nowrap">
        {editable ? (
          <input type="number" min="0" step="0.1" className="obr-gantt-num" value={dur} placeholder={num(t.computedDuration ?? 1)}
            onChange={(e) => setDur(e.target.value)} onBlur={commitDur} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Duración en días laborables" />
        ) : <strong>{num(t.duration)}</strong>}
        <div className="fin-muted fin-small">{t.durationOverride != null ? `Base: ${t.computedDuration != null ? num(t.computedDuration) : '—'}` : t.computedDuration ? 'Según rendimiento' : <span className="obr-gantt-warn">Sin rendimiento</span>}</div>
      </td>
      <td>
        <div className="obr-gantt-preds">
          {preds.map((p, i) => (
            <div key={i} className="obr-gantt-pred">
              {editable ? (
                <>
                  <select value={p.id} onChange={(e) => change(i, { id: e.target.value, porDefecto: undefined }, !!e.target.value)} aria-label="Actividad predecesora" title={p.porDefecto ? 'Predecesora por defecto' : undefined}>
                    <option value="">Elige la predecesora…</option>
                    {options(p.id).map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
                  </select>
                  <select value={p.type} onChange={(e) => change(i, { type: e.target.value }, !!p.id)} aria-label="Relación">
                    {REL.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input type="number" step="1" className="obr-gantt-num" value={p.lag} onChange={(e) => change(i, { lag: e.target.value })} onBlur={commitLag}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Desfase en días laborables" title="Desfase en días laborables (negativo = solape)" />
                  <button type="button" className="fin-btn is-ghost is-small" onClick={() => { const next = preds.filter((_, k) => k !== i); setPreds(next); if (p.id) onSave(t, { predecessors: next }); }} aria-label="Quitar predecesora"><i className="ri-close-line"></i></button>
                  {p.porDefecto ? <span className="fin-muted fin-small obr-gantt-pred-default">por defecto</span> : null}
                </>
              ) : (
                <span className="fin-small">{`${label(tasks.find((x) => x.id === p.id) || { id: p.id, name: '?' })} · ${REL.find((r) => r[0] === p.type)?.[1]}${p.lag ? ` · ${p.lag > 0 ? '+' : ''}${p.lag} d` : ''}${p.porDefecto ? ' (por defecto)' : ''}`}</span>
              )}
            </div>
          ))}
          {editable && tasks.length > 1 && preds.length < tasks.length - 1 && !preds.some((p) => !p.id) ? (
            <button type="button" className="fin-btn is-ghost is-small" onClick={() => setPreds([...preds, { id: '', type: 'FS', lag: 0 }])}><i className="ri-add-line"></i>Predecesora</button>
          ) : null}
          {!editable && !preds.length ? <span className="fin-muted fin-small">Sin predecesora</span> : null}
        </div>
      </td>
      <td className="fin-nowrap">{fecha(t.start)}</td>
      <td className="fin-nowrap">{fecha(t.end)}</td>
      <td className="fin-nowrap" title={t.critical ? 'Si se retrasa, se retrasa el fin de la obra' : `Puede empezar hasta el ${fecha(t.lateStart)} sin retrasar el fin de la obra`}>
        {t.critical ? <span className="obr-gantt-crit-tag">Crítica</span> : <span>{dias(t.slack)}</span>}
        {!t.critical ? <div className="fin-muted fin-small" title="Lo que puede retrasarse sin mover ninguna sucesora">{`libre: ${dias(t.freeSlack)}`}</div> : null}
      </td>
    </tr>
  );
}

// The chart: one bar per task on calendar days (weekends shaded) — red with
// no predecessor, blue with one —, green up to its % de avance, arrows from
// each predecessor, today as a line.
function Chart({ data }) {
  const hitos = (data.hitos || []).map((h) => ({ ...h, hito: true, start: h.date, end: h.date, predecessors: [] }));
  const tasks = [...hitos, ...data.tasks];
  const DW = 22, RH = 30, HEAD = 44, LABEL = 280;
  const t0 = parse(data.start) - 2 * DAY;
  const days = Math.max(14, Math.round((parse(data.end) - t0) / DAY) + 5);
  const x = (s) => Math.round((parse(s) - t0) / DAY) * DW;
  const width = days * DW, height = HEAD + tasks.length * RH + 8;
  const row = new Map(tasks.map((t, i) => [t.id, i]));
  const today = new Date().toISOString().slice(0, 10);
  const scroller = useRef(null);
  const [showCrit, setShowCrit] = useState(true);
  const festivos = new Map((data.festivos || []).map((f) => [f.fecha, f.nombre]));
  const isCrit = (t) => showCrit && !t.hito && t.critical;
  useEffect(() => { // open on today when it falls inside the plan
    const el = scroller.current;
    if (el && today > data.start && today < data.end) el.scrollLeft = Math.max(0, x(today) - 120);
  }, [data.start, data.end]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(t0 + i * DAY), wd = d.getUTCDay(), iso = d.toISOString().slice(0, 10);
    cols.push({ i, day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), weekend: wd === 0 || wd === 6, festivo: wd !== 0 && wd !== 6 ? festivos.get(iso) || null : null });
  }
  const months = [];
  for (const c of cols) { const m = months[months.length - 1]; if (!m || m.month !== c.month) months.push({ month: c.month, year: c.year, from: c.i, n: 1 }); else m.n++; }

  const arrows = [];
  for (const t of tasks) {
    for (const p of t.predecessors) {
      if (p.porDefecto) continue; // «Inicio de obra» by default: one arrow per task would only clutter the chart
      const pt = tasks[row.get(p.id)];
      if (!pt) continue;
      const fromEnd = !pt.hito && (p.type === 'FS' || p.type === 'FF'), toEnd = p.type === 'FF' || p.type === 'SF';
      const xs = (k) => x(k.start) + (k.startAt || 0) * DW, xe = (k) => x(k.end) + (k.endAt ?? 1) * DW;
      const x1 = fromEnd ? xe(pt) : xs(pt), y1 = HEAD + row.get(pt.id) * RH + RH / 2;
      const x2 = toEnd ? xe(t) : xs(t), y2 = HEAD + row.get(t.id) * RH + RH / 2;
      const mid = toEnd ? Math.max(x1, x2) + 8 : Math.min(x1 + 8, x2 - 8);
      arrows.push({ key: `${p.id}-${t.id}`, d: `M${x1},${y1} H${mid} V${y2} H${x2}`, toEnd, crit: isCrit(t) && isCrit(pt) });
    }
  }
  return (
    <>
    <div className="obr-gantt-legend fin-small fin-muted">
      <span><i style={{ background: BAR.sinPredecesora }}></i>Sin predecesora</span>
      <span><i style={{ background: BAR.conPredecesora }}></i>Con predecesora</span>
      <span><i style={{ background: BAR.avance }}></i>Avance ejecutado</span>
      {data.tasks.some((t) => t.sobreasignada) ? <span><i className="obr-gantt-legend-sobre" style={{ borderColor: SOBRE }}></i>Sobreasignación (más tareas a la vez que cuadrillas)</span> : null}
      <span><b className="obr-gantt-legend-hito"></b>Inicio de obra (se puede elegir como predecesora)</span>
      <span><i style={{ background: FESTIVO, border: '1px solid #E9CFB4' }}></i>Festivo</span>
      <label className="obr-gantt-legend-toggle">
        <input type="checkbox" checked={showCrit} onChange={(e) => setShowCrit(e.target.checked)} />
        <i style={{ background: 'transparent', border: `2px solid ${CRIT}` }}></i>Resaltar la ruta crítica
      </label>
    </div>
    <div className="fin-card is-flush obr-gantt">
      <div className="obr-gantt-labels" style={{ width: LABEL }}>
        <div style={{ height: HEAD }} className="obr-gantt-labels-head">Tarea</div>
        {tasks.map((t, i) => (
          <div key={t.id} className="obr-gantt-label" style={{ height: RH }} title={`${t.code || ''} ${t.name}`}>
            {t.hito ? <><span className="fin-muted">◆</span> <strong>{t.name}</strong></>
              : <span style={{ paddingLeft: Math.min(t.nivel || 0, 6) * 12 }}>{t.sobreasignada ? <i className="ri-error-warning-fill obr-gantt-sobre-icon" aria-label="Sobreasignada"></i> : null}{t.nivel ? <span className="fin-muted">↳ </span> : null}<span className="fin-muted">{i + 1 - hitos.length}</span> {t.code ? <strong>{t.code}</strong> : null} {t.name}</span>}
          </div>
        ))}
      </div>
      <div className="obr-gantt-scroll" ref={scroller}>
        <svg width={width} height={height} role="img" aria-label={`Diagrama de Gantt: ${tasks.length} tareas del ${fecha(data.start)} al ${fecha(data.end)}`}>
          <defs>
            <marker id="obr-gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#8A8A86" /></marker>
            <marker id="obr-gantt-arrow-crit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill={CRIT} /></marker>
          </defs>
          {cols.map((c) => c.weekend ? <rect key={c.i} x={c.i * DW} y={HEAD} width={DW} height={height - HEAD} fill="#F4F4F1" />
            : c.festivo ? <rect key={c.i} x={c.i * DW} y={HEAD} width={DW} height={height - HEAD} fill={FESTIVO}><title>{`Festivo: ${c.festivo}`}</title></rect> : null)}
          {months.map((m) => (
            <g key={`${m.year}-${m.month}`}>
              <line x1={m.from * DW} x2={m.from * DW} y1={0} y2={height} stroke="#E6E6E1" />
              <text x={m.from * DW + 6} y={16} fontSize="12" fontWeight="700" fill="#3A3A38">{`${MONTHS[m.month]} ${m.year}`}</text>
            </g>
          ))}
          {cols.map((c) => <text key={c.i} x={c.i * DW + DW / 2} y={36} fontSize="10" textAnchor="middle" fill={c.weekend ? '#B0B0AB' : c.festivo ? '#C0702A' : '#6B6B68'}>{c.day}</text>)}
          <line x1={0} x2={width} y1={HEAD} y2={HEAD} stroke="#E6E6E1" />
          {tasks.map((t, i) => <line key={t.id} x1={0} x2={width} y1={HEAD + (i + 1) * RH} y2={HEAD + (i + 1) * RH} stroke="#F0F0EC" />)}
          {parse(today) >= t0 && parse(today) < t0 + days * DAY ? <line x1={x(today) + DW / 2} x2={x(today) + DW / 2} y1={HEAD - 6} y2={height} stroke="#D14A4A" strokeDasharray="3 3" /> : null}
          {arrows.filter((a) => !a.crit).map((a) => <path key={a.key} d={a.d} fill="none" stroke="#8A8A86" strokeWidth="1.2" markerEnd="url(#obr-gantt-arrow)" />)}
          {arrows.filter((a) => a.crit).map((a) => <path key={a.key} d={a.d} fill="none" stroke={CRIT} strokeWidth="1.6" markerEnd="url(#obr-gantt-arrow-crit)" />)}
          {tasks.map((t, i) => {
            if (t.hito) {
              const cx = x(t.start), cy = HEAD + i * RH + RH / 2, r = 7;
              return (
                <g key={t.id}>
                  <title>{`${t.name} · ${fecha(t.start)}`}</title>
                  <path d={`M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`} fill="#3A3A38" />
                </g>
              );
            }
            // startAt / endAt: where in its first / last day the task starts and
            // ends (tenths), so two tasks of 0,5 share one day.
            const bx = x(t.start) + (t.startAt || 0) * DW, bw = Math.max(2, x(t.end) + (t.endAt ?? 1) * DW - bx), by = HEAD + i * RH + 7, bh = RH - 14;
            const c = t.predecessors.length ? BAR.conPredecesora : BAR.sinPredecesora;
            const pct = Math.max(0, Math.min(100, Number(t.executionPct) || 0));
            const clip = `obr-gantt-clip-${i}`;
            return (
              <g key={t.id}>
                <title>{`${t.code ? `${t.code} · ` : ''}${t.name}\n${fecha(t.start)} → ${fecha(t.end)} · ${num(t.duration)} ${t.duration === 1 ? 'día' : 'días'} laborables · ${num(t.executionPct)} % ejecutado · ${t.predecessors.length ? `${t.predecessors.length} ${t.predecessors.length === 1 ? 'predecesora' : 'predecesoras'}` : 'sin predecesora'}\n${t.critical ? 'Crítica: sin holgura' : `Holgura ${dias(t.slack)} (libre ${dias(t.freeSlack)})`}${t.sobreasignada ? '\nSobreasignación: coincide con otras tareas y no hay cuadrillas para todas' : ''}`}</title>
                <clipPath id={clip}><rect x={bx} y={by} width={bw} height={bh} rx="4" /></clipPath>
                <g clipPath={`url(#${clip})`}>
                  <rect x={bx} y={by} width={bw} height={bh} fill={c} />
                  {pct > 0 ? <rect x={bx} y={by} width={bw * pct / 100} height={bh} fill={BAR.avance} /> : null}
                </g>
                {t.warning ? <rect x={bx + 0.5} y={by + 0.5} width={bw - 1} height={bh - 1} rx="4" fill="none" stroke="#3A3A38" strokeDasharray="3 2" /> : null}
                {isCrit(t) ? <rect x={bx - 1.5} y={by - 1.5} width={bw + 3} height={bh + 3} rx="5" fill="none" stroke={CRIT} strokeWidth="2.5" /> : null}
                {t.sobreasignada ? <rect x={bx - 3.5} y={by - 3.5} width={bw + 7} height={bh + 7} rx="5" fill="none" stroke={SOBRE} strokeWidth="2" strokeDasharray="4 3" /> : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
    </>
  );
}
