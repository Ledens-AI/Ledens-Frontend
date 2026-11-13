import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { parseScan } from './labels.js';
import { PendingMoves } from './Transferencias.jsx';
import { ActionError, Sheet, useAction } from './ui.jsx';
import { ErrorBox } from '../finanzas/ui.jsx';

/* Operaciones (administración): transfers waiting for a reception, consumable
 * stock, physical counts, and the catalogue of locations. Solicitudes,
 * reservas, asignaciones and movimientos stay separate things on purpose. */
export default function Operaciones({ options, readOnly, toast, onOpen, onOptions }) {
  const [tab, setTab] = useState('traslados');
  return (
    <div className="tl">
      <div className="tl-head"><div><h2>Operaciones</h2><p>Traslados en curso, consumibles, recuentos y ubicaciones.</p></div></div>
      <div className="fin-segmented" role="tablist">
        {[['traslados', 'Traslados'], ['consumibles', 'Consumibles'], ['recuento', 'Recuento físico'], ['ubicaciones', 'Ubicaciones']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>))}
      </div>
      {tab === 'traslados' ? <PendingMoves readOnly={readOnly} toast={toast} onOpen={onOpen} /> : null}
      {tab === 'consumibles' ? <Consumibles options={options} readOnly={readOnly} toast={toast} /> : null}
      {tab === 'recuento' ? <Recuento options={options} readOnly={readOnly} toast={toast} /> : null}
      {tab === 'ubicaciones' ? <Ubicaciones options={options} readOnly={readOnly} toast={toast} onOptions={onOptions} /> : null}
    </div>
  );
}

