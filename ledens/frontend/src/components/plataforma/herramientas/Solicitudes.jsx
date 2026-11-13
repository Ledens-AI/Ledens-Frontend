import React, { useCallback, useEffect, useState } from 'react';
import { tools } from './api.js';
import { REQUEST_STATUS, fmtDate, fmtDateTime, MOVE_STATUS } from './labels.js';
import { ActionError, BackLink, Sheet, useAction } from './ui.jsx';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';

/* Solicitudes de herramientas. A jefe sees «Mis solicitudes» (his own and
 * those of his obras); administración, the approval tray. A request is not a
 * delivery: approving reserves concrete units, «Enviar» creates the transfers,
 * and it is «Entregada» only when the jefe confirms each reception. */
export function RequestBadge({ status }) {
  const s = REQUEST_STATUS[status] || { label: status, bg: '#EDEDEA', fg: '#3A3A38' };
  return <span className="fin-badge" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

export default function Solicitudes({ admin, readOnly, toast, onNew, onOpenTool, openId, onCount }) {
  const [filter, setFilter] = useState(admin ? 'pendientes' : 'abiertas');
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(openId || null);
  const load = useCallback(() => tools.requests({ estado: filter === 'todas' ? undefined : filter, mias: !admin && filter === 'mias' ? '1' : undefined })
    .then((d) => { setList(d.solicitudes); setError(''); if (admin && filter === 'pendientes') onCount?.(d.solicitudes.length); }, (e) => setError(e.message)), [filter, admin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (open) return <RequestDetail id={open} admin={admin} readOnly={readOnly} toast={toast} onOpenTool={onOpenTool} onBack={() => { setOpen(null); load(); }} />;
  const chips = admin ? [['pendientes', 'Por decidir'], ['abiertas', 'En curso'], ['todas', 'Todas']] : [['abiertas', 'En curso'], ['mias', 'Mías'], ['todas', 'Todas']];

  return (
    <div className="tl">
      <div className="tl-head">
        <div><h2>{admin ? 'Solicitudes de herramientas' : 'Mis solicitudes'}</h2><p>{admin ? 'Revisa disponibilidad y conflictos, y aprueba total o parcialmente.' : 'Lo que has pedido y en qué punto está.'}</p></div>
        {!readOnly && onNew ? <button type="button" className="fin-btn is-primary" onClick={() => onNew()}><i className="ri-add-line" aria-hidden="true"></i>Nueva solicitud</button> : null}
      </div>
      <div className="tl-chips" role="tablist">{chips.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={'tl-chip' + (filter === k ? ' is-on' : '')} onClick={() => setFilter(k)}>{l}</button>)}</div>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {!list && !error ? <div className="fin-loading fin-muted">Cargando solicitudes…</div> : null}
      {list && !list.length ? <Empty icon="ri-inbox-line" title={admin && filter === 'pendientes' ? 'No hay solicitudes por decidir' : 'No hay solicitudes'} /> : null}
      {list?.length ? (
        <ul className="obr-list">{list.map((r) => (
          <li key={r.id}><button type="button" className="obr-row" onClick={() => setOpen(r.id)}>
            <span className="obr-row-main"><strong>{`${r.ref} · ${r.project.name}`}</strong>
              <span className="fin-muted">{`${r.units} ud · ${r.summary || ''}`}</span>
              <span className="fin-muted" style={{ fontSize: '13px' }}>{`${fmtDate(r.neededFrom)} → ${fmtDate(r.returnBy)}${admin ? ` · ${r.requester}` : ''}`}</span></span>
            <span className="obr-row-end"><RequestBadge status={r.status} /><i className="ri-arrow-right-s-line" aria-hidden="true"></i></span>
          </button></li>))}</ul>
      ) : null}
    </div>
  );
}

function RequestDetail({ id, admin, readOnly, toast, onBack, onOpenTool }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState({}); // itemId → Set(assetIds)
  const [sheet, setSheet] = useState(null); // approve | reject | cancel
  const [reason, setReason] = useState('');
  const action = useAction(toast);
  const load = useCallback(() => tools.request(id).then((d) => {
    setDoc(d); setError('');
    // Pre-select the first free units of each line: approving is one tap when there is stock.
    if (d.suggestions) setChosen(Object.fromEntries(d.suggestions.map((s) => { const it = d.solicitud.items.find((i) => i.id === s.itemId); return [s.itemId, new Set(s.candidates.slice(0, it.quantity).map((c) => c.id))]; })));
  }, (e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (error) return <div className="tl"><BackLink onBack={onBack} /><ErrorBox message={error} onRetry={load} /></div>;
  if (!doc) return <div className="fin-loading fin-muted">Cargando solicitud…</div>;
  const r = doc.solicitud;
  const a = readOnly ? {} : doc.actions;
  const total = r.items.reduce((s, i) => s + i.quantity, 0);
  const picked = Object.values(chosen).reduce((s, x) => s + x.size, 0);
  const partial = picked < total;
  const act = async (fn, msg) => { const out = await action.run(fn, msg); if (out) { setSheet(null); setReason(''); if (out.solicitud) setDoc(out); load(); } };
  const toggle = (itemId, assetId, max) => setChosen((c) => {
    const s = new Set(c[itemId]);
    if (s.has(assetId)) s.delete(assetId); else if (s.size < max) s.add(assetId);
    return { ...c, [itemId]: s };
  });

  return (
    <div className="tl">
      <BackLink onBack={onBack} />
      <div className="tl-head">
        <div><span className="tl-code">{r.ref}</span><h2>{r.project.name}</h2>
          <p>{`${r.requestedBy.name} · ${fmtDate(r.neededFrom)} → ${fmtDate(r.returnBy)} · creada ${fmtDateTime(r.createdAt)}`}</p></div>
        <RequestBadge status={r.status} />
      </div>
      {r.notes ? <div className="fin-card"><p className="obr-pre" style={{ margin: 0 }}>{r.notes}</p></div> : null}
      {r.decisionReason ? <div className={'tl-banner ' + (r.status === 'rechazada' ? 'is-bad' : 'is-info')}><i className="ri-chat-quote-line" aria-hidden="true"></i><div><strong>{r.decidedBy ? `Decisión de ${r.decidedBy.name}` : 'Nota'}</strong><span>{r.decisionReason}</span></div></div> : null}

      <div className="fin-card">
        <div className="fin-card-head"><h3 className="obr-h3">Herramientas pedidas</h3>{a.decide ? <span className="fin-muted">{`${picked} de ${total} seleccionadas`}</span> : null}</div>
        <ul className="tl-list">{r.items.map((it) => {
          const sug = doc.suggestions?.find((s) => s.itemId === it.id);
          return (
            <li key={it.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div><strong>{`${it.quantity} × ${it.type.name}`}</strong>
                <span className="fin-muted">{[it.asset ? `Concreta: ${it.asset.code}` : null, it.quantityApproved !== null ? `Aprobadas: ${it.quantityApproved}` : null, it.notes].filter(Boolean).join(' · ')}</span></div>
              {a.decide && sug ? (sug.candidates.length ? (
                <div className="tl-tiles" role="group" aria-label={`Unidades para ${it.type.name}`}>
                  {sug.candidates.map((c) => { const on = chosen[it.id]?.has(c.id); return (
                    <button key={c.id} type="button" aria-pressed={on} className={'tl-tile' + (on ? ' is-on' : '')} onClick={() => toggle(it.id, c.id, it.quantity)}>
                      <i className={on ? 'ri-checkbox-line' : 'ri-checkbox-blank-line'} aria-hidden="true"></i><span><span className="tl-code" style={{ display: 'block' }}>{c.code}</span>{c.location}</span>
                    </button>); })}
                </div>) : <span className="tl-avail is-bad"><i className="ri-error-warning-line" aria-hidden="true"></i>Ninguna unidad libre para esas fechas (reservadas, asignadas o no aptas)</span>) : null}
            </li>);
        })}</ul>
      </div>

      {r.reservations.length ? (
        <div className="fin-card"><div className="fin-card-head"><h3 className="obr-h3">Reservas</h3></div>
          <ul className="tl-list">{r.reservations.map((x) => <li key={x.id}><div><button type="button" className="fin-link" style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: '#3E4D85', cursor: 'pointer', textAlign: 'left' }} onClick={() => onOpenTool?.(x.asset.id)}>{`${x.asset.code} · ${x.asset.name}`}</button><span className="fin-muted">{`${fmtDate(x.startsOn)} → ${fmtDate(x.endsOn)} · ${x.status}`}</span></div></li>)}</ul></div>
      ) : null}
      {r.movements.length ? (
        <div className="fin-card"><div className="fin-card-head"><h3 className="obr-h3">Envíos</h3></div>
          <ul className="tl-list">{r.movements.map((m) => <li key={m.id}><div><strong>{`${m.code} · ${m.name}`}</strong><span className="fin-muted">{`${MOVE_STATUS[m.status]} · ${fmtDateTime(m.resolvedAt || m.sentAt)}`}</span></div></li>)}</ul></div>
      ) : null}

      <ActionError error={action.error} />
      {action.error?.data?.conflicts ? <p className="fin-muted">Recarga para ver las unidades que siguen libres.</p> : null}
      <div className="obr-actions">
        {a.cancel ? <button type="button" className="fin-btn is-danger" onClick={() => setSheet('cancel')}>Cancelar solicitud</button> : null}
        {a.submit ? <button type="button" className="fin-btn is-primary" disabled={action.busy} onClick={() => act(() => tools.requestAction(r.id, 'presentar'), 'Solicitud enviada')}>Enviar solicitud</button> : null}
        {a.review ? <button type="button" className="fin-btn" disabled={action.busy} onClick={() => act(() => tools.requestAction(r.id, 'revisar'), 'Marcada en revisión')}>Marcar en revisión</button> : null}
        {a.decide ? <button type="button" className="fin-btn is-danger" onClick={() => setSheet('reject')}>Rechazar</button> : null}
        {a.decide ? <button type="button" className="fin-btn is-primary" disabled={!picked || action.busy} onClick={() => (partial ? setSheet('approve') : act((key) => tools.requestAction(r.id, 'aprobar', { items: r.items.map((i) => ({ itemId: i.id, assetIds: [...(chosen[i.id] || [])] })) }, key), 'Solicitud aprobada: herramientas reservadas'))}>
          {partial ? `Aprobar ${picked} de ${total}` : 'Aprobar y reservar'}</button> : null}
        {a.prepare ? <button type="button" className="fin-btn" disabled={action.busy} onClick={() => act(() => tools.requestAction(r.id, 'preparar'), 'En preparación')}>Marcar en preparación</button> : null}
        {a.dispatch ? <button type="button" className="fin-btn is-primary" disabled={action.busy} onClick={() => act((key) => tools.requestAction(r.id, 'despachar', {}, key), 'Enviada: el jefe de obra confirmará la recepción')}><i className="ri-truck-line" aria-hidden="true"></i>Enviar a obra</button> : null}
        {a.finish ? <button type="button" className="fin-btn" disabled={action.busy} onClick={() => act(() => tools.requestAction(r.id, 'finalizar'), 'Solicitud finalizada')}>Finalizar</button> : null}
      </div>

      {sheet ? (
        <Sheet title={{ approve: `Aprobar ${picked} de ${total}`, reject: 'Rechazar solicitud', cancel: 'Cancelar solicitud' }[sheet]} onClose={() => setSheet(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setSheet(null)}>Volver</button>
          <button type="button" className={'fin-btn ' + (sheet === 'approve' ? 'is-primary' : 'is-danger')} disabled={!reason.trim() || action.busy}
            onClick={() => act((key) => (sheet === 'approve' ? tools.requestAction(r.id, 'aprobar', { reason: reason.trim(), items: r.items.map((i) => ({ itemId: i.id, assetIds: [...(chosen[i.id] || [])] })) }, key)
              : tools.requestAction(r.id, sheet === 'reject' ? 'rechazar' : 'cancelar', { reason: reason.trim() })), sheet === 'approve' ? 'Aprobada en parte' : sheet === 'reject' ? 'Solicitud rechazada' : 'Solicitud cancelada')}>
            {sheet === 'approve' ? 'Aprobar en parte' : sheet === 'reject' ? 'Rechazar' : 'Cancelar solicitud'}</button>
        </>}>
          <label className="fin-field"><span>{sheet === 'approve' ? 'Motivo de la aprobación parcial (lo verá el jefe de obra)' : 'Motivo (lo verá el jefe de obra)'}</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
          <ActionError error={action.error} />
        </Sheet>
      ) : null}
    </div>
  );
}
