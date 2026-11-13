import React, { useCallback, useEffect, useState } from 'react';
import { tools } from './api.js';
import { LOCATION_KIND, MOVE_STATUS, PURPOSE, eur, fmtDate, fmtDateTime, incidentLabel, statusOf } from './labels.js';
import { ActionError, BackLink, Sheet, StatusBadge, ToolThumb, useAction } from './ui.jsx';
import { ReasonSheet, TransferSheet } from './Transferencias.jsx';
import { IncidentSheet } from './Incidencias.jsx';
import ToolForm from './ToolForm.jsx';
import { ErrorBox } from '../finanzas/ui.jsx';

/* La ficha de una herramienta (also what a scanned QR opens). What the user may
 * do comes from the server (`actions`); readOnly is «Ver como». The pending
 * reception comes first: it is the most common reason to open it on site. */
export default function ToolDetail({ id, options, readOnly, toast, onBack, onRequest, onChanged, onPrint }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // transfer:<mode> | incident | receive-incident | not-delivered | cancel | edit | retire | relabel | reserve | maint-open | maint-close | resolve:<id>
  const [history, setHistory] = useState(null);
  const action = useAction(toast);
  const load = useCallback(() => tools.get(id).then((d) => { setDoc(d); setError(''); }, (e) => setError(e.message)), [id]);
  useEffect(() => { load(); setHistory(null); }, [load]);
  const done = (out) => { setSheet(null); if (out?.herramienta) setDoc(out); else load(); if (history) tools.history(id).then(setHistory, () => {}); onChanged?.(); };

  if (error) return <div className="tl"><BackLink onBack={onBack} /><ErrorBox message={error} onRetry={load} /></div>;
  if (!doc) return <div className="fin-loading fin-muted">Cargando herramienta…</div>;
  const h = doc.herramienta;
  const a = readOnly ? {} : doc.actions;
  const blocked = h.condition !== 'operativa' || h.retiredAt;
  const receive = async () => { const out = await action.run((key) => tools.receive(h.pending.id, {}, key), 'Recepción confirmada'); if (out) done(out); };

  return (
    <div className="tl">
      <BackLink onBack={onBack} />
      <div className="fin-card tl-ficha-head">
        <ToolThumb tool={h} large />
        <div style={{ minWidth: 0 }}>
          <span className="tl-code">{h.code}{h.labelVersion > 1 ? ` · etiqueta ${h.labelVersion}` : ''}</span>
          <h2>{h.name}</h2>
          <div className="obr-actions obr-start" style={{ gap: '6px' }}>
            <StatusBadge status={h.status} />
            <span className="fin-badge" style={{ background: '#EDEDEA', color: '#3A3A38' }}>{`${h.type.category} · ${h.type.name}`}</span>
            {h.ownership !== 'propia' ? <span className="fin-badge" style={{ background: '#FDF0F4', color: '#B84371' }}>{h.ownership === 'alquilada' ? `Alquilada${h.ownerName ? ` · ${h.ownerName}` : ''}` : `De ${h.ownerName || 'terceros'}`}</span> : null}
          </div>
        </div>
      </div>

      {h.pending ? (
        <div className="tl-banner is-info" role="status">
          <i className="ri-truck-line" aria-hidden="true"></i>
          <div>
            <strong>{`${PURPOSE[h.pending.purpose] || 'Traslado'} hacia ${h.pending.to?.name || '—'}`}</strong>
            <span>{`Enviada el ${fmtDateTime(h.pending.sentAt)}${h.pending.toCustodian?.name ? ` para ${h.pending.toCustodian.name}` : ''}. Sigue en origen hasta que se confirme la recepción.`}</span>
            {a.receive || a.cancelMovement ? (
              <div className="obr-actions">
                {a.receive ? <button type="button" className="fin-btn is-primary" disabled={action.busy} onClick={receive}><i className="ri-checkbox-circle-line" aria-hidden="true"></i>{action.busy ? 'Confirmando…' : 'Confirmar recepción'}</button> : null}
                {a.receive ? <button type="button" className="fin-btn" onClick={() => setSheet('receive-incident')}><i className="ri-error-warning-line" aria-hidden="true"></i>Ha llegado con un problema</button> : null}
                {a.receive ? <button type="button" className="fin-btn" onClick={() => setSheet('not-delivered')}>No ha llegado</button> : null}
                {a.cancelMovement ? <button type="button" className="fin-btn" onClick={() => setSheet('cancel')}>Cancelar envío</button> : null}
              </div>
            ) : null}
            <ActionError error={action.error} onRetry={receive} />
          </div>
        </div>
      ) : null}
      {blocked && !h.retiredAt ? (
        <div className="tl-banner is-bad" role="status"><i className="ri-forbid-line" aria-hidden="true"></i>
          <div><strong>{`${statusOf(h.condition).label}: no apta para uso`}</strong><span>No se puede asignar ni reservar hasta que administración la revise.</span></div>
        </div>
      ) : null}
      {h.retiredAt ? <div className="tl-banner"><i className="ri-archive-line" aria-hidden="true"></i><div><strong>De baja</strong><span>{h.retiredReason}</span></div></div> : null}

      {!readOnly && (a.transfer || a.report || a.request) ? (
        <div className="tl-ficha-actions">
          {a.transfer ? <button type="button" className="fin-btn is-primary" onClick={() => setSheet('transfer:traslado')}><i className="ri-arrow-left-right-line" aria-hidden="true"></i>Trasladar / entregar</button> : null}
          {a.returnToWarehouse ? <button type="button" className="fin-btn" onClick={() => setSheet('transfer:devolucion')}><i className="ri-store-2-line" aria-hidden="true"></i>Devolver a almacén</button> : null}
          {a.report ? <button type="button" className="fin-btn" onClick={() => setSheet('incident')}><i className="ri-error-warning-line" aria-hidden="true"></i>Reportar incidencia</button> : null}
          {a.transfer && blocked ? <button type="button" className="fin-btn" onClick={() => setSheet('transfer:reparacion')}><i className="ri-tools-line" aria-hidden="true"></i>Enviar a reparar</button> : null}
          {a.request && onRequest ? <button type="button" className="fin-btn" onClick={() => onRequest(h)}><i className="ri-calendar-check-line" aria-hidden="true"></i>Solicitarla</button> : null}
        </div>
      ) : null}

      <div className="fin-card">
        <dl className="fin-dl">
          <dt>Ubicación</dt><dd><i className={LOCATION_KIND[h.location?.kind]?.icon} aria-hidden="true"></i>{` ${h.location?.name || '—'}`}{h.location?.kind && h.location.kind !== 'obra' ? ` (${LOCATION_KIND[h.location.kind]?.label})` : ''}</dd>
          <dt>Responsable</dt><dd>{h.custodian ? `${h.custodian.name}${h.custodian.type === 'employee' ? ' (trabajador)' : ''}` : h.mine ? 'Sin responsable personal' : '—'}</dd>
          {h.assignment ? <><dt>Trabaja para</dt><dd>{`${[h.assignment.project?.code, h.assignment.project?.name].filter(Boolean).join(' · ')} desde ${fmtDate(h.assignment.since)}`}</dd>
            <dt>Devolución prevista</dt><dd>{h.assignment.expectedReturnOn ? fmtDate(h.assignment.expectedReturnOn) : 'Sin fecha'}</dd></> : null}
          {h.brand || h.model ? <><dt>Marca y modelo</dt><dd>{[h.brand, h.model].filter(Boolean).join(' · ')}</dd></> : null}
          {h.serialNumber ? <><dt>Nº de serie</dt><dd>{h.serialNumber}</dd></> : null}
          {h.rentalEndsOn ? <><dt>Fin del alquiler</dt><dd>{fmtDate(h.rentalEndsOn)}</dd></> : null}
          <dt>Último movimiento</dt><dd>{fmtDateTime(h.lastMovementAt)}</dd>
          {'cost' in h ? <><dt>Coste</dt><dd>{eur(h.cost)}</dd><dt>Proveedor</dt><dd>{h.supplier || '—'}</dd><dt>Adquisición</dt><dd>{fmtDate(h.acquiredOn)}</dd><dt>Garantía hasta</dt><dd>{fmtDate(h.warrantyUntil)}</dd></> : null}
          {h.notes ? <><dt>Observaciones</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{h.notes}</dd></> : null}
        </dl>
      </div>

      {h.kind === 'kit' ? <KitItems tool={h} canEdit={!readOnly && a.updateKit} toast={toast} onSaved={done} /> : null}

      {h.incidents?.length ? (
        <div className="fin-card">
          <div className="fin-card-head"><h3 className="obr-h3">Incidencias abiertas</h3></div>
          <ul className="tl-list">{h.incidents.map((i) => (
            <li key={i.id}>
              <div><strong>{incidentLabel(i.kind)}{i.blocksUse ? ' · no apta' : ''}</strong><span>{i.description}</span><span className="fin-muted" style={{ fontSize: '13px' }}>{`${i.reporter} · ${fmtDateTime(i.reportedAt)}`}</span>
                {i.hasPhoto ? <a href={tools.incidentPhotoSrc(h.id, i.id)} target="_blank" rel="noreferrer">Ver foto</a> : null}</div>
              {!readOnly && a.maintenance ? <button type="button" className="fin-btn is-small" onClick={() => setSheet(`resolve:${i.id}`)}>Resolver</button> : null}
            </li>))}</ul>
        </div>
      ) : null}

      {h.reservations?.length ? (
        <div className="fin-card">
          <div className="fin-card-head"><h3 className="obr-h3">Reservas</h3></div>
          <ul className="tl-list">{h.reservations.map((r) => <li key={r.id}><div><strong>{r.project?.name || 'Otra obra'}</strong><span>{`${fmtDate(r.startsOn)} → ${fmtDate(r.endsOn)}`}</span></div>
            {!readOnly && a.manage ? <button type="button" className="fin-btn is-small" onClick={() => setSheet(`unreserve:${r.id}`)}>Cancelar</button> : null}</li>)}</ul>
        </div>
      ) : null}

      {!readOnly && a.manage ? <AdminTools tool={h} actions={a} onSheet={setSheet} onPrint={onPrint} toast={toast} onSaved={done} /> : null}

      <div className="fin-card">
        <div className="fin-card-head">
          <h3 className="obr-h3">Historial</h3>
          {!history && h.mine ? <button type="button" className="fin-btn is-small" onClick={() => tools.history(h.id).then(setHistory, (e) => toast?.(e.message))}>Ver historial</button> : null}
        </div>
        {history ? <History events={history.events} /> : <p className="fin-muted" style={{ margin: 0 }}>{h.mine ? 'Movimientos, asignaciones, reservas, incidencias y mantenimientos. Nada se borra.' : 'Solo ves el historial de las herramientas de tus obras.'}</p>}
      </div>

      {sheet?.startsWith('transfer:') ? <TransferSheet tool={h} options={options} mode={sheet.slice(9)} toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === 'incident' ? <IncidentSheet tool={h} toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === 'receive-incident' ? <IncidentSheet tool={h} receiving movementId={h.pending.id} toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === 'not-delivered' ? <ReasonSheet title="No ha llegado" label="Qué ha pasado" confirm="Registrar" toast={toast} okMessage="Registrado: queda en «Ubicación pendiente de confirmar»"
        onConfirm={(reason) => tools.notDelivered(h.pending.id, { reason })} onClose={(out) => (out ? done(out) : setSheet(null))} /> : null}
      {sheet === 'cancel' ? <ReasonSheet title="Cancelar envío" label="Motivo" confirm="Cancelar envío" danger toast={toast} okMessage="Envío cancelado"
        onConfirm={(reason) => tools.cancelMove(h.pending.id, { reason })} onClose={(out) => (out ? done(out) : setSheet(null))} /> : null}
      {sheet?.startsWith('resolve:') ? <ResolveSheet incidentId={sheet.slice(8)} toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet?.startsWith('unreserve:') ? <ReasonSheet title="Cancelar reserva" label="Motivo" confirm="Cancelar reserva" danger toast={toast} okMessage="Reserva cancelada"
        onConfirm={(reason) => tools.cancelReservation(sheet.slice(10), { reason })} onClose={(out) => (out ? done(out) : setSheet(null))} /> : null}
      {sheet === 'edit' ? <Sheet title="Editar ficha" onClose={() => setSheet(null)}><ToolForm tool={h} options={options} toast={toast} onCancel={() => setSheet(null)} onSaved={done} /></Sheet> : null}
      {sheet === 'retire' ? <ReasonSheet title="Dar de baja" label="Motivo de la baja (queda en el historial)" confirm="Dar de baja" danger toast={toast} okMessage="Herramienta dada de baja"
        onConfirm={(reason) => tools.retire(h.id, { reason })} onClose={(out) => (out ? done(out) : setSheet(null))} /> : null}
      {sheet === 'relabel' ? <ReasonSheet title="Sustituir etiqueta QR" label="Motivo (la etiqueta actual dejará de funcionar)" confirm="Generar etiqueta nueva" toast={toast} okMessage="Etiqueta nueva generada: imprímela y pégala"
        onConfirm={(reason) => tools.relabel(h.id, { reason })} onClose={(out) => (out ? done(out) : setSheet(null))} /> : null}
      {sheet === 'transfer-fix' ? <TransferSheet tool={h} options={options} mode="correccion" toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === 'maint-open' ? <MaintenanceSheet tool={h} toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === 'maint-close' ? <MaintenanceSheet tool={h} closing toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
      {sheet === 'reserve' ? <ReserveSheet tool={h} options={options} toast={toast} onClose={() => setSheet(null)} onDone={done} /> : null}
    </div>
  );
}

function KitItems({ tool, canEdit, toast, onSaved }) {
  const action = useAction(toast);
  const set = async (item, missing) => { const out = await action.run(() => tools.setKitMissing(tool.id, item.id, missing), 'Faltantes guardados'); if (out) onSaved(out); };
  const missing = tool.kitItems.reduce((s, i) => s + i.missing, 0);
  return (
    <div className="fin-card">
      <div className="fin-card-head"><h3 className="obr-h3">{`Componentes del kit${missing ? ` · faltan ${missing}` : ''}`}</h3></div>
      {tool.kitItems.length ? <ul className="tl-list">{tool.kitItems.map((i) => (
        <li key={i.id}>
          <div><strong>{i.name}</strong><span className="fin-muted">{`${i.quantity} ud${i.missing ? ` · faltan ${i.missing}` : ''}`}</span></div>
          {canEdit ? <span className="tl-stepper" aria-label={`Faltan de ${i.name}`}>
            <button type="button" aria-label="Una menos" disabled={action.busy || i.missing <= 0} onClick={() => set(i, i.missing - 1)}>−</button>
            <input readOnly value={i.missing} aria-label="Faltan" />
            <button type="button" aria-label="Una más" disabled={action.busy || i.missing >= i.quantity} onClick={() => set(i, i.missing + 1)}>+</button>
          </span> : null}
        </li>))}</ul> : <p className="fin-muted">Sin componentes registrados.</p>}
      <ActionError error={action.error} />
    </div>
  );
}

function AdminTools({ tool, actions, onSheet, onPrint, toast, onSaved }) {
  const action = useAction(toast);
  const photo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const out = await action.run(() => tools.setPhoto(tool.id, f), 'Foto actualizada');
    if (out) onSaved(out);
  };
  return (
    <div className="fin-card">
      <div className="fin-card-head"><h3 className="obr-h3">Administración</h3></div>
      <div className="tl-labels" style={{ marginBottom: '12px' }}>
        <div className="tl-label">
          <img src={`${tools.qrSrc(tool.id)}?v=${tool.labelVersion}`} alt={`Código QR de ${tool.code}`} />
          <div><span className="tl-code">{tool.code}</span><strong>{tool.name}</strong><small>Ledens Tools · escanéame</small></div>
        </div>
      </div>
      <div className="obr-actions obr-start">
        <button type="button" className="fin-btn" onClick={() => onSheet('edit')}><i className="ri-edit-line" aria-hidden="true"></i>Editar ficha</button>
        <label className="fin-btn" style={{ cursor: 'pointer' }}><i className="ri-camera-line" aria-hidden="true"></i>{tool.hasPhoto ? 'Cambiar foto' : 'Añadir foto'}
          <input type="file" accept="image/jpeg,image/png,image/heic,image/heif" onChange={photo} style={{ display: 'none' }} /></label>
        <button type="button" className="fin-btn" onClick={() => onPrint?.([tool.id])}><i className="ri-printer-line" aria-hidden="true"></i>Reimprimir etiqueta</button>
        <button type="button" className="fin-btn" onClick={() => onSheet('relabel')}><i className="ri-qr-code-line" aria-hidden="true"></i>Sustituir etiqueta</button>
        {!tool.retiredAt ? <button type="button" className="fin-btn" onClick={() => onSheet('reserve')}><i className="ri-calendar-check-line" aria-hidden="true"></i>Reservar</button> : null}
        {!tool.retiredAt && !tool.pending ? <button type="button" className="fin-btn" onClick={() => onSheet('transfer-fix')}><i className="ri-map-pin-2-line" aria-hidden="true"></i>Corregir ubicación</button> : null}
        {actions.maintenance && !tool.maintenance && !['perdida', 'robada'].includes(tool.condition) ? <button type="button" className="fin-btn" onClick={() => onSheet('maint-open')}><i className="ri-tools-line" aria-hidden="true"></i>Abrir mantenimiento</button> : null}
        {actions.maintenance && tool.maintenance ? <button type="button" className="fin-btn is-primary" onClick={() => onSheet('maint-close')}><i className="ri-tools-line" aria-hidden="true"></i>Cerrar mantenimiento</button> : null}
        {!tool.retiredAt && !tool.pending ? <button type="button" className="fin-btn is-danger" onClick={() => onSheet('retire')}><i className="ri-archive-line" aria-hidden="true"></i>Dar de baja</button> : null}
      </div>
      <ActionError error={action.error} />
    </div>
  );
}

