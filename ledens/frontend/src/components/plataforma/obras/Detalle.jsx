import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, parseDecimal } from './api.js';
import { Badge, Dialog, Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';
import Editor from './Editor.jsx';
import Archivos from './Archivos.jsx';
import { useObrasI18n } from './i18n.js';

export const PhaseBadge = ({ phase }) => { const { PHASE } = useObrasI18n(); const p = PHASE[phase] || PHASE.borrador; return <Badge bg={p.bg} fg={p.fg} icon={p.icon}>{p.label}</Badge>; };
// 0–100 bar with the current value on it; values over 100 fill the bar and say so.
export function Progress({ value, color = '#5567AE', compact }) {
  const { pct } = useObrasI18n();
  const w = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className={'obr-progress' + (compact ? ' is-compact' : '')} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(value) || 0} aria-label={pct(value)}>
      <span className="obr-progress-value"><strong style={{ left: w + '%', color, transform: `translateX(-${w}%)` }}>{pct(value)}</strong></span>
      <span className="obr-progress-track"><span className="obr-progress-fill" style={{ width: w + '%', background: color }}></span></span>
      <span className="obr-progress-scale"><span>0</span><span>100</span></span>
    </span>
  );
}

/* One presupuesto: its versions, chapters and lines, the conversation and, once
 * approved, the obra (execution and consumed budget). What the user may do
 * comes from the server (`can`); readOnly is «Ver como». What the client sees
 * follows the ES / EN switch (./i18n.js); team-only actions stay in Spanish. */
