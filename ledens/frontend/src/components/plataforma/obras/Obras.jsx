import React, { useCallback, useEffect, useState } from 'react';
import { api, archivos, pctS } from './api.js';
import { eur } from '../finanzas/format.js';
import { Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';
import Detalle, { PhaseBadge, Progress } from './Detalle.jsx';
import Editor from './Editor.jsx';
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
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('todos');

  const countRef = React.useRef(onCount);
  countRef.current = onCount;
  const load = useCallback(() => api.list().then((d) => {
    setList(d.presupuestos); setError('');
    countRef.current?.(d.presupuestos.filter((p) => (panel === 'client' ? p.phase === 'pendiente' && p.decides !== false : p.phase === 'cambios')).length);
  }, (e) => setError(e.message)), [panel]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpen(null); setCreating(false); setImporting(false); }, [screen]);

  if (creating) return <div className="fin obr"><Editor mode="new" onCancel={() => setCreating(false)} onSaved={(d) => { setCreating(false); load(); toast?.('Borrador guardado'); setOpen({ id: d.id }); }} /></div>;
  if (importing) return <div className="fin obr"><PdfImport toast={toast} onCancel={() => setImporting(false)} onDone={(id) => { setImporting(false); load(); setOpen({ id }); }} /></div>;
  if (open) {
    return (
      <div className="fin obr">
        <Detalle key={open.id} id={open.id} initialTab={open.tab} initialEdit={open.edit && !readOnly} readOnly={readOnly} toast={toast}
          onBack={() => setOpen(null)} onChanged={load} onOpen={(id) => setOpen({ id })} />
      </div>
    );
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

  // Team (jefe de obra / admin): one table of everything they may act on.
  const FILTERS = [['todos', 'Todos', list], ['accion', 'Por hacer', by('borrador', 'cambios')], ['pendiente', 'Esperando al cliente', by('pendiente')], ['aprobado', 'Aprobados sin fecha', by('aprobado')], ['en_curso', 'Obras en curso', obras], ['rechazado', 'Rechazados', by('rechazado')]];
  const rows = (FILTERS.find((f) => f[0] === filter) || FILTERS[0])[2];
  return (
    <div className="fin obr">
      <div className="obr-head">
        <Head title={panel === 'admin' ? 'Presupuestos y obras' : screen === 'home' ? 'Hoy' : 'Obras asignadas'} text={panel === 'admin'
          ? 'Prepara presupuestos, envíalos al cliente, fija la fecha de inicio y sigue la producción de cada obra.'
          : 'Presupuestos y obras de los que eres responsable. Declara aquí la producción de cada partida.'} />
        {!readOnly ? (
          <div className="obr-actions">
            <button type="button" className="fin-btn" onClick={() => setCreating(true)}><i className="ri-add-line"></i>Nuevo presupuesto</button>
            <button type="button" className="fin-btn is-primary" onClick={() => setImporting(true)}><i className="ri-file-upload-line"></i>Subir PDF de presupuesto</button>
          </div>
        ) : null}
      </div>
      {screen === 'home' && obras.length ? <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} onClick={openP(p, 'obra')} team />)}</div> : null}
      <div className="fin-segmented">
        {FILTERS.map(([k, l, r]) => <button key={k} type="button" className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{`${l} · ${r.length}`}</button>)}
      </div>
      {rows.length ? (
        <div className="fin-card is-flush">
          <div className="fin-table-wrap">
            <table className="fin-table obr-click">
              <thead><tr><th>Presupuesto</th><th>Cliente</th><th>Jefe de obra</th><th>Estado</th><th className="fin-num">Total con IVA</th><th>Avance</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} onClick={openP(p, p.phase === 'en_curso' ? 'obra' : undefined)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openP(p, p.phase === 'en_curso' ? 'obra' : undefined)()}>
                    <td><strong>{p.title}</strong><div className="fin-muted fin-small">{`${p.ref} · v${p.version.number}${p.parent ? ` · ampliación de ${p.parent.ref}` : ''}`}</div></td>
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
      ) : <Empty icon="ri-file-list-3-line" title="Nada por aquí" text={panel === 'admin' ? 'Crea un presupuesto con «Nuevo presupuesto».' : 'Cuando un administrador te asigne un presupuesto u obra, aparecerá aquí.'} />}
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

function ObraCard({ p, onClick, team, cta }) {
  const { t, eur: money, fecha, pct } = useObrasI18n();
  const o = p.obra || { executionPct: 0, consumedPct: 0 };
  const started = p.startDate && p.startDate <= new Date().toISOString().slice(0, 10);
  return (
    <button type="button" className="fin-card obr-card" onClick={onClick}>
      <span className="obr-card-top"><PhaseBadge phase="en_curso" /><span className="fin-muted fin-small">{started ? t.since(fecha(p.startDate)) : t.startsOn(fecha(p.startDate))}</span></span>
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

// The budget PDF presented to the client: read it (text, else OCR), review it in
// the editor and send it; the original PDF is kept with the presupuesto.
function PdfImport({ onCancel, onDone, toast }) {
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
    return <Editor mode="new" initial={draft} onCancel={onCancel} onSaved={async (d, { send }) => {
      const notes = [];
      try { await archivos.upload(d.id, file, { title: 'Presupuesto original (PDF)' }); } catch (e) { notes.push(`el PDF original no se ha guardado (${e.message})`); }
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
