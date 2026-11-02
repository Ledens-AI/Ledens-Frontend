import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha, num } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Kpi, Pager } from './ui.jsx';

export const CLASE_MOV = {
  pendiente: { label: 'Pendiente de clasificación', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-question-line' },
  materiales: { label: 'Pago de materiales', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-hammer-line' },
  trabajadores: { label: 'Pago a trabajadores', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-user-settings-line' },
  clientes: { label: 'Cobro de clientes', bg: '#FDF0F4', fg: '#B84371', icon: 'ri-hand-coin-line' },
  mixto: { label: 'Varias clases', bg: '#F2F2EF', fg: '#3A3A38', icon: 'ri-shuffle-line' },
};
const ORIGEN = { bridge: 'Deducido del Bridge con documentos', trabajadores: 'En Pendiente de trabajador', registro: 'Registro contable del movimiento', provisional: 'Provisional hasta conciliar su factura', ninguno: 'Sin documento conciliado' };
// What a manual class does when the movement has nothing registered yet.
const EFECTO = {
  materiales: 'Se registrará como pago de materiales provisional y aparecerá en «Materiales pendiente de asignación» para elegir la obra. Cuando el Bridge concilie su factura, la factura lo sustituirá con esta clasificación y esta obra.',
  trabajadores: 'Pasará a «Pendiente de trabajador» para repartirlo entre trabajadores y obras.',
  clientes: 'Se registrará como cobro de cliente en «Pagos de clientes».',
};
// A payment is Materiales or Trabajadores; a receipt only Clientes (the backend enforces it too).
const choices = (r) => (r.sentido === 'cobro' ? ['clientes'] : ['materiales', 'trabajadores']);
const canClassify = (r) => !r.lote && choices(r).some((c) => c !== r.clase);

function Classify({ row, onClose, onDone }) {
  const options = choices(row).filter((c) => c !== row.clase);
  const [clase, setClase] = useState(options[0] || ''), [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  // Changing what is already classified needs a reason; a first classification does not.
  const needsReason = row.conocidas.length > 0;
  const withRecords = row.registros > 0;
  const save = async () => {
    setSaving(true); setError('');
    try { onDone(await api.classifyMovement(row.id, { clase, version: row.version, reason: reason.trim() || undefined })); }
    catch (e) { setError(e.message); setSaving(false); }
  };
  return (
    <Dialog title="Clasificar movimiento" onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={saving || !clase || (needsReason && reason.trim().length < 5)} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <p><strong>{row.concepto || row.referencia || 'Movimiento'}</strong> · {row.tercero || '—'} · {eur(row.importe)} · {fecha(row.fecha)}</p>
      <p className="fin-muted fin-small">
        Ahora: {CLASE_MOV[row.clase]?.label || row.clase}.{' '}
        {row.sentido === 'cobro' ? 'Es un cobro: solo puede ser cobro de clientes.' : 'Es un pago: puede ser de materiales o a trabajadores.'}
      </p>
      {options.length ? (
        <fieldset className="fin-choices">
          <legend>Clasificar como</legend>
          {options.map((c) => (
            <label key={c} className="fin-choice">
              <input type="radio" name="clase-movimiento" checked={clase === c} onChange={() => setClase(c)} />
              <span><strong>{CLASE_MOV[c].label}</strong><br />
                <span className="fin-muted fin-small">{withRecords ? `Se clasificará entero${row.documentos ? ` su documento (${row.documentos})` : ''} de una vez.` : EFECTO[c]}</span></span>
            </label>
          ))}
        </fieldset>
      ) : <p>No hay otra clasificación posible para este movimiento.</p>}
      <label className="fin-field"><span>{needsReason ? 'Motivo del cambio' : 'Motivo (opcional)'}</span>
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ej. es la factura de Obramat del baño" /></label>
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </Dialog>
  );
}

/* Concepto de movimientos (admins): every bank and cash movement with its class
 * (Pago de materiales, Pago a trabajadores, Cobro de clientes), concluded from
 * the documents the Bridge reconciled with it, or «Pendiente de clasificación». */
export default function ConceptoMovimientos({ toast, onChanged }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [clase, setClase] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    api.movements({ q: query, clase, desde, hasta, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, clase, desde, hasta, page, reload]);
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const pick = (k) => { setClase((c) => (c === k ? '' : k)); setPage(1); };
  const done = (res) => {
    setEditing(null); setReload((n) => n + 1); onChanged?.();
    toast?.(`Movimiento clasificado como ${CLASE_MOV[res.clase].label.toLowerCase()}.`);
  };
  const r = data?.resumen;
  return (
    <div className="fin-stack">
      <div className="fin-kpis">
        {['pendiente', 'materiales', 'trabajadores', 'clientes'].map((k) => (
          <Kpi key={k} label={CLASE_MOV[k].label} value={r ? num(r[k]) : '…'} icon={CLASE_MOV[k].icon}
            tone={k === 'pendiente' && r?.pendiente ? 'warn' : undefined} active={clase === k} onClick={() => pick(k)} />
        ))}
      </div>
      {r?.pendiente ? <div className="fin-warn"><i className="ri-alert-line"></i><span>{r.pendiente === 1 ? 'Queda 1 movimiento pendiente de clasificación' : `Quedan ${num(r.pendiente)} movimientos pendientes de clasificación`}: hasta clasificarlos, la rentabilidad por proyecto no está completa.</span></div> : null}
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tercero, concepto, referencia o documento" /></label>
        <label className="fin-field"><span>Clasificación</span>
          <select value={clase} onChange={filter(setClase)}>
            <option value="">Todas</option>
            {Object.entries(CLASE_MOV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
        <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
        <button className="fin-btn" type="button" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
      </div>
      {editing ? <Classify row={editing} onClose={() => setEditing(null)} onDone={done} /> : null}
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
        {data && !data.rows.length ? (clase === 'pendiente' && !query && !desde && !hasta
          ? <Empty icon="ri-checkbox-circle-line" title="Nada pendiente de clasificación" text="Todos los movimientos están clasificados." />
          : <Empty icon="ri-search-line" title="Ningún movimiento coincide" text="Prueba con otros filtros." />) : null}
        {data && data.rows.length ? <>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Tercero</th><th>Concepto / referencia</th><th>Documento</th><th className="fin-num">Importe</th><th>Clasificación</th><th><span className="fin-sr">Acciones</span></th></tr></thead>
            <tbody>{data.rows.map((m) => {
              const c = CLASE_MOV[m.clase] || CLASE_MOV.pendiente;
              return (
                <tr key={m.id}>
                  <td className="fin-nowrap">{fecha(m.fecha)}</td>
                  <td>{m.tipo === 'efectivo' ? 'Efectivo' : 'Banco'}</td>
                  <td className="fin-ellipsis" title={m.tercero || ''}>{m.tercero || '—'}</td>
                  <td className="fin-ellipsis is-wide" title={m.concepto || m.referencia || ''}>{m.concepto || m.referencia || '—'}</td>
                  <td className="fin-nowrap">{m.documentos || <span className="fin-muted">Sin documento</span>}</td>
                  <td className="fin-num fin-nowrap">{eur(m.importe)}</td>
                  <td><Badge bg={c.bg} fg={c.fg} icon={c.icon}>{c.label}</Badge><div className="fin-muted fin-small">{ORIGEN[m.origen]}</div></td>
                  <td>{canClassify(m) ? <button type="button" className="fin-btn" onClick={() => setEditing(m)}>{m.clase === 'pendiente' ? 'Clasificar' : 'Cambiar'}</button> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
        </> : null}
      </div>
    </div>
  );
}
