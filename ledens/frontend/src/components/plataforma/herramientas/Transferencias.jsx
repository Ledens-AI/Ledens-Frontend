import React, { useEffect, useMemo, useState } from 'react';
import { tools } from './api.js';
import { LOCATION_KIND, PURPOSE, fmtDateTime } from './labels.js';
import { ActionError, Sheet, Tiles, useAction } from './ui.jsx';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';

/* Transfers: sending an asset somewhere (TransferSheet) and the list of
 * movements waiting for a reception (PendingMoves). The asset only changes
 * place when the receiver confirms; «Ya está en destino» registers both steps
 * at once and the server only accepts it from whoever may confirm it. */

// mode: 'traslado' (to an obra or elsewhere), 'devolucion' (to a warehouse),
// 'reparacion' (to a workshop / supplier), 'correccion' (admins: where it really is).
export function TransferSheet({ tool, options, mode = 'traslado', onClose, onDone, toast }) {
  const action = useAction(toast);
  const me = options?.me;
  const locs = options?.locations || [];
  const projects = (options?.projects || []).filter((p) => p.open !== false || p.id === tool.project?.id);
  const isAdmin = (options?.permissions || []).includes('tools.read.all');
  const dests = useMemo(() => {
    const out = [];
    if (mode === 'devolucion') return locs.filter((l) => l.kind === 'almacen').map((l) => ({ value: `l:${l.id}`, label: l.name, icon: LOCATION_KIND.almacen.icon }));
    if (mode === 'reparacion') return locs.filter((l) => ['taller', 'proveedor'].includes(l.kind)).map((l) => ({ value: `l:${l.id}`, label: l.name, icon: LOCATION_KIND[l.kind].icon }));
    for (const p of projects) out.push({ value: `p:${p.id}`, label: [p.code, p.name].filter(Boolean).join(' · '), icon: 'ri-building-2-line' });
    for (const l of locs) if (l.kind !== 'obra' && (mode === 'correccion' || l.kind !== 'pendiente')) out.push({ value: `l:${l.id}`, label: l.name, icon: LOCATION_KIND[l.kind]?.icon });
    return out;
  }, [mode, locs, projects]);
  const [dest, setDest] = useState(dests.length === 1 ? dests[0].value : '');
  const [who, setWho] = useState('');
  const [notes, setNotes] = useState('');
  const [now, setNow] = useState(false);
  useEffect(() => { if (!dest && dests.length === 1) setDest(dests[0].value); }, [dests, dest]);
  const destIsMine = dest.startsWith('p:') && (isAdmin || projects.some((p) => `p:${p.id}` === dest));
  const canNow = mode !== 'correccion' && (who === `user:${me}` || (destIsMine && !who.startsWith('user:')) || isAdmin);
  const custodians = options?.custodians || [];
  const title = { traslado: 'Trasladar herramienta', devolucion: 'Devolver a almacén', reparacion: 'Enviar a reparar', correccion: 'Corregir ubicación' }[mode];

  const submit = async () => {
    const [kind, id] = dest.split(':');
    const [ctype, cid] = who.split(':');
    const body = {
      assetId: tool.id, purpose: mode, notes: notes.trim() || undefined,
      ...(kind === 'p' ? { toProjectId: id } : { toLocationId: id }),
      ...(cid ? { toCustodian: { type: ctype, id: cid } } : {}),
      ...(now && canNow ? { receiveNow: true } : {}),
    };
    const out = await action.run((key) => tools.move(body, key));
    if (!out) return;
    toast?.(out.movement?.status === 'recibido' ? 'Movimiento registrado y recibido' : 'Enviada: queda pendiente de que el receptor confirme la recepción');
    onDone?.(out);
  };

  return (
    <Sheet title={title} onClose={onClose} actions={<>
      <button type="button" className="fin-btn" onClick={onClose} disabled={action.busy}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" onClick={submit} disabled={!dest || action.busy || (mode === 'correccion' && !notes.trim())}>
        {action.busy ? 'Guardando…' : mode === 'correccion' ? 'Guardar corrección' : now && canNow ? 'Registrar' : 'Enviar'}
      </button>
    </>}>
      <p className="fin-muted" style={{ margin: 0 }}>{`${tool.code} · ${tool.name} · ahora en ${tool.location?.name || '—'}`}</p>
      <div className="fin-field"><span>Destino</span>
        {dests.length ? <Tiles options={dests} value={dest} onChange={setDest} label="Destino" /> : <span className="fin-muted">No hay destinos disponibles para esta operación. Pide a administración que cree la ubicación.</span>}
      </div>
      {mode !== 'reparacion' ? (
        <label className="fin-field"><span>Quién la recibe (opcional)</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{dest.startsWith('p:') ? 'La obra (sin responsable personal)' : 'Nadie en concreto'}</option>
            {me ? <option value={`user:${me}`}>Yo</option> : null}
            {custodians.filter((c) => c.id !== me).map((c) => <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>{c.type === 'employee' ? `${c.name} (trabajador)` : c.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className="fin-field"><span>{mode === 'correccion' ? 'Motivo de la corrección' : 'Observaciones (opcional)'}</span>
        <textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder={mode === 'correccion' ? 'Dónde estaba realmente y cómo se ha comprobado' : 'Estado, accesorios que van con ella…'} />
      </label>
      {canNow ? (
        <label className="fin-check" style={{ display: 'flex', gap: '10px', alignItems: 'center', minHeight: '44px' }}>
          <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} style={{ width: '22px', height: '22px' }} />
          <span>Ya está en destino: la recibo ahora (sin esperar confirmación)</span>
        </label>
      ) : <p className="fin-muted" style={{ margin: 0, fontSize: '13px' }}>Quedará «en traslado» hasta que el receptor confirme la recepción.</p>}
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}

// «No ha llegado» / «Cancelar envío»: both need a reason.
export function ReasonSheet({ title, label, confirm, danger, onClose, onConfirm, toast, okMessage }) {
  const action = useAction(toast);
  const [reason, setReason] = useState('');
  const submit = async () => { const out = await action.run(() => onConfirm(reason.trim()), okMessage); if (out) onClose(out); };
  return (
    <Sheet title={title} onClose={() => onClose()} actions={<>
      <button type="button" className="fin-btn" onClick={() => onClose()} disabled={action.busy}>Volver</button>
      <button type="button" className={'fin-btn ' + (danger ? 'is-danger' : 'is-primary')} onClick={submit} disabled={!reason.trim() || action.busy}>{action.busy ? 'Guardando…' : confirm}</button>
    </>}>
      <label className="fin-field"><span>{label}</span><textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}

// Movements waiting for a reception: those I must confirm (one tap) and those I sent.
export function PendingMoves({ readOnly, toast, onOpen, onCount, compact }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cancel, setCancel] = useState(null);
  const action = useAction(toast);
  const load = () => tools.pending().then((d) => { setData(d); setError(''); onCount?.(d.toReceive.length); }, (e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <div className="fin-loading fin-muted">Cargando traslados…</div>;
  const receive = async (m) => { const ok = await action.run((key) => tools.receive(m.id, {}, key), `${m.code} recibida`); if (ok) load(); };
  const Row = ({ m, mine }) => (
    <li>
      <div>
        <button type="button" className="fin-link" style={{ textAlign: 'left', fontWeight: 700, padding: 0, background: 'none', border: 0, cursor: 'pointer', font: 'inherit', color: '#3E4D85' }} onClick={() => onOpen?.(m.assetId)}>{`${m.name}`}</button>
        <span className="tl-code">{m.code}</span>
        <span className="fin-muted" style={{ fontSize: '13px' }}>{`${PURPOSE[m.purpose] || m.purpose} · ${m.from || '—'} → ${m.to} · ${m.sender} · ${fmtDateTime(m.sentAt)}`}</span>
      </div>
      {!readOnly ? (mine
        ? <button type="button" className="fin-btn is-primary" disabled={action.busy} onClick={() => receive(m)}><i className="ri-checkbox-circle-line" aria-hidden="true"></i>Confirmar recepción</button>
        : <button type="button" className="fin-btn is-small" onClick={() => setCancel(m)}>Cancelar envío</button>) : null}
    </li>
  );
  return (
    <div className="fin-stack">
      <ActionError error={action.error} onRetry={null} />
      <div className="fin-card">
        <div className="fin-card-head"><h3 className="obr-h3">{`Pendientes de recibir (${data.toReceive.length})`}</h3></div>
        {data.toReceive.length ? <ul className="tl-list">{data.toReceive.map((m) => <Row key={m.id} m={m} mine />)}</ul> : <Empty icon="ri-inbox-line" title="Nada pendiente de recibir" />}
      </div>
      {!compact ? (
        <div className="fin-card">
          <div className="fin-card-head"><h3 className="obr-h3">{`Enviadas, esperando recepción (${data.sent.length})`}</h3></div>
          {data.sent.length ? <ul className="tl-list">{data.sent.map((m) => <Row key={m.id} m={m} />)}</ul> : <p className="fin-muted">Ningún envío pendiente.</p>}
        </div>
      ) : null}
      {cancel ? <ReasonSheet title={`Cancelar el envío de ${cancel.code}`} label="Motivo" confirm="Cancelar envío" danger toast={toast} okMessage="Envío cancelado: la herramienta sigue en origen"
        onConfirm={(reason) => tools.cancelMove(cancel.id, { reason })} onClose={(out) => { setCancel(null); if (out) load(); }} /> : null}
    </div>
  );
}