function Consumibles({ options, readOnly, toast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adjust, setAdjust] = useState(null);
  const load = () => tools.consumables().then((d) => { setData(d.consumibles); setError(''); }, (e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <div className="fin-loading fin-muted">Cargando consumibles…</div>;
  return (
    <div className="fin-stack">
      {!readOnly ? <button type="button" className="fin-btn is-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setAdjust({})}>Registrar entrada o consumo</button> : null}
      {data.length ? <ul className="tl-list">{data.map((t) => (
        <li key={t.id}><div><strong>{`${t.name}${t.low ? ' · bajo mínimos' : ''}`}</strong><span className="fin-muted">{`${t.category} · total ${t.total} ${t.unit}${t.minStock ? ` · mínimo ${t.minStock}` : ''}`}</span>
          <span className="fin-muted" style={{ fontSize: '13px' }}>{t.stock.map((s) => `${s.location}: ${s.quantity}`).join(' · ') || 'Sin existencias'}</span></div></li>))}</ul>
        : <p className="fin-muted">No hay consumibles. Créalos como tipo con seguimiento «Consumible» al dar de alta una herramienta.</p>}
      {adjust ? <AdjustSheet options={options} consumables={data} toast={toast} onClose={(ok) => { setAdjust(null); if (ok) load(); }} /> : null}
    </div>
  );
}

function AdjustSheet({ options, consumables, toast, onClose }) {
  const [v, setV] = useState({ typeId: consumables[0]?.id || '', locationId: '', sign: '+', qty: '', reason: '' });
  const action = useAction(toast);
  const submit = async () => {
    const out = await action.run((key) => tools.adjust({ typeId: v.typeId, locationId: v.locationId, delta: `${v.sign === '-' ? '-' : ''}${v.qty.replace(',', '.')}`, reason: v.reason.trim() }, key), 'Existencias actualizadas');
    if (out) onClose(true);
  };
  return (
    <Sheet title="Entrada o consumo" onClose={() => onClose(false)} actions={<>
      <button type="button" className="fin-btn" onClick={() => onClose(false)}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" disabled={!v.typeId || !v.locationId || !v.qty || !v.reason.trim() || action.busy} onClick={submit}>Guardar</button>
    </>}>
      <label className="fin-field"><span>Consumible</span><select value={v.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>{consumables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label className="fin-field"><span>Ubicación</span><select value={v.locationId} onChange={(e) => setV({ ...v, locationId: e.target.value })}><option value="">Elige…</option>
        {(options?.locations || []).filter((l) => l.kind !== 'pendiente').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <div className="fin-grid-2">
        <label className="fin-field"><span>Tipo</span><select value={v.sign} onChange={(e) => setV({ ...v, sign: e.target.value })}><option value="+">Entrada</option><option value="-">Consumo / salida</option></select></label>
        <label className="fin-field"><span>Cantidad</span><input inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></label>
      </div>
      <label className="fin-field"><span>Motivo</span><input value={v.reason} maxLength={300} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Compra, envío a obra, consumo…" /></label>
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}

// Physical count of a location: scan or type each code; closing only reports
// discrepancies (fixed afterwards with corrections or incidents, never silently).
function Recuento({ options, readOnly, toast }) {
  const [loc, setLoc] = useState('');
  const [count, setCount] = useState(null);
  const [code, setCode] = useState('');
  const action = useAction(toast);
  const start = async () => { const out = await action.run(() => tools.startCount({ locationId: loc })); if (out) setCount(out); };
  const seen = async (e) => {
    e.preventDefault();
    const hit = parseScan(code);
    if (!hit) return;
    const out = await action.run(() => tools.countSeen(count.count.id, hit.token ? { token: hit.token } : { code: hit.code }));
    if (out) { setCount(out); setCode(''); }
  };
  const close = async () => { const out = await action.run(() => tools.closeCount(count.count.id), 'Recuento cerrado'); if (out) setCount(out); };
  if (!count) {
    return (
      <div className="fin-card fin-form">
        <label className="fin-field"><span>Ubicación a contar</span><select value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">Elige…</option>
          {(options?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <button type="button" className="fin-btn is-primary" style={{ alignSelf: 'flex-start' }} disabled={!loc || readOnly || action.busy} onClick={start}>Empezar recuento</button>
        <ActionError error={action.error} />
      </div>
    );
  }
  const open = count.count.status === 'abierto';
  return (
    <div className="fin-stack">
      <div className="fin-card">
        <div className="fin-card-head"><h3 className="obr-h3">{`${count.count.location.name} · ${count.seen} de ${count.expected} vistas`}</h3>{open ? <button type="button" className="fin-btn" onClick={close}>Cerrar recuento</button> : <span className="fin-badge" style={{ background: '#DEF3F0', color: '#2F6B63' }}>Cerrado</span>}</div>
        {open ? <form className="tl-search-row" onSubmit={seen}><input className="obr-in" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Escanea con un lector o escribe el código" autoFocus aria-label="Código" />
          <button type="submit" className="fin-btn is-primary" disabled={!code.trim() || action.busy}>Marcar vista</button></form> : null}
        <ActionError error={action.error} />
      </div>
      <div className="fin-grid-2" style={{ alignItems: 'start' }}>
        <div className="fin-card"><h3 className="obr-h3 obr-mb">{`Faltan (${count.missing.length})`}</h3><ul className="tl-list">{count.missing.map((m) => <li key={m.id}><div><span className="tl-code">{m.code}</span><span>{m.name}</span></div></li>)}</ul></div>
        <div className="fin-card"><h3 className="obr-h3 obr-mb">{`Fuera de sitio (${count.unexpected.length})`}</h3><ul className="tl-list">{count.unexpected.map((m) => <li key={m.id}><div><span className="tl-code">{m.code}</span><span>{m.name}</span></div></li>)}</ul></div>
      </div>
    </div>
  );
}

function Ubicaciones({ options, readOnly, toast, onOptions }) {
  const [v, setV] = useState({ kind: 'almacen', name: '', address: '' });
  const action = useAction(toast);
  const submit = async () => { const out = await action.run(() => tools.createLocation({ kind: v.kind, name: v.name.trim(), address: v.address.trim() || undefined }), 'Ubicación creada'); if (out) { setV({ ...v, name: '', address: '' }); onOptions?.(); } };
  return (
    <div className="fin-stack">
      <ul className="tl-list">{(options?.locations || []).map((l) => <li key={l.id}><div><strong>{l.name}</strong><span className="fin-muted">{`${l.kind}${l.system ? ' · del sistema' : ''}`}</span></div></li>)}</ul>
      {!readOnly ? (
        <div className="fin-card fin-form">
          <h3 className="obr-h3">Nueva ubicación</h3>
          <p className="fin-muted" style={{ margin: 0 }}>Las obras no se crean aquí: cada proyecto tiene la suya en cuanto se le envía una herramienta.</p>
          <div className="fin-grid-3">
            <label className="fin-field"><span>Tipo</span><select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              <option value="almacen">Almacén</option><option value="vehiculo">Vehículo</option><option value="taller">Taller de reparación</option><option value="proveedor">Instalación de proveedor</option><option value="externa">Custodia externa</option></select></label>
            <label className="fin-field"><span>Nombre</span><input value={v.name} maxLength={160} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Furgoneta 1234-ABC" /></label>
            <label className="fin-field"><span>Dirección (opcional)</span><input value={v.address} maxLength={300} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
          </div>
          <button type="button" className="fin-btn is-primary" style={{ alignSelf: 'flex-start' }} disabled={!v.name.trim() || action.busy} onClick={submit}>Crear ubicación</button>
          <ActionError error={action.error} />
        </div>
      ) : null}
    </div>
  );
}
