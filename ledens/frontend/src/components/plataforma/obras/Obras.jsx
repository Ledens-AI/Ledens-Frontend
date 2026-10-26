import React, { useCallback, useEffect, useState } from 'react';
import { api, pctS } from './api.js';
import { eur } from '../finanzas/format.js';
import { Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';
import Detalle, { PhaseBadge } from './Detalle.jsx';
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
  const [filter, setFilter] = useState('todos');

  const countRef = React.useRef(onCount);
  countRef.current = onCount;
  const load = useCallback(() => api.list().then((d) => {
    setList(d.presupuestos); setError('');
    countRef.current?.(d.presupuestos.filter((p) => (panel === 'client' ? p.phase === 'pendiente' : p.phase === 'cambios')).length);
  }, (e) => setError(e.message)), [panel]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpen(null); setCreating(false); }, [screen]);

  if (creating) return <div className="fin obr"><Editor mode="new" onCancel={() => setCreating(false)} onSaved={(d) => { setCreating(false); load(); toast?.('Borrador guardado'); setOpen({ id: d.id }); }} /></div>;
  if (open) {
    return (
      <div className="fin obr">
        <Detalle key={open.id} id={open.id} initialTab={open.tab} readOnly={readOnly} toast={toast}
          onBack={() => setOpen(null)} onChanged={load} onOpen={(id) => setOpen({ id })} />
      </div>
    );
  }
  if (error) return <div className="fin"><ErrorBox message={error} onRetry={load} retryLabel={t.retry} /></div>;
  if (!list) return <div className="fin fin-loading fin-muted">{t.loading}</div>;

  const by = (...phases) => list.filter((p) => phases.includes(p.phase));
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
      const pend = by('pendiente');
      return (
        <div className="fin obr">
          <Head title={t.hello(firstName)} text={t.homeText} />
          <div className="fin-kpis">
            <Kpi label={t.kWaiting} value={String(pend.length)} icon="ri-time-line" tone={pend.length ? 'warn' : undefined} />
            <Kpi label={t.kApproved} value={String(by('aprobado', 'en_curso').length)} icon="ri-checkbox-circle-line" />
            <Kpi label={t.kObras} value={String(obras.length)} icon="ri-building-2-line" />
          </div>
          {pend.length ? <Section title={t.secPending} rows={pend} onOpen={openP} client /> : null}
          {obras.length ? <div className="obr-cards">{obras.map((p) => <ObraCard key={p.id} p={p} onClick={openP(p, 'obra')} />)}</div> : null}
          {!list.length ? <Empty icon="ri-file-list-3-line" title={t.noBudgets} text={t.noBudgetsHome} /> : null}
        </div>
      );
    }
    return (
      <div className="fin obr">
        <Head title={t.presuTitle} text={t.presuText} />
        {!list.length ? <Empty icon="ri-file-list-3-line" title={t.noBudgets} text={t.noBudgetsList} /> : null}
        <Section title={t.secPending} rows={by('pendiente')} onOpen={openP} client />
        <Section title={t.secReview} hint={t.secReviewHint} rows={by('cambios')} onOpen={openP} client />
        <Section title={t.secApproved} rows={by('aprobado', 'en_curso')} onOpen={openP} client />
        <Section title={t.secRejected} rows={by('rechazado')} onOpen={openP} client />
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
        {panel === 'admin' && !readOnly ? <button type="button" className="fin-btn is-primary" onClick={() => setCreating(true)}><i className="ri-add-line"></i>Nuevo presupuesto</button> : null}
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

function ObraCard({ p, onClick, team }) {
  const { t, eur: money, fecha, pct } = useObrasI18n();
  const o = p.obra || { executionPct: 0, consumedPct: 0 };
  const started = p.startDate && p.startDate <= new Date().toISOString().slice(0, 10);
  return (
    <button type="button" className="fin-card obr-card" onClick={onClick}>
      <span className="obr-card-top"><PhaseBadge phase="en_curso" /><span className="fin-muted fin-small">{started ? t.since(fecha(p.startDate)) : t.startsOn(fecha(p.startDate))}</span></span>
      <strong className="obr-card-title">{p.title}</strong>
      <span className="fin-muted fin-small">{[p.ref, p.address, team ? p.client.name : p.jefe ? t.jefe(p.jefe.name) : null].filter(Boolean).join(' · ')}</span>
      <span className="obr-meter"><span>{t.execution}</span><strong>{pct(o.executionPct)}</strong></span>
      <span className="fin-progress obr-bar"><span style={{ width: Math.min(100, o.executionPct) + '%', background: '#5567AE' }}></span></span>
      <span className="obr-meter"><span>{t.consumed}</span><strong>{pct(o.consumedPct)}</strong></span>
      <span className="fin-progress obr-bar"><span style={{ width: Math.min(100, o.consumedPct) + '%', background: o.consumedPct > 100 ? '#D14A4A' : '#55A89D' }}></span></span>
      <span className="fin-muted fin-small">{p.obra ? t.ofExVat(money(p.obra.consumed), money(p.obra.base)) : ''}</span>
    </button>
  );
}
