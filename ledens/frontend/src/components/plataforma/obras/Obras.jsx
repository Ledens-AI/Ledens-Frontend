import React, { useCallback, useEffect, useState } from 'react';
import { api, archivos } from './api.js';
import { Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';
import Detalle, { PhaseBadge, Progress } from './Detalle.jsx';
import Editor from './Editor.jsx';
import Propuestas from './Propuestas.jsx';
import { ObraCard, PresupuestosTable, ProjectsGrid, Proyecto } from './Proyectos.jsx';
import { useObrasI18n } from './i18n.js';
import '../../../styles/finanzas.css';
import '../../../styles/obras.css';

/* Presupuestos y obras in /plataforma, with real data from /api/presupuestos.
 * panel: 'client' | 'worker' (jefe de obra) | 'admin'; screen: 'home' |
 * 'presupuestos' | 'obras'. The server decides what each user sees.
 * The client screens follow the ES / EN switch (./i18n.js); the team table
 * is Spanish-only. */
export default function Obras({ panel, screen, readOnly, toast, firstName, onCount }) {
  const { t } = useObrasI18n();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // { id, tab }
  const [creating, setCreating] = useState(false); // true, or the project it starts in
  const [importing, setImporting] = useState(null); // the project the budget PDF is uploaded to
  const [filter, setFilter] = useState('todos');
  // Team «Presupuestos y obras»: by project (default) or every presupuesto; the project open.
  const [view, setView] = useState('proyectos');
  const [project, setProject] = useState(null);
  const [unlinked, setUnlinked] = useState(false);
  // Every project the team member may see (each one has its page, with or without presupuestos).
  const [projects, setProjects] = useState(null);
  useEffect(() => {
    if (panel === 'client' || screen !== 'presupuestos') return;
    api.projects().then((d) => setProjects(d.proyectos), () => setProjects(null));
  }, [panel, screen]);

  const countRef = React.useRef(onCount);
  countRef.current = onCount;
  const load = useCallback(() => api.list().then((d) => {
    setList(d.presupuestos); setError('');
    countRef.current?.(d.presupuestos.filter((p) => (panel === 'client' ? p.phase === 'pendiente' && p.decides !== false : p.phase === 'cambios')).length);
  }, (e) => setError(e.message)), [panel]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpen(null); setCreating(false); setImporting(null); setProject(null); }, [screen]);

  if (creating) return <div className="fin obr"><Editor mode="new" project={creating?.id ? creating : undefined} onCancel={() => setCreating(false)} onSaved={(d) => { setCreating(false); load(); toast?.('Borrador guardado'); setOpen({ id: d.id }); }} /></div>;
  if (importing) return <div className="fin obr"><PdfImport project={importing} toast={toast} onCancel={() => setImporting(null)} onDone={(id) => { setImporting(null); load(); setOpen({ id }); }} /></div>;
  if (screen === 'propuestas') return <Propuestas toast={toast} readOnly={readOnly} onCount={() => countRef.current?.()} />;
  if (open) {
    return (
      <div className="fin obr">
        <Detalle key={open.id} id={open.id} initialTab={open.tab} initialEdit={open.edit && !readOnly} readOnly={readOnly} toast={toast}
          onBack={() => setOpen(null)} onChanged={load} onOpen={(id) => setOpen({ id })} onOpenProject={(id) => { setOpen(null); setProject(id); }} />
      </div>
    );
  }
  if (project) {
    return <div className="fin obr"><Proyecto key={project} projectId={project} readOnly={readOnly} onNew={(pr) => setCreating(pr)} onImport={(pr) => setImporting(pr)} onBack={() => setProject(null)} onOpen={(p, tab) => setOpen({ id: p.id, tab })} /></div>;
  }
  if (error) return <div className="fin"><ErrorBox message={error} onRetry={load} retryLabel={t.retry} /></div>;
  if (!list) return <div className="fin fin-loading fin-muted">{t.loading}</div>;

  const by = (...phases) => list.filter((p) => phases.includes(p.phase));
  // Waiting for this client's decision: only the titular decides (invited clients follow).
  const mine = list.filter((p) => p.phase === 'pendiente' && p.decides !== false);
  const othersPending = list.filter((p) => p.phase === 'pendiente' && p.decides === false);
  const obras = list.filter((p) => p.phase === 'en_curso');
  const openP = (p, tab) => () => setOpen({ id: p.id, tab });

  if (panel === 'client') {
    if (screen === 'obras') {
      return (
        <div className="fin obr">
          <Head title={t.obrasTitle} text={t.obrasText} />
          {obras.length ? <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} onClick={openP(p, 'obra')} />)}</div>
            : <Empty icon="ri-building-2-line" title={t.noObras} text={t.noObrasText} />}
        </div>
      );
    }
    if (screen === 'home') {
      const pend = mine;
      return (
        <div className="fin obr">
          <Head title={t.hello(firstName)} text={t.homeText} />
          <div className="fin-kpis">
            <Kpi label={t.kWaiting} value={String(pend.length)} icon="ri-time-line" tone={pend.length ? 'warn' : undefined} />
            <Kpi label={t.kApproved} value={String(by('aprobado', 'en_curso').length)} icon="ri-checkbox-circle-line" />
            <Kpi label={t.kObras} value={String(obras.length)} icon="ri-building-2-line" />
          </div>
          {pend.length ? <Section title={t.secPending} rows={pend} onOpen={openP} client /> : null}
          <Section title={t.secPendingOther} hint={t.secPendingOtherHint} rows={othersPending} onOpen={openP} client />
          {obras.length ? <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} onClick={openP(p, 'obra')} />)}</div> : null}
          {!list.length ? <Empty icon="ri-file-list-3-line" title={t.noBudgets} text={t.noBudgetsHome} /> : null}
        </div>
      );
    }
    return (
      <div className="fin obr">
        <Head title={t.presuTitle} text={t.presuText} />
        {!list.length ? <Empty icon="ri-file-list-3-line" title={t.noBudgets} text={t.noBudgetsList} /> : null}
        <Section title={t.secPending} rows={mine} onOpen={openP} client />
        <Section title={t.secPendingOther} hint={t.secPendingOtherHint} rows={othersPending} onOpen={openP} client />
        <Section title={t.secReview} hint={t.secReviewHint} rows={by('cambios')} onOpen={openP} client />
        <Section title={t.secApproved} rows={by('aprobado', 'en_curso')} onOpen={openP} client />
        <Section title={t.secRejected} rows={by('rechazado')} onOpen={openP} client />
      </div>
    );
  }

  // Team: obras en curso, straight into updating the progress of each line.
  if (screen === 'avance') {
    return (
      <div className="fin obr">
        <Head title="Actualizar avance" text="Elige la obra y actualiza el avance de cada partida en %. El cliente lo ve al momento." />
        {obras.length ? <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} team cta={readOnly ? null : 'Actualizar avance'} onClick={() => setOpen({ id: p.id, tab: 'obra', edit: true })} />)}</div>
          : <Empty icon="ri-building-2-line" title="No hay obras en curso" text={panel === 'admin' ? 'Una obra aparece aquí cuando su presupuesto está aprobado y tiene fecha de inicio.' : 'Aquí verás las obras en curso de las que eres jefe de obra.'} />}
      </div>
    );
  }

  // Team (jefe de obra / admin): by project, or one table of everything they may act on.
  const FILTERS = [['todos', 'Todos', list], ['accion', 'Por hacer', by('borrador', 'cambios')], ['pendiente', 'Esperando al cliente', by('pendiente')], ['aprobado', 'Aprobados sin fecha', by('aprobado')], ['en_curso', 'Obras en curso', obras], ['rechazado', 'Rechazados', by('rechazado')]];
  const base = unlinked ? list.filter((p) => !p.project) : list;
  const filtered = FILTERS.map(([k, l, r]) => [k, l, unlinked ? r.filter((p) => !p.project) : r]);
  const rows = (filtered.find((f) => f[0] === filter) || filtered[0])[2];
  const byProject = screen !== 'home' && view === 'proyectos' && !unlinked;
  return (
    <div className="fin obr">
      <div className="obr-head">
        <Head title={panel === 'admin' ? 'Presupuestos y obras' : screen === 'home' ? 'Hoy' : 'Obras asignadas'} text={panel === 'admin'
          ? 'Cada obra va vinculada a un proyecto de Gestión financiera. Entra en un proyecto para ver sus presupuestos, el avance de obra, lo cobrado y los costes.'
          : 'Presupuestos y obras de los que eres responsable, por proyecto. Declara aquí la producción de cada partida.'} />
        {!readOnly ? (
          <div className="obr-actions">
            <button type="button" className="fin-btn" onClick={() => setCreating(true)}><i className="ri-add-line"></i>Nuevo presupuesto</button>
          </div>
        ) : null}
      </div>
      {screen === 'home' && obras.length ? <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} onClick={openP(p, 'obra')} team />)}</div> : null}
      {screen !== 'home' ? (
        <div className="fin-segmented" role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={byProject} className={byProject ? 'is-on' : ''} onClick={() => { setView('proyectos'); setUnlinked(false); }}><i className="ri-building-4-line"></i> Por proyecto</button>
          <button type="button" role="tab" aria-selected={!byProject} className={!byProject ? 'is-on' : ''} onClick={() => { setView('lista'); setUnlinked(false); }}><i className="ri-list-unordered"></i> Todos los presupuestos</button>
        </div>
      ) : null}
      {byProject ? (
        list.length || projects?.length ? <ProjectsGrid list={list} projects={projects} onOpenProject={setProject} onUnlinked={() => { setUnlinked(true); setFilter('todos'); }} />
          : <Empty icon="ri-building-4-line" title="Nada por aquí" text={panel === 'admin' ? 'Crea un presupuesto con «Nuevo presupuesto» y elige su proyecto.' : 'Cuando un administrador te asigne un presupuesto u obra, aparecerá aquí.'} />
      ) : (
        <>
          {unlinked ? <p className="fin-warn"><i className="ri-links-line"></i><span>{`${base.length} ${base.length === 1 ? 'presupuesto sin proyecto' : 'presupuestos sin proyecto'}. Abre la obra y usa «Vincular a un proyecto».`}</span></p> : null}
          <div className="fin-segmented">
            {filtered.map(([k, l, r]) => <button key={k} type="button" className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{`${l} · ${r.length}`}</button>)}
          </div>
          {rows.length ? <PresupuestosTable rows={rows} onOpen={(p, tab) => setOpen({ id: p.id, tab })} />
            : <Empty icon="ri-file-list-3-line" title="Nada por aquí" text={panel === 'admin' ? 'Crea un presupuesto con «Nuevo presupuesto».' : 'Cuando un administrador te asigne un presupuesto u obra, aparecerá aquí.'} />}
        </>
      )}
    </div>
  );
}

