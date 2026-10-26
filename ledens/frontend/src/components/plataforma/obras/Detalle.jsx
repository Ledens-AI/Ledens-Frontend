import React, { useCallback, useEffect, useState } from 'react';
import { api, PHASE, VSTATUS, KIND, parseDecimal, pctS } from './api.js';
import { eur, num, fecha, fechaHora } from '../finanzas/format.js';
import { Badge, Dialog, Empty, ErrorBox, Kpi } from '../finanzas/ui.jsx';
import Editor from './Editor.jsx';
import Archivos from './Archivos.jsx';

export const PhaseBadge = ({ phase }) => { const p = PHASE[phase] || PHASE.borrador; return <Badge bg={p.bg} fg={p.fg} icon={p.icon}>{p.label}</Badge>; };
const Bar = ({ value, color }) => <span className="fin-progress obr-bar"><span style={{ width: Math.min(100, value) + '%', background: color }}></span></span>;

/* One presupuesto: its versions, chapters and lines, the conversation and, once
 * approved, the obra (execution and consumed budget). What the user may do
 * comes from the server (`can`); readOnly is «Ver como». */
export default function Detalle({ id, initialTab, readOnly, toast, onBack, onChanged, onOpen }) {
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

  if (error) return <div className="fin-stack"><BackLink onBack={onBack} /><ErrorBox message={error} onRetry={() => load(versionId)} /></div>;
  if (!doc) return <div className="fin-loading fin-muted">Cargando presupuesto…</div>;
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
  const tabs = [['presupuesto', 'Presupuesto'], ...(doc.obra ? [['obra', 'Obra en curso'], ['archivos', 'Fotos y documentos']] : []), ['conversacion', `Conversación${doc.comments.length ? ` (${doc.comments.length})` : ''}`]];

  return (
    <div className="fin-stack obr">
      <BackLink onBack={onBack} />
      <div className="obr-head">
        <div className="fin-project-head">
          <span className="fin-muted">{`${doc.ref} · versión ${v.number}${doc.parent ? ` · ampliación de ${doc.parent.ref}` : ''}`}</span>
          <h2>{doc.title}</h2>
          <span className="fin-muted">{[doc.address, `Cliente: ${doc.client?.name || '—'}`, `Jefe de obra: ${doc.jefe?.name || 'sin asignar'}`].filter(Boolean).join(' · ')}</span>
        </div>
        <PhaseBadge phase={doc.phase} />
      </div>

      {doc.parent ? <p className="fin-warn"><i className="ri-information-line"></i><span>{'Ampliación de la obra '}<button type="button" className="fin-link" onClick={() => onOpen?.(doc.parent.id)}>{`${doc.parent.ref} · ${doc.parent.title}`}</button>{'. Se aprueba por separado y, al aprobarla, suma al presupuesto de la obra.'}</span></p> : null}

      <div className="fin-segmented" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'presupuesto' ? (
        <>
          <TeamActions doc={doc} can={can} busy={busy} onEdit={editLatest} onSend={() => { setDialogError(''); setDialog('send'); }} onAmpliar={() => setEditing('ampliacion')} />
          {can.decide && v.status === 'sent' ? (
            <div className="fin-card obr-decide">
              <div>
                <h2>Este presupuesto espera tu decisión</h2>
                <p className="fin-muted">{options.length ? 'Marca en la tabla las opciones que quieras incluir y elige qué hacer.' : 'Revísalo y elige qué hacer. Si algo no te encaja, pide cambios y te enviaremos una versión nueva.'}</p>
              </div>
              <div className="obr-actions">
                <button type="button" className="fin-btn is-danger" onClick={() => { setDialogError(''); setDialog('reject'); }}>Rechazar</button>
                <button type="button" className="fin-btn" onClick={() => { setDialogError(''); setDialog('changes'); }}><i className="ri-chat-3-line"></i>Pedir cambios</button>
                <button type="button" className="fin-btn is-primary" onClick={() => { setDialogError(''); setDialog('approve'); }}><i className="ri-check-line"></i>Aprobar</button>
              </div>
            </div>
          ) : null}
          {v.status === 'changes_requested' && !can.edit ? <p className="fin-warn"><i className="ri-chat-3-line"></i>Has pedido cambios. El equipo está preparando una versión nueva; la verás aquí cuando te la envíe.</p> : null}
          {can.schedule ? <Schedule doc={doc} busy={busy} onSave={(body) => act(() => api.schedule(doc.id, body), 'Fechas de obra guardadas')} error={dialog === null ? dialogError : ''} /> : null}

          <div className="fin-kpis">
            <Kpi label="Base imponible" value={eur(v.base)} icon="ri-file-list-3-line" />
            <Kpi label={`IVA ${v.vatRate.replace('.', ',')} %`} value={eur(v.vat)} icon="ri-percent-line" />
            <Kpi label="Total con IVA" value={eur(v.total)} icon="ri-money-euro-circle-line" />
            {Number(v.optionalBase) > 0 ? <Kpi label={v.status === 'approved' ? 'Opciones no elegidas' : 'Opciones (sin IVA)'} value={eur(v.optionalBase)} icon="ri-list-check-3" hint="Solo suman si se eligen al aprobar" /> : null}
          </div>

          {doc.versions.length > 1 ? (
            <div className="fin-filters">
              <label className="fin-field"><span>Versión</span>
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
                  <thead><tr><th>Código</th><th>Partida</th><th>Unidad</th><th className="fin-num">Cantidad</th><th className="fin-num">Precio</th><th className="fin-num">Importe</th></tr></thead>
                  <tbody>
                    {c.items.map((i) => {
                      const optional = i.kind === 'decision' || i.kind === 'opcion';
                      return (
                        <tr key={i.id} className={!i.counted && !(can.decide && selected.includes(i.id)) ? 'obr-optional' : ''}>
                          <td className="fin-nowrap">{i.code || '—'}</td>
                          <td>
                            <div className="obr-line-name">
                              {can.decide && optional ? <input type="checkbox" aria-label={`Incluir ${i.name}`} checked={selected.includes(i.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))} /> : null}
                              <strong>{i.name}</strong>
                              {i.kind !== 'confirmada' ? <Badge bg={KIND[i.kind].bg} fg={KIND[i.kind].fg}>{i.selected ? `${KIND[i.kind].label} · elegida` : KIND[i.kind].label}</Badge> : null}
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
          )) : <Empty icon="ri-file-list-3-line" title="Sin partidas" text="Edita el borrador para añadir capítulos y partidas." />}
          {v.notes ? <div className="fin-card"><h3>Condiciones y exclusiones</h3><p className="obr-pre">{v.notes}</p></div> : null}
          {doc.ampliaciones.length ? (
            <div className="fin-card">
              <div className="fin-card-head"><h2>Ampliaciones</h2></div>
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

      {tab === 'obra' && doc.obra ? <ObraTab doc={doc} can={can} busy={busy} onDeclare={(items) => act(() => api.declare(doc.id, { items }), 'Producción guardada')} error={dialogError} /> : null}

      {tab === 'archivos' && doc.obra ? <Archivos obraId={doc.id} readOnly={readOnly} toast={toast} /> : null}

      {tab === 'conversacion' ? (
        <div className="fin-card">
          {doc.comments.length ? (
            <ol className="obr-thread">
              {doc.comments.map((k) => (
                <li key={k.id} className={k.team ? 'is-team' : 'is-client'}>
                  <div className="fin-muted fin-small">{`${k.author || '—'} · ${fechaHora(k.at)}${k.versionNumber ? ` · v${k.versionNumber}` : ''}`}{k.kind === 'cambios' ? ' · pidió cambios' : k.kind === 'rechazo' ? ' · rechazó' : ''}</div>
                  <p className="obr-pre">{k.body}</p>
                </li>
              ))}
            </ol>
          ) : <Empty icon="ri-chat-3-line" title="Sin mensajes" text="Las preguntas y los cambios pedidos sobre este presupuesto aparecerán aquí." />}
          {can.comment ? (
            <div className="fin-form obr-mt">
              <label className="fin-field"><span>Escribe un mensaje</span><textarea rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} /></label>
              {dialogError && !dialog ? <span className="fin-error-inline">{dialogError}</span> : null}
              <div><button type="button" className="fin-btn is-primary" disabled={busy || !text.trim()} onClick={() => act(() => api.comment(doc.id, { body: text }), 'Mensaje enviado')}><i className="ri-send-plane-line"></i>Enviar</button></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {dialog === 'approve' ? (
        <Dialog title="Aprobar presupuesto" onClose={() => setDialog(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setDialog(null)}>Cancelar</button>
          <button type="button" className="fin-btn is-primary" disabled={busy} onClick={() => act(() => api.approve(doc.id, { versionId: v.id, selected }), 'Presupuesto aprobado')}>Aprobar</button></>}>
          <p>{`Apruebas la versión ${v.number} de ${doc.ref}.`}</p>
          <dl className="fin-dl">
            <dt>Base imponible</dt><dd>{eur(Number(v.base) + optionalChosen)}</dd>
            <dt>{`IVA ${v.vatRate.replace('.', ',')} %`}</dt><dd>{eur(Math.round((Number(v.base) + optionalChosen) * Number(v.vatRate)) / 100)}</dd>
            <dt>Total con IVA</dt><dd className="fin-strong">{eur(Number(v.base) + optionalChosen + Math.round((Number(v.base) + optionalChosen) * Number(v.vatRate)) / 100)}</dd>
            {options.length ? <><dt>Opciones elegidas</dt><dd>{selected.length ? options.filter((o) => selected.includes(o.id)).map((o) => o.name).join(', ') : 'Ninguna'}</dd></> : null}
          </dl>
          <p className="fin-muted">Pasará a «Presupuestos aprobados». Cuando fijemos la fecha de inicio, lo verás como obra en curso.</p>
          {dialogError ? <span className="fin-error-inline">{dialogError}</span> : null}
        </Dialog>
      ) : null}
      {dialog === 'changes' || dialog === 'reject' ? (
        <Dialog title={dialog === 'changes' ? 'Pedir cambios' : 'Rechazar presupuesto'} onClose={() => setDialog(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setDialog(null)}>Cancelar</button>
          <button type="button" className={'fin-btn ' + (dialog === 'reject' ? 'is-danger' : 'is-primary')} disabled={busy || (dialog === 'changes' && !text.trim())}
            onClick={() => act(() => (dialog === 'changes' ? api.requestChanges : api.reject)(doc.id, { versionId: v.id, body: text }), dialog === 'changes' ? 'Cambios enviados al equipo' : 'Presupuesto rechazado')}>
            {dialog === 'changes' ? 'Enviar comentarios' : 'Rechazar'}</button></>}>
          <p>{dialog === 'changes' ? 'Cuéntanos qué quieres cambiar. El equipo lo revisará y te enviará una versión nueva.' : 'El presupuesto quedará cerrado. Si quieres, dinos el motivo.'}</p>
          <label className="fin-field"><span>{dialog === 'changes' ? 'Comentarios' : 'Motivo (opcional)'}</span><textarea rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} /></label>
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
  return <div><button type="button" className="fin-btn is-ghost is-small" onClick={onBack}><i className="ri-arrow-left-line"></i>Volver</button></div>;
}

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

function ObraTab({ doc, can, busy, onDeclare, error }) {
  const o = doc.obra;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({});
  const [localError, setLocalError] = useState('');
  const startEdit = () => { setValues(Object.fromEntries(o.chapters.flatMap((c) => c.items).map((i) => [i.id, String(Number(i.executed)).replace('.', ',')]))); setLocalError(''); setEditing(true); };
  useEffect(() => { setEditing(false); }, [o]);
  const save = () => {
    const items = [];
    for (const i of o.chapters.flatMap((c) => c.items)) {
      const raw = values[i.id];
      const q = parseDecimal(raw, 4);
      if (q === null) return setLocalError(`Cantidad no válida en «${i.name}»`);
      if (Number(q) !== Number(i.executed)) items.push({ partidaId: i.id, executed: q });
    }
    if (!items.length) { setEditing(false); return; }
    onDeclare(items);
  };
  if (!o.startDate) {
    return <Empty icon="ri-calendar-line" title="Obra pendiente de fecha de inicio" text="El presupuesto está aprobado. Cuando el equipo fije la fecha de inicio, aquí verás el avance." />;
  }
  return (
    <div className="fin-stack">
      <div className="fin-kpis">
        <div className="fin-kpi"><span className="fin-kpi-label"><i className="ri-hammer-line"></i>Ejecución</span><span className="fin-kpi-value">{pctS(o.executionPct)}</span><Bar value={o.executionPct} color="#5567AE" /><span className="fin-kpi-hint">{`${eur(o.executedAmount)} ejecutado`}</span></div>
        <div className="fin-kpi"><span className="fin-kpi-label"><i className="ri-pie-chart-line"></i>Presupuesto consumido</span><span className="fin-kpi-value">{pctS(o.consumedPct)}</span><Bar value={o.consumedPct} color={o.consumedPct > 100 ? '#D14A4A' : '#55A89D'} /><span className="fin-kpi-hint">{`${eur(o.consumed)} de ${eur(o.base)} sin IVA`}</span></div>
        <Kpi label="Presupuesto vigente" value={eur(o.total)} icon="ri-money-euro-circle-line" hint={`${eur(o.base)} + ${eur(o.vat)} de IVA${doc.ampliaciones.some((a) => a.phase === 'aprobado') ? ' · incluye ampliaciones aprobadas' : ''}`} />
        <Kpi label="Fechas" value={fecha(o.startDate)} icon="ri-calendar-line" hint={o.endDate ? `Fin previsto: ${fecha(o.endDate)}` : 'Sin fecha de fin prevista'} />
      </div>
      <p className="fin-muted fin-small">Ejecución: lo hecho de cada partida hasta su cantidad presupuestada. Consumido: cantidad ejecutada × precio unitario; si una partida supera lo presupuestado, el exceso solo cuenta en el consumido.</p>
      {can.declare ? (
        <div className="obr-actions obr-start">
          {editing ? (<>
            <button type="button" className="fin-btn" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" onClick={save} disabled={busy}><i className="ri-save-line"></i>{busy ? 'Guardando…' : 'Guardar producción'}</button>
          </>) : <button type="button" className="fin-btn is-primary" onClick={startEdit}><i className="ri-edit-2-line"></i>Declarar producción</button>}
          {localError || error ? <span className="fin-error-inline">{localError || error}</span> : null}
        </div>
      ) : null}
      {o.chapters.map((c) => (
        <div className="fin-card is-flush" key={c.id}>
          <div className="obr-chapter-head">
            <div><h2>{c.name}</h2>{c.presupuesto.ampliacion ? <span className="fin-muted fin-small">{`Ampliación ${c.presupuesto.ref}`}</span> : null}</div>
            <div className="obr-chapter-figs">
              <span>{`Ejecución ${pctS(c.executionPct)}`}<Bar value={c.executionPct} color="#5567AE" /></span>
              <span>{`Consumido ${pctS(c.consumedPct)} · ${eur(c.consumed)} de ${eur(c.base)}`}<Bar value={c.consumedPct} color={c.consumedPct > 100 ? '#D14A4A' : '#55A89D'} /></span>
            </div>
          </div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>Código</th><th>Partida</th><th className="fin-num">Presupuestado</th><th className="fin-num">Ejecutado</th><th className="fin-num">Avance</th><th className="fin-num">Precio</th><th className="fin-num">Consumido</th></tr></thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id}>
                    <td className="fin-nowrap">{i.code || '—'}</td>
                    <td><strong>{i.name}</strong>{i.lastDeclared ? <div className="fin-muted fin-small">{i.lastDeclared.by ? `Declarado por ${i.lastDeclared.by} · ${fechaHora(i.lastDeclared.at)}${i.lastDeclared.note ? ` · ${i.lastDeclared.note}` : ''}` : (i.lastDeclared.note || 'Avance importado')}</div> : null}</td>
                    <td className="fin-num fin-nowrap">{`${num(i.quantity)} ${i.unit}`}</td>
                    <td className="fin-num fin-nowrap">
                      {editing ? <input aria-label={`Ejecutado en ${i.name}`} inputMode="decimal" className={'obr-in obr-in-num' + (parseDecimal(values[i.id], 4) === null ? ' is-invalid' : '')} value={values[i.id] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [i.id]: e.target.value }))} />
                        : `${num(i.executed)} ${i.unit}`}
                      {i.excess && !editing ? <div className="fin-danger fin-small">supera lo presupuestado</div> : null}
                    </td>
                    <td className="fin-num">{pctS(i.executionPct)}</td>
                    <td className="fin-num fin-nowrap">{eur(i.unitPrice)}</td>
                    <td className="fin-num fin-nowrap">{eur(i.consumed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