export default function Detalle({ id, initialTab, initialEdit, readOnly, toast, onBack, onChanged, onOpen }) {
  const { t, eur, num, fecha, fechaHora, VSTATUS, KIND } = useObrasI18n();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(initialTab || 'presupuesto');
  const [versionId, setVersionId] = useState(null);
  const [editing, setEditing] = useState(null); // 'edit' | 'ampliacion'
  const [dialog, setDialog] = useState(null); // 'approve' | 'changes' | 'reject' | 'send'
  const [selected, setSelected] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback((v) => api.get(id, v).then((d) => { setDoc(d); setError(''); }, (e) => setError(e.message)), [id]);
  useEffect(() => { load(versionId); }, [load, versionId]);

  const act = async (fn, message) => {
    setBusy(true); setDialogError('');
    try {
      const d = await fn();
      setDoc(d); setVersionId(null); setDialog(null); setText(''); setSelected([]);
      toast?.(message); onChanged?.();
    } catch (e) { setDialogError(e.message); }
    setBusy(false);
  };

  if (error) return <div className="fin-stack"><BackLink onBack={onBack} /><ErrorBox message={error} onRetry={() => load(versionId)} retryLabel={t.retry} /></div>;
  if (!doc) return <div className="fin-loading fin-muted">{t.loadingDoc}</div>;
  if (editing) {
    return <Editor mode={editing} doc={editing === 'edit' ? doc : null} parent={doc}
      onCancel={() => setEditing(null)}
      onSaved={(d) => { setEditing(null); onChanged?.(); toast?.('Borrador guardado'); if (d.id !== doc.id) onOpen?.(d.id); else { setDoc(d); setVersionId(null); } }} />;
  }

  const v = doc.version;
  const can = readOnly ? {} : doc.can;
  // The editor always starts from the latest version, even when an older one is on screen.
  const editLatest = async () => {
    if (v.id !== doc.versions[0]?.id) {
      try { setDoc(await api.get(doc.id)); setVersionId(null); } catch (e) { setError(e.message); return; }
    }
    setEditing('edit');
  };
  const options = v.chapters.flatMap((c) => c.items).filter((i) => i.kind === 'decision' || i.kind === 'opcion');
  const optionalChosen = options.filter((i) => selected.includes(i.id)).reduce((a, i) => a + Number(i.amount), 0);
  // Photos and documents belong to the obra: an approved root presupuesto.
  const tabs = [['presupuesto', t.tabBudget], ...(doc.obra ? [['obra', t.tabObra], ['archivos', t.tabFiles]] : []), ['conversacion', t.tabChat(doc.comments.length)]];

  return (
    <div className="fin-stack obr">
      <BackLink onBack={onBack} />
      <div className="obr-head">
        <div className="fin-project-head">
          <span className="fin-muted">{`${doc.ref} · ${t.version} ${v.number}${doc.parent ? ` · ${t.extensionOf(doc.parent.ref)}` : ''}`}</span>
          <h2>{doc.title}</h2>
          <span className="fin-muted">{[doc.address, t.client(doc.client?.name || '—'), t.jefeOf(doc.jefe?.name)].filter(Boolean).join(' · ')}</span>
        </div>
        <PhaseBadge phase={doc.phase} />
      </div>
      {can.assignJefe ? <JefePicker doc={doc} busy={busy} onSave={(jefeId) => act(() => api.assignJefe(doc.id, { jefeId }), 'Jefe de obra actualizado')} /> : null}

      {doc.parent ? <p className="fin-warn"><i className="ri-information-line"></i><span>{t.extensionNoteA}<button type="button" className="fin-link" onClick={() => onOpen?.(doc.parent.id)}>{`${doc.parent.ref} · ${doc.parent.title}`}</button>{t.extensionNoteB}</span></p> : null}

      <div className="fin-segmented" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'presupuesto' ? (
        <>
          <TeamActions doc={doc} can={can} busy={busy} onEdit={editLatest} onSend={() => { setDialogError(''); setDialog('send'); }} onAmpliar={() => setEditing('ampliacion')} />
          {can.decide && v.status === 'sent' ? (
            <div className="fin-card obr-decide">
              <div>
                <h2>{t.decideTitle}</h2>
                <p className="fin-muted">{options.length ? t.decideOptions : t.decideNoOptions}</p>
              </div>
              <div className="obr-actions">
                <button type="button" className="fin-btn is-danger" onClick={() => { setDialogError(''); setDialog('reject'); }}>{t.reject}</button>
                <button type="button" className="fin-btn" onClick={() => { setDialogError(''); setDialog('changes'); }}><i className="ri-chat-3-line"></i>{t.askChanges}</button>
                <button type="button" className="fin-btn is-primary" onClick={() => { setDialogError(''); setDialog('approve'); }}><i className="ri-check-line"></i>{t.approve}</button>
              </div>
            </div>
          ) : null}
          {v.status === 'changes_requested' && !can.edit ? <p className="fin-warn"><i className="ri-chat-3-line"></i>{t.changesPending}</p> : null}
          {can.schedule ? <Schedule doc={doc} busy={busy} onSave={(body) => act(() => api.schedule(doc.id, body), 'Fechas de obra guardadas')} error={dialog === null ? dialogError : ''} /> : null}

          <div className="fin-kpis">
            <Kpi label={t.base} value={eur(v.base)} icon="ri-file-list-3-line" />
            <Kpi label={t.vat(v.vatRate)} value={eur(v.vat)} icon="ri-percent-line" />
            <Kpi label={t.total} value={eur(v.total)} icon="ri-money-euro-circle-line" />
            {Number(v.optionalBase) > 0 ? <Kpi label={v.status === 'approved' ? t.optNotChosen : t.optExVat} value={eur(v.optionalBase)} icon="ri-list-check-3" hint={t.optHint} /> : null}
          </div>

          {doc.versions.length > 1 ? (
            <div className="fin-filters">
              <label className="fin-field"><span>{t.versionLabel}</span>
                <select value={v.id} onChange={(e) => setVersionId(e.target.value)}>
                  {doc.versions.map((x) => <option key={x.id} value={x.id}>{`v${x.number} · ${VSTATUS[x.status]}${x.sentAt ? ` · ${fecha(x.sentAt)}` : ''} · ${eur(x.total)}`}</option>)}
                </select>
              </label>
            </div>
          ) : null}

          {v.chapters.length ? v.chapters.map((c, ci) => (
            <div className="fin-card is-flush" key={c.id}>
              <div className="obr-chapter-head"><h2>{`${ci + 1}. ${c.name}`}</h2><span className="fin-strong">{eur(c.base)}</span></div>
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead><tr><th>{t.hCode}</th><th>{t.hItem}</th><th>{t.hUnit}</th><th className="fin-num">{t.hQty}</th><th className="fin-num">{t.hPrice}</th><th className="fin-num">{t.hAmount}</th></tr></thead>
                  <tbody>
                    {c.items.map((i) => {
                      const optional = i.kind === 'decision' || i.kind === 'opcion';
                      return (
                        <tr key={i.id} className={!i.counted && !(can.decide && selected.includes(i.id)) ? 'obr-optional' : ''}>
                          <td className="fin-nowrap">{i.code || '—'}</td>
                          <td>
                            <div className="obr-line-name">
                              {can.decide && optional ? <input type="checkbox" aria-label={t.include(i.name)} checked={selected.includes(i.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))} /> : null}
                              <strong>{i.name}</strong>
                              {i.kind !== 'confirmada' ? <Badge bg={KIND[i.kind].bg} fg={KIND[i.kind].fg}>{i.selected ? `${KIND[i.kind].label} · ${t.chosen}` : KIND[i.kind].label}</Badge> : null}
                            </div>
                            {i.description ? <div className="fin-muted obr-desc">{i.description}</div> : null}
                          </td>
                          <td>{i.unit}</td>
                          <td className="fin-num">{num(i.quantity)}</td>
                          <td className="fin-num fin-nowrap">{eur(i.unitPrice)}</td>
                          <td className="fin-num fin-nowrap">{eur(i.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )) : <Empty icon="ri-file-list-3-line" title={t.noItems} text={t.noItemsText} />}
          {v.notes ? <div className="fin-card"><h3>{t.notes}</h3><p className="obr-pre">{v.notes}</p></div> : null}
          {doc.ampliaciones.length ? (
            <div className="fin-card">
              <div className="fin-card-head"><h2>{t.extensions}</h2></div>
              <ul className="obr-list">
                {doc.ampliaciones.map((a) => (
                  <li key={a.id}><button type="button" className="obr-row" onClick={() => onOpen?.(a.id)}>
                    <span><strong>{a.title}</strong><span className="fin-muted">{` · ${a.ref} v${a.version.number}`}</span></span>
                    <span className="obr-row-end"><PhaseBadge phase={a.phase} /><span className="fin-strong">{eur(a.total)}</span></span>
                  </button></li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'obra' && doc.obra ? <ObraTab doc={doc} can={can} busy={busy} autoEdit={initialEdit} onDeclare={(items) => act(() => api.declare(doc.id, { items }), 'Avance guardado')} error={dialogError} /> : null}

      {tab === 'archivos' && doc.obra ? <Archivos obraId={doc.id} readOnly={readOnly} toast={toast} /> : null}

      {tab === 'conversacion' ? (
        <div className="fin-card">
          {doc.comments.length ? (
            <ol className="obr-thread">
              {doc.comments.map((k) => (
                <li key={k.id} className={k.team ? 'is-team' : 'is-client'}>
                  <div className="fin-muted fin-small">{`${k.author || '—'} · ${fechaHora(k.at)}${k.versionNumber ? ` · v${k.versionNumber}` : ''}`}{k.kind === 'cambios' ? t.askedChanges : k.kind === 'rechazo' ? t.rejected : ''}</div>
                  <p className="obr-pre">{k.body}</p>
                </li>
              ))}
            </ol>
          ) : <Empty icon="ri-chat-3-line" title={t.noMessages} text={t.noMessagesText} />}
          {can.comment ? (
            <div className="fin-form obr-mt">
              <label className="fin-field"><span>{t.writeMessage}</span><textarea rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} /></label>
              {dialogError && !dialog ? <span className="fin-error-inline">{dialogError}</span> : null}
              <div><button type="button" className="fin-btn is-primary" disabled={busy || !text.trim()} onClick={() => act(() => api.comment(doc.id, { body: text }), t.messageSent)}><i className="ri-send-plane-line"></i>{t.send}</button></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {dialog === 'approve' ? (
        <Dialog title={t.approveTitle} onClose={() => setDialog(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setDialog(null)}>{t.cancel}</button>
          <button type="button" className="fin-btn is-primary" disabled={busy} onClick={() => act(() => api.approve(doc.id, { versionId: v.id, selected }), t.approvedToast)}>{t.approve}</button></>}>
          <p>{t.approveIntro(v.number, doc.ref)}</p>
          <dl className="fin-dl">
            <dt>{t.base}</dt><dd>{eur(Number(v.base) + optionalChosen)}</dd>
            <dt>{t.vat(v.vatRate)}</dt><dd>{eur(Math.round((Number(v.base) + optionalChosen) * Number(v.vatRate)) / 100)}</dd>
            <dt>{t.total}</dt><dd className="fin-strong">{eur(Number(v.base) + optionalChosen + Math.round((Number(v.base) + optionalChosen) * Number(v.vatRate)) / 100)}</dd>
            {options.length ? <><dt>{t.chosenOptions}</dt><dd>{selected.length ? options.filter((o) => selected.includes(o.id)).map((o) => o.name).join(', ') : t.none}</dd></> : null}
          </dl>
          <p className="fin-muted">{t.approveNote}</p>
          {dialogError ? <span className="fin-error-inline">{dialogError}</span> : null}
        </Dialog>
      ) : null}
      {dialog === 'changes' || dialog === 'reject' ? (
        <Dialog title={dialog === 'changes' ? t.changesTitle : t.rejectTitle} onClose={() => setDialog(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setDialog(null)}>{t.cancel}</button>
          <button type="button" className={'fin-btn ' + (dialog === 'reject' ? 'is-danger' : 'is-primary')} disabled={busy || (dialog === 'changes' && !text.trim())}
            onClick={() => act(() => (dialog === 'changes' ? api.requestChanges : api.reject)(doc.id, { versionId: v.id, body: text }), dialog === 'changes' ? t.changesSent : t.rejectedToast)}>
            {dialog === 'changes' ? t.sendComments : t.reject}</button></>}>
          <p>{dialog === 'changes' ? t.changesIntro : t.rejectIntro}</p>
          <label className="fin-field"><span>{dialog === 'changes' ? t.comments : t.reasonOpt}</span><textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} /></label>
          {dialogError ? <span className="fin-error-inline">{dialogError}</span> : null}
        </Dialog>
      ) : null}
      {dialog === 'send' ? (
        <Dialog title="Enviar al cliente" onClose={() => setDialog(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setDialog(null)}>Cancelar</button>
          <button type="button" className="fin-btn is-primary" disabled={busy} onClick={() => act(() => api.send(doc.id), 'Presupuesto enviado al cliente')}><i className="ri-send-plane-line"></i>Enviar</button></>}>
          <p>{`${doc.client?.name || 'El cliente'} verá la versión ${doc.versions[0]?.number} en su área de cliente y podrá aprobarla, pedir cambios o rechazarla.`}</p>
          {doc.versions.length > 1 ? <p className="fin-muted">La versión anterior quedará como sustituida.</p> : null}
          {dialogError ? <span className="fin-error-inline">{dialogError}</span> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function BackLink({ onBack }) {
  const { t } = useObrasI18n();
  return <div><button type="button" className="fin-btn is-ghost is-small" onClick={onBack}><i className="ri-arrow-left-line"></i>{t.back}</button></div>;
}

// Team only (edit, send, extend): Spanish.
function TeamActions({ doc, can, busy, onEdit, onSend, onAmpliar }) {
  if (!can.edit && !can.send && !can.ampliar) return null;
  const last = doc.versions[0];
  return (
    <div className="fin-card obr-decide">
      <div>
        <h2>{last.status === 'draft' ? `Borrador de la versión ${last.number}` : last.status === 'changes_requested' ? 'El cliente ha pedido cambios' : last.status === 'sent' ? 'Enviado: esperando al cliente' : 'Presupuesto aprobado'}</h2>
        <p className="fin-muted">{last.status === 'draft' ? 'El cliente no lo ve hasta que lo envíes.' : last.status === 'changes_requested' ? 'Lee sus comentarios en «Conversación», edita el presupuesto y envía la versión nueva.' : last.status === 'sent' ? 'Si lo editas, preparas una versión nueva que sustituirá a esta al enviarla.' : 'Si el cliente pide trabajos nuevos, prepárale una ampliación.'}</p>
      </div>
      <div className="obr-actions">
        {can.ampliar ? <button type="button" className="fin-btn" onClick={onAmpliar} disabled={busy}><i className="ri-add-line"></i>Nueva ampliación</button> : null}
        {can.edit ? <button type="button" className="fin-btn" onClick={onEdit} disabled={busy}><i className="ri-edit-2-line"></i>{last.status === 'draft' ? 'Editar borrador' : 'Preparar nueva versión'}</button> : null}
        {can.send ? <button type="button" className="fin-btn is-primary" onClick={onSend} disabled={busy}><i className="ri-send-plane-line"></i>Enviar al cliente</button> : null}
      </div>
    </div>
  );
}

// Team only (set the dates): Spanish.
function Schedule({ doc, busy, onSave, error }) {
  const [start, setStart] = useState(doc.startDate || '');
  const [end, setEnd] = useState(doc.endDate || '');
  return (
    <div className="fin-card">
      <div className="fin-card-head"><h2>{doc.startDate ? 'Fechas de la obra' : 'Asignar fecha de inicio'}</h2></div>
      <p className="fin-muted obr-mb">{doc.startDate ? 'El cliente ve la obra en «Obra en curso».' : 'Al guardar la fecha de inicio, el cliente verá la obra en «Obra en curso» y el jefe de obra podrá declarar la producción.'}</p>
      <div className="fin-filters">
        <label className="fin-field"><span>Inicio</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="fin-field"><span>Fin previsto (opcional)</span><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button type="button" className="fin-btn is-primary" disabled={busy || !start} onClick={() => onSave({ startDate: start, endDate: end || null })}>Guardar fechas</button>
      </div>
      {error ? <span className="fin-error-inline">{error}</span> : null}
    </div>
  );
}

// Admins: who is in charge of the obra (team-only, in Spanish).
function JefePicker({ doc, busy, onSave }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState(null);
  const [value, setValue] = useState(doc.jefe?.id || '');
  const [error, setError] = useState('');
  const show = () => { setOpen(true); setValue(doc.jefe?.id || ''); if (!opts) api.options().then((o) => setOpts(o.jefes), (e) => setError(e.message)); };
  if (!open) return <div><button type="button" className="fin-btn is-small" onClick={show}><i className="ri-user-settings-line"></i>{doc.jefe ? 'Cambiar jefe de obra' : 'Asignar jefe de obra'}</button></div>;
  return (
    <div className="fin-filters">
      <label className="fin-field"><span>Jefe de obra</span>
        <select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{opts ? 'Sin asignar' : 'Cargando…'}</option>
          {(opts || []).map((j) => <option key={j.id} value={j.id}>{`${j.name} · ${j.email}`}</option>)}
        </select>
      </label>
      <button type="button" className="fin-btn" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" disabled={busy || !opts} onClick={() => { setOpen(false); onSave(value || null); }}>Guardar</button>
      {error ? <span className="fin-error-inline">{error}</span> : null}
    </div>
  );
}

// Progress of a line as an editable percentage; a declared excess (over 100 %) is kept.
const pctOf = (i) => Math.round(Number(i.executed) / Number(i.quantity) * 10000) / 100;
const pctText = (n) => String(n).replace('.', ',');

function ObraTab({ doc, can, busy, onDeclare, error, autoEdit }) {
  const { t, eur, num, fecha, fechaHora } = useObrasI18n();
  const o = doc.obra;
  const items = o.chapters.flatMap((c) => c.items);
  const initial = () => Object.fromEntries(items.map((i) => [i.id, pctText(pctOf(i))]));
  const [editing, setEditing] = useState(!!(autoEdit && can.declare));
  const [values, setValues] = useState(initial);
  const [localError, setLocalError] = useState('');
  const startEdit = () => { setValues(initial()); setLocalError(''); setEditing(true); };
  // A save changes the executed quantities: leave editing then (a reload with the same figures keeps it).
  const signature = items.map((i) => `${i.id}:${i.executed}`).join('|');
  const shown = useRef(signature);
  useEffect(() => { if (shown.current !== signature) { shown.current = signature; setEditing(false); } }, [signature]);
  const setPct = (id, v) => setValues((s) => ({ ...s, [id]: v }));
  const save = () => {
    const out = [];
    const before = initial();
    for (const i of items) {
      if (values[i.id] === before[i.id]) continue;
      const p = parseDecimal(values[i.id], 2);
      if (p === null || Number(p) > 1000) return setLocalError(`Avance no válido en «${i.name}» (de 0 a 100 %)`);
      out.push({ partidaId: i.id, executed: (Math.round(Number(i.quantity) * Number(p) / 100 * 10000) / 10000).toFixed(4) });
    }
    if (!out.length) { setEditing(false); return; }
    onDeclare(out);
  };
  if (!o.startDate) {
    return <Empty icon="ri-calendar-line" title={t.noStart} text={t.noStartText} />;
  }
  // Updating the progress is a team action (Spanish only, like the other team actions).
  const actions = can.declare ? (
    <div className="obr-actions obr-start">
      {editing ? (<>
        <button type="button" className="fin-btn" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" onClick={save} disabled={busy}><i className="ri-save-line"></i>{busy ? 'Guardando…' : 'Guardar avance'}</button>
      </>) : <button type="button" className="fin-btn is-primary" onClick={startEdit}><i className="ri-edit-2-line"></i>Actualizar avance</button>}
      {localError || error ? <span className="fin-error-inline">{localError || error}</span> : null}
    </div>
  ) : null;
  return (
    <div className="fin-stack">
      <div className="fin-kpis">
        <div className="fin-kpi"><span className="fin-kpi-label"><i className="ri-hammer-line"></i>{t.execution}</span><Progress value={o.executionPct} color="#5567AE" /><span className="fin-kpi-hint">{t.executed(eur(o.executedAmount))}</span></div>
        <div className="fin-kpi"><span className="fin-kpi-label"><i className="ri-pie-chart-line"></i>{t.consumed}</span><Progress value={o.consumedPct} color={o.consumedPct > 100 ? '#D14A4A' : '#55A89D'} /><span className="fin-kpi-hint">{t.ofExVat(eur(o.consumed), eur(o.base))}</span></div>
        <Kpi label={t.current} value={eur(o.total)} icon="ri-money-euro-circle-line" hint={t.currentHint(eur(o.base), eur(o.vat), doc.ampliaciones.some((a) => a.phase === 'aprobado'))} />
        <Kpi label={t.dates} value={fecha(o.startDate)} icon="ri-calendar-line" hint={o.endDate ? t.plannedEnd(fecha(o.endDate)) : t.noEnd} />
      </div>
      <p className="fin-muted fin-small">{t.obraExplain}</p>
      {actions}
      {editing ? <p className="fin-warn"><i className="ri-information-line"></i>Indica el avance de cada partida de 0 a 100 %. Solo se guardan las que cambies, y el cliente lo verá al momento.</p> : null}
      {o.chapters.map((c) => (
        <div className="fin-card is-flush" key={c.id}>
          <div className="obr-chapter-head">
            <div><h2>{c.name}</h2>{c.presupuesto.ampliacion ? <span className="fin-muted fin-small">{t.extension(c.presupuesto.ref)}</span> : null}</div>
            <div className="obr-chapter-figs">
              <span>{t.execution}<Progress value={c.executionPct} color="#5567AE" compact /></span>
              <span>{t.chConsumedOf(eur(c.consumed), eur(c.base))}<Progress value={c.consumedPct} color={c.consumedPct > 100 ? '#D14A4A' : '#55A89D'} compact /></span>
            </div>
          </div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>{t.hCode}</th><th>{t.hItem}</th><th className="fin-num">{t.hBudgeted}</th><th className="fin-num">{t.hExecuted}</th><th className="obr-col-avance">{t.hProgress}</th><th className="fin-num">{t.hPrice}</th><th className="fin-num">{t.hConsumed}</th></tr></thead>
              <tbody>
                {c.items.map((i) => {
                  const p = parseDecimal(values[i.id], 2);
                  return (
                    <tr key={i.id}>
                      <td className="fin-nowrap">{i.code || '—'}</td>
                      <td><strong>{i.name}</strong>{i.lastDeclared ? <div className="fin-muted fin-small">{i.lastDeclared.by ? `${t.declaredBy(i.lastDeclared.by, fechaHora(i.lastDeclared.at))}${i.lastDeclared.note ? ` · ${i.lastDeclared.note}` : ''}` : (i.lastDeclared.note || t.imported)}</div> : null}</td>
                      <td className="fin-num fin-nowrap">{`${num(i.quantity)} ${i.unit}`}</td>
                      <td className="fin-num fin-nowrap">
                        {editing ? (p === null ? '—' : `${num(Number(i.quantity) * Number(p) / 100)} ${i.unit}`) : `${num(i.executed)} ${i.unit}`}
                        {i.excess && !editing ? <div className="fin-danger fin-small">{t.excess}</div> : null}
                      </td>
                      <td className="obr-col-avance">
                        {editing ? (
                          <span className="obr-pct-edit">
                            <input type="range" min="0" max="100" step="1" aria-label={`Avance de ${i.name}`} value={Math.min(100, Number(p ?? 0))} onChange={(e) => setPct(i.id, e.target.value)} />
                            <span className="obr-pct-input"><input aria-label={`Avance de ${i.name} en %`} inputMode="decimal" className={'obr-in obr-in-pct' + (p === null ? ' is-invalid' : '')} value={values[i.id] ?? ''} onChange={(e) => setPct(i.id, e.target.value)} />%</span>
                          </span>
                        ) : <Progress value={i.executionPct} color={i.executionPct >= 100 ? '#55A89D' : '#5567AE'} compact />}
                      </td>
                      <td className="fin-num fin-nowrap">{eur(i.unitPrice)}</td>
                      <td className="fin-num fin-nowrap">{eur(i.consumed)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {editing ? actions : null}
    </div>
  );
}