function Head({ title, text }) {
  return <div className="fin-page-head"><h1>{title}</h1>{text ? <p>{text}</p> : null}</div>;
}

function Section({ title, hint, rows, onOpen }) {
  const { t, eur: money, fecha } = useObrasI18n();
  if (!rows.length) return null;
  return (
    <section className="fin-stack">
      <h3 className="obr-h3">{`${title} · ${rows.length}`}</h3>
      {hint ? <p className="fin-muted obr-hint">{hint}</p> : null}
      <ul className="obr-list">
        {rows.map((p) => (
          <li key={p.id}>
            <button type="button" className="fin-card obr-row" onClick={onOpen(p, p.phase === 'en_curso' ? 'obra' : undefined)}>
              <span className="obr-row-main">
                <strong>{p.title}</strong>
                <span className="fin-muted fin-small">{[`${p.ref} · ${t.version} ${p.version.number}`, p.parent ? t.extensionOf(p.parent.ref) : null, p.address, p.version.sentAt ? t.sentOn(fecha(p.version.sentAt)) : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="obr-row-end">
                <PhaseBadge phase={p.phase} />
                <span className="obr-amount">{money(p.total)}<span className="fin-muted fin-small">{t.vatIncl}</span></span>
                <i className="ri-arrow-right-s-line" aria-hidden="true"></i>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The budget PDF presented to the client: read it (text, else OCR), review it in
// the editor and send it; the original PDF is kept with the presupuesto.
function PdfImport({ project, onCancel, onDone, toast }) {
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const read = async () => {
    setBusy(true); setError('');
    try { setDraft(await api.readPdf(file)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (draft) {
    return <Editor mode="new" initial={draft} project={project} sourceFile={file?.name} onCancel={onCancel} onSaved={async (d, { send }) => {
      const notes = [];
      // Files hang from the obra: an added presupuesto keeps its PDF there, under its reference.
      const title = d.parent ? `Presupuesto original (PDF) · ${d.ref}` : 'Presupuesto original (PDF)';
      try { await archivos.upload(d.parent?.id || d.id, file, { title }); } catch (e) { notes.push(`el PDF original no se ha guardado (${e.message})`); }
      let msg = 'Borrador guardado';
      if (send) { try { await api.send(d.id); msg = 'Presupuesto enviado: queda pendiente de que el cliente lo apruebe'; } catch (e) { msg = 'Guardado como borrador'; notes.push(`no se ha podido enviar (${e.message})`); } }
      toast?.(notes.length ? `${msg}; ${notes.join('; ')}` : msg);
      onDone(d.id);
    }} />;
  }
  return (
    <div className="fin-stack">
      <div className="fin-page-head">
        <h1>Subir PDF de presupuesto</h1>
        {project ? <p className="obr-project-line"><i className="ri-building-4-line" aria-hidden="true"></i><span>{'Proyecto '}<strong>{[project.code, project.name].filter(Boolean).join(' · ')}</strong></span></p> : null}
        <p>Sube el PDF que has presentado al cliente. Se leen capítulos, partidas, mediciones, precios e importes; lo revisas y se lo envías para que lo apruebe.</p>
      </div>
      {error ? <ErrorBox message={error} /> : null}
      <div className="fin-card fin-form">
        <label className="fin-field"><span>Presupuesto en PDF (máximo 20 MB)</span>
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }} />
        </label>
        {busy ? <p className="fin-muted">Leyendo el PDF… Si es un escaneo, el OCR puede tardar unos segundos.</p> : null}
        <div className="obr-actions obr-start">
          <button type="button" className="fin-btn" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className="fin-btn is-primary" onClick={read} disabled={busy || !file}><i className="ri-scan-2-line"></i>{busy ? 'Leyendo…' : 'Leer PDF'}</button>
        </div>
      </div>
    </div>
  );
}