function MaintenanceSheet({ tool, closing, toast, onClose, onDone }) {
  const action = useAction(toast);
  const [provider, setProvider] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState('apta');
  const [cost, setCost] = useState('');
  const submit = async () => {
    const out = await action.run(() => (closing ? tools.closeMaintenance(tool.id, { result, notes: notes.trim() || undefined, cost: cost.trim() || undefined })
      : tools.openMaintenance(tool.id, { provider: provider.trim() || undefined, notes: notes.trim() || undefined, incidentId: tool.incidents?.[0]?.id })), closing ? 'Mantenimiento cerrado' : 'Mantenimiento abierto');
    if (out) onDone(out);
  };
  return (
    <Sheet title={closing ? 'Cerrar mantenimiento' : 'Abrir mantenimiento'} onClose={onClose} actions={<>
      <button type="button" className="fin-btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" onClick={submit} disabled={action.busy || (closing && result !== 'apta' && !notes.trim())}>{action.busy ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      {closing ? <>
        <label className="fin-field"><span>Resultado</span>
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="apta">Reparada: vuelve a estar operativa</option>
            <option value="sigue_averiada">Sigue averiada</option>
            <option value="baja">No tiene arreglo: dar de baja</option>
          </select></label>
        <label className="fin-field"><span>Coste de la reparación (€)</span><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      </> : <label className="fin-field"><span>Taller o proveedor</span><input value={provider} maxLength={160} onChange={(e) => setProvider(e.target.value)} /></label>}
      <label className="fin-field"><span>{closing && result !== 'apta' ? 'Observaciones (obligatorio)' : 'Observaciones'}</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}

function ResolveSheet({ incidentId, toast, onClose, onDone }) {
  const action = useAction(toast);
  const [resolution, setResolution] = useState('');
  const [back, setBack] = useState(false);
  const submit = async () => { const out = await action.run(() => tools.resolveIncident(incidentId, { resolution: resolution.trim(), backInService: back }), 'Incidencia resuelta'); if (out) onDone(out); };
  return (
    <Sheet title="Resolver incidencia" onClose={onClose} actions={<>
      <button type="button" className="fin-btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" disabled={!resolution.trim() || action.busy} onClick={submit}>Resolver</button>
    </>}>
      <label className="fin-field"><span>Cómo se ha resuelto</span><textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Accesorio repuesto, herramienta encontrada…" /></label>
      <label className="fin-check" style={{ display: 'flex', gap: '10px', alignItems: 'center', minHeight: '44px' }}><input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} style={{ width: '22px', height: '22px' }} /><span>Vuelve a estar operativa</span></label>
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}

function ReserveSheet({ tool, options, toast, onClose, onDone }) {
  const action = useAction(toast);
  const [projectId, setProjectId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const submit = async () => { const out = await action.run((key) => tools.reserve({ assetId: tool.id, projectId, startsOn, endsOn }, key), 'Reserva creada'); if (out) onDone(out); };
  return (
    <Sheet title="Reservar herramienta" onClose={onClose} actions={<>
      <button type="button" className="fin-btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" disabled={!projectId || !startsOn || !endsOn || action.busy} onClick={submit}>Reservar</button>
    </>}>
      <label className="fin-field"><span>Obra</span><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Elige la obra…</option>
        {(options?.projects || []).map((p) => <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' · ')}</option>)}</select></label>
      <div className="fin-grid-2"><label className="fin-field"><span>Desde</span><input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} /></label></div>
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}

function History({ events }) {
  if (!events.length) return <p className="fin-muted">Sin movimientos.</p>;
  const line = (e) => {
    switch (e.type) {
      case 'movimiento': return [`${PURPOSE[e.purpose] || e.purpose}: ${e.from ? `${e.from} → ` : ''}${e.to}`, `${MOVE_STATUS[e.status]} · ${e.by}${e.resolvedBy && e.resolvedBy !== e.by ? ` · confirmó ${e.resolvedBy}` : ''}${e.notes ? ` · ${e.notes}` : ''}${e.resolution ? ` · ${e.resolution}` : ''}`, e.status === 'no_entregado'];
      case 'asignacion': return [`Asignada a ${e.project}`, e.endedAt ? `Hasta ${fmtDateTime(e.endedAt)} (${e.endedReason})` : `Vigente${e.expectedReturnOn ? ` · devolución ${fmtDate(e.expectedReturnOn)}` : ''}`];
      case 'reserva': return [`Reserva para ${e.project}`, `${fmtDate(e.startsOn)} → ${fmtDate(e.endsOn)} · ${e.status} · ${e.by}`];
      case 'incidencia': return [`Incidencia: ${incidentLabel(e.kind)}`, `${e.description} · ${e.by} · ${e.status}${e.resolution ? ` · ${e.resolution}` : ''}`, true];
      case 'mantenimiento': return [`Mantenimiento${e.provider ? ` · ${e.provider}` : ''}`, `${e.status}${e.result ? ` · ${e.result}` : ''}${'cost' in e && e.cost ? ` · ${eur(e.cost)}` : ''}`];
      default: return [e.type, ''];
    }
  };
  return (
    <ul className="tl-timeline">{events.map((e) => { const [t, s, bad] = line(e); return <li key={`${e.type}${e.id}`} className={bad ? 'is-bad' : ''}><strong>{t}</strong><span className="fin-muted">{`${fmtDateTime(e.at)} · ${s}`}</span></li>; })}</ul>
  );
}
