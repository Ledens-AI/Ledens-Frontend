import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, num, fecha, fechaHora, TIPO, ESTADO, parseImporte } from './format.js';
import ProjectPicker from './ProjectPicker.jsx';
import { Badge, ErrorBox } from './ui.jsx';

/* Side panel for one record: what it is, its invoice and bank movement, and
 * the only things that can be edited here — its project (or a split across
 * projects) and its review flag. Amounts, dates and supplier data come from
 * accounting and are read-only. */
export default function RecordDrawer({ type, id, onClose, onSaved, toast }) {
  const [rec, setRec] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('view'); // view | assign | split
  const [project, setProject] = useState(null);
  const [reason, setReason] = useState('');
  const [parts, setParts] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = () => api.record(type, id).then((d) => { setRec(d.record); setError(''); }, (e) => setError(e.message));
  useEffect(() => { setRec(null); setMode('view'); load(); }, [type, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const hasAssignment = rec && (rec.project_id || rec.distribucion.length > 0);
  const startAssign = () => { setProject(rec.project_id ? { id: rec.project_id, label: rec.project_label } : null); setReason(''); setFormError(''); setMode('assign'); };
  const startSplit = () => {
    setParts(rec.distribucion.length
      ? rec.distribucion.map((p) => ({ project: { id: p.project_id, label: p.label }, amount: String(Number(p.amount).toFixed(2)).replace('.', ',') }))
      : [{ project: rec.project_id ? { id: rec.project_id, label: rec.project_label } : null, amount: '' }, { project: null, amount: '' }]);
    setReason(''); setFormError(''); setMode('split');
  };

  const done = (record, msg) => { setRec(record); setMode('view'); setSaving(false); onSaved?.(record); toast?.(msg); };
  const fail = (e) => { setSaving(false); setFormError(e.message); if (e.status === 409) load(); };

  const saveAssign = async () => {
    if (!project) return setFormError('Elige un proyecto.');
    if (hasAssignment && !reason.trim()) return setFormError('Indica el motivo del cambio.');
    setSaving(true); setFormError('');
    try {
      const r = await api.assign(type, id, { projectId: project.id, expectedProjectId: rec.project_id || null, reason: reason.trim() || undefined });
      done(r.record, r.changed ? `Asignado a ${project.label}.` : 'Sin cambios: ya estaba asignado a ese proyecto.');
    } catch (e) { fail(e); }
  };
  const removeAssign = async () => {
    if (!reason.trim()) return setFormError('Indica el motivo para quitar el proyecto.');
    setSaving(true); setFormError('');
    try { const r = await api.assign(type, id, { projectId: null, expectedProjectId: rec.project_id || null, reason: reason.trim() }); done(r.record, 'Proyecto quitado. El registro vuelve a pendientes.'); }
    catch (e) { fail(e); }
  };

  const total = rec ? Number(rec.importe) : 0;
  const parsed = parts.map((p) => parseImporte(p.amount));
  const sum = parsed.reduce((a, v) => a + (v ? Number(v) : 0), 0);
  const remaining = Math.round((total - sum) * 100) / 100;
  const saveSplit = async () => {
    if (parts.some((p) => !p.project)) return setFormError('Elige un proyecto en cada fila.');
    if (parsed.some((v) => v === null || Number(v) === 0)) return setFormError('Escribe un importe válido en cada fila (hasta 2 decimales).');
    if (new Set(parts.map((p) => p.project.id)).size !== parts.length) return setFormError('Un proyecto aparece dos veces.');
    if (Math.abs(sum) > Math.abs(total) + 1e-9) return setFormError(`La suma (${eur(sum)}) supera el importe del registro (${eur(total)}).`);
    if (hasAssignment && !reason.trim()) return setFormError('Indica el motivo del cambio.');
    setSaving(true); setFormError('');
    try {
      const r = await api.distribute(type, id, { parts: parts.map((p, i) => ({ projectId: p.project.id, amount: parsed[i] })), reason: reason.trim() || undefined });
      done(r.record, r.exact === false ? 'Distribución guardada. Queda importe sin asignar.' : 'Distribución guardada.');
    } catch (e) { fail(e); }
  };
  const setPart = (i, patch) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const toggleReview = async () => {
    setSaving(true); setFormError('');
    try {
      const r = await api.review(type, id, { needsReview: !rec.needs_review, note: note.trim() || undefined });
      setNote(''); done(r.record, rec.needs_review ? 'Revisión cerrada.' : 'Marcado para revisión.');
    } catch (e) { fail(e); }
  };

  const t = TIPO[type];
  return (
    <div className="fin-overlay is-drawer" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <aside className="fin-drawer" role="dialog" aria-modal="true" aria-label="Detalle del registro">
        <div className="fin-drawer-head">
          <Badge bg={t.bg} fg={t.fg} icon={t.icon}>{t.label}</Badge>
          {rec ? <Badge {...ESTADO[rec.estado]}>{ESTADO[rec.estado].label}</Badge> : null}
          <span className="fin-grow"></span>
          <button type="button" className="fin-iconbtn" aria-label="Cerrar" onClick={onClose} disabled={saving}><i className="ri-close-line"></i></button>
        </div>
        {error ? <ErrorBox message={error} onRetry={load} /> : null}
        {!rec && !error ? <div className="fin-loading">Cargando…</div> : null}
        {rec ? (
          <div className="fin-drawer-body">
            <div>
              <div className="fin-drawer-amount">{eur(rec.importe)}</div>
              <div className="fin-drawer-title">{rec.concepto || 'Sin concepto'}</div>
              <div className="fin-muted">{[rec.tercero, fecha(rec.fecha)].filter(Boolean).join(' · ')}</div>
            </div>

            <section className="fin-section">
              <h3>Proyecto</h3>
              {mode === 'view' ? (
                <>
                  {rec.distribucion.length ? (
                    <ul className="fin-parts">
                      {rec.distribucion.map((p) => <li key={p.project_id}><span>{p.label}</span><strong>{eur(p.amount)}</strong><span className="fin-muted">{p.pct ? `${num(p.pct)} %` : ''}</span></li>)}
                      {rec.estado === 'parcial' ? <li className="is-rest"><span>Sin asignar</span><strong>{eur(total - Number(rec.allocated))}</strong><span></span></li> : null}
                    </ul>
                  ) : rec.project_id ? <p className="fin-strong">{rec.project_label}</p> : <p className="fin-muted">Sin proyecto asignado.</p>}
                  {rec.suggestion && !hasAssignment ? (
                    <button type="button" className="fin-suggest" onClick={() => { setProject({ id: rec.suggestion.projectId, label: rec.suggestion.label }); setReason(''); setFormError(''); setMode('assign'); }}>
                      <i className="ri-lightbulb-line"></i>Sugerido: {rec.suggestion.label} <span className="fin-muted">({rec.suggestion.reason}; sin confirmar)</span>
                    </button>
                  ) : null}
                  <div className="fin-row-actions">
                    <button type="button" className="fin-btn is-primary" onClick={startAssign}><i className="ri-folder-transfer-line"></i>{hasAssignment ? 'Cambiar proyecto' : 'Asignar proyecto'}</button>
                    <button type="button" className="fin-btn" onClick={startSplit}><i className="ri-git-branch-line"></i>Distribuir entre proyectos</button>
                  </div>
                </>
              ) : null}

              {mode === 'assign' ? (
                <div className="fin-form">
                  <div className="fin-field"><span>Proyecto</span><ProjectPicker autoFocus value={project} onChange={setProject} /></div>
                  {hasAssignment ? (
                    <label className="fin-field"><span>Motivo del cambio (obligatorio, queda en la auditoría)</span>
                      <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                  ) : null}
                  {formError ? <div className="fin-error-inline">{formError}</div> : null}
                  <div className="fin-row-actions">
                    <button type="button" className="fin-btn is-primary" disabled={saving} onClick={saveAssign}>{saving ? 'Guardando…' : 'Guardar'}</button>
                    <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={() => setMode('view')}>Cancelar</button>
                    {hasAssignment ? <button type="button" className="fin-btn is-danger" disabled={saving} onClick={removeAssign}>Quitar proyecto</button> : null}
                  </div>
                </div>
              ) : null}

              {mode === 'split' ? (
                <div className="fin-form">
                  <p className="fin-muted">Reparte el importe sin duplicarlo: la suma no puede superar {eur(total)}. Si queda algo por repartir, el registro sigue en pendientes.</p>
                  {parts.map((p, i) => (
                    <div className="fin-split-row" key={i}>
                      <ProjectPicker value={p.project} onChange={(pr) => setPart(i, { project: pr })} label={`Proyecto ${i + 1}`} />
                      <input type="text" inputMode="decimal" aria-label={`Importe ${i + 1}`} placeholder="0,00" value={p.amount}
                        className={p.amount && parsed[i] === null ? 'is-invalid' : ''} onChange={(e) => setPart(i, { amount: e.target.value })} />
                      <button type="button" className="fin-iconbtn" aria-label="Quitar fila" disabled={parts.length === 1} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}><i className="ri-delete-bin-line"></i></button>
                    </div>
                  ))}
                  <div className="fin-split-foot">
                    <button type="button" className="fin-btn is-ghost" disabled={parts.length >= 20} onClick={() => setParts((ps) => [...ps, { project: null, amount: remaining && Math.sign(remaining) === Math.sign(total) ? String(remaining.toFixed(2)).replace('.', ',') : '' }])}>
                      <i className="ri-add-line"></i>Añadir proyecto</button>
                    <span className={Math.abs(sum) > Math.abs(total) + 1e-9 ? 'fin-danger' : remaining === 0 ? 'fin-ok' : 'fin-muted'}>
                      {`Repartido ${eur(sum)} de ${eur(total)} · ${remaining === 0 ? 'completo' : Math.abs(sum) > Math.abs(total) ? `sobran ${eur(Math.abs(remaining))}` : `quedan ${eur(remaining)}`}`}</span>
                  </div>
                  {hasAssignment ? (
                    <label className="fin-field"><span>Motivo del cambio (obligatorio)</span>
                      <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                  ) : null}
                  {formError ? <div className="fin-error-inline">{formError}</div> : null}
                  <div className="fin-row-actions">
                    <button type="button" className="fin-btn is-primary" disabled={saving} onClick={saveSplit}>{saving ? 'Guardando…' : 'Guardar distribución'}</button>
                    <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={() => setMode('view')}>Cancelar</button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="fin-section">
              <h3>Revisión</h3>
              {rec.needs_review ? <p className="fin-warn"><i className="ri-flag-line"></i>Marcado para revisión{rec.review_note ? `: ${rec.review_note}` : '.'}</p> : null}
              {!rec.needs_review ? (
                <label className="fin-field"><span>Nota (opcional)</span><input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué hay que comprobar" /></label>
              ) : null}
              <div className="fin-row-actions">
                <button type="button" className="fin-btn" disabled={saving} onClick={toggleReview}>{rec.needs_review ? 'Cerrar revisión' : 'Marcar para revisión'}</button>
              </div>
              {mode === 'view' && formError ? <div className="fin-error-inline">{formError}</div> : null}
            </section>

            <section className="fin-section">
              <h3>Detalle</h3>
              <dl className="fin-dl">
                <dt>Tipo</dt><dd>{rec.typeLabel}</dd>
                <dt>Fecha</dt><dd>{fecha(rec.fecha)}</dd>
                <dt>{t.tercero}</dt><dd>{rec.tercero || '—'}</dd>
                <dt>Concepto</dt><dd>{rec.concepto || '—'}</dd>
                {type === 'material' ? <><dt>Cantidad</dt><dd>{rec.quantity != null ? `${num(rec.quantity)} ${rec.unidad || ''} × ${eur(rec.unit_price)}` : '—'}</dd></> : null}
                <dt>Importe</dt><dd>{eur(rec.importe)}</dd>
              </dl>
            </section>

            <section className="fin-section">
              <h3>Factura o justificante</h3>
              {rec.documento ? (
                <>
                  <dl className="fin-dl">
                    <dt>Número</dt><dd>{rec.documento.numerodocumento || '—'}</dd>
                    <dt>Tipo</dt><dd>{[rec.documento.tipo, rec.documento.tipodocumento].filter(Boolean).join(' · ') || '—'}</dd>
                    <dt>Fecha</dt><dd>{fecha(rec.documento.document_on)}</dd>
                    <dt>Emisor / receptor</dt><dd>{[rec.documento.tercero, rec.documento.niftercero].filter(Boolean).join(' · ') || '—'}</dd>
                    <dt>Base · IVA · Retención</dt><dd>{`${eur(rec.documento.base_amount)} · ${eur(rec.documento.vat_amount)} · ${eur(rec.documento.withholding_amount)}`}</dd>
                    <dt>Total</dt><dd>{eur(rec.documento.total)}</dd>
                    <dt>Pagado / pendiente</dt><dd>{`${eur(rec.documento.paid)} / ${eur(rec.documento.balance)}`}</dd>
                    <dt>Calidad</dt><dd>{rec.documento.quality || '—'}{rec.documento.review_state ? ` · ${rec.documento.review_state}` : ''}</dd>
                  </dl>
                  {rec.documento.archivo ? (
                    <a className="fin-btn" href={rec.documento.archivo} target="_blank" rel="noopener noreferrer"><i className="ri-file-pdf-2-line"></i>Ver factura original (SharePoint)</a>
                  ) : <p className="fin-muted">El documento no tiene archivo enlazado todavía.</p>}
                </>
              ) : <p className="fin-muted">Este registro no tiene documento asociado.</p>}
            </section>

            <section className="fin-section">
              <h3>Movimiento bancario</h3>
              {rec.movimiento ? (
                <dl className="fin-dl">
                  <dt>Referencia</dt><dd>{rec.movimiento.source_id}{rec.movimiento.reference ? ` · ${rec.movimiento.reference}` : ''}</dd>
                  <dt>Banco</dt><dd>{rec.movimiento.bank_account || '—'}</dd>
                  <dt>Fecha</dt><dd>{fecha(rec.movimiento.completed_on)}</dd>
                  <dt>Descripción</dt><dd>{rec.movimiento.description || rec.movimiento.beneficiary_name || rec.movimiento.payer || '—'}</dd>
                  <dt>Importe</dt><dd>{eur(rec.movimiento.total_amount)}{rec.movimiento.currency && rec.movimiento.currency !== 'EUR' ? ` (${rec.movimiento.currency})` : ''}</dd>
                  <dt>Conciliación</dt><dd>{Number(rec.movimiento.difference) === 0 ? 'Conciliado' : `Sin conciliar: ${eur(rec.movimiento.difference)} · ${rec.movimiento.document_links} documento(s)`}</dd>
                </dl>
              ) : <p className="fin-muted">Sin movimiento bancario asociado.</p>}
            </section>

            <section className="fin-section">
              <h3>Historial de cambios</h3>
              {rec.historial.length ? (
                <ol className="fin-history">
                  {rec.historial.map((h) => (
                    <li key={h.id}>
                      <div><strong>{h.action}</strong>{h.old_label || h.new_label ? ` · ${h.old_label || 'sin proyecto'} → ${h.new_label || (h.new_allocations ? 'distribución' : 'sin proyecto')}` : ''}</div>
                      <div className="fin-muted">{`${fechaHora(h.at)} · ${h.actor_label}${h.origin === 'automatica' ? ' (automático)' : ''}`}</div>
                      {h.reason ? <div className="fin-history-reason">{h.reason}</div> : null}
                    </li>
                  ))}
                </ol>
              ) : <p className="fin-muted">Sin cambios registrados todavía.</p>}
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
