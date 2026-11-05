import React, { useEffect, useState } from 'react';
import MaterialesSinRegistro from './MaterialesSinRegistro.jsx';
import { api } from './api.js';
import { eur, fecha, num } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Kpi, Pager } from './ui.jsx';

export const CLASE_MOV = {
  pendiente: { label: 'Pendiente de clasificación', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-question-line' },
  materiales: { label: 'Pago de materiales', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-hammer-line' },
  trabajadores: { label: 'Pago a trabajadores', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-user-settings-line' },
  clientes: { label: 'Cobro de clientes', bg: '#FDF0F4', fg: '#B84371', icon: 'ri-hand-coin-line' },
  reembolso_proveedor: { label: 'Reembolso de proveedor', bg: '#EEF4E4', fg: '#4A6B22', icon: 'ri-refund-2-line' },
  transferencia: { label: 'Transferencia entre cuentas', bg: '#EEF0F3', fg: '#4A5160', icon: 'ri-arrow-left-right-line' },
  mixto: { label: 'Varias clases', bg: '#F2F2EF', fg: '#3A3A38', icon: 'ri-shuffle-line' },
};
const ORIGEN = { bridge: 'Deducido del Bridge con documentos', trabajadores: 'En Pendiente de trabajador', registro: 'Registro contable del movimiento', provisional: 'Provisional hasta conciliar su factura', compra_obramat: 'Compra de Obramat con anticipo: el coste entra con la factura de entrega', devolucion_anticipo: 'Devolución de un anticipo: ya descontada de las líneas del anticipo', transferencia: 'Entre cuentas de la sociedad: ni coste ni ingreso', ninguno: 'Sin documento conciliado' };
// What a manual class does when the movement has nothing registered yet.
const EFECTO = {
  materiales: 'Se registrará como pago de materiales provisional y aparecerá en «Materiales pendiente de asignación» para elegir la obra. Cuando el Bridge concilie su factura, la factura lo sustituirá con esta clasificación y esta obra.',
  trabajadores: 'Pasará a «Pendiente de trabajador» para repartirlo entre trabajadores y obras.',
  clientes: 'Se registrará como cobro de cliente en «Pagos de clientes».',
  reembolso_proveedor: 'Se registrará en «Materiales pendiente de asignación» como material en negativo: al asignarlo a una obra, descuenta su coste de materiales.',
  transferencia: 'Movimiento entre cuentas de Sociedad Inversora Navarro Robinson: no es coste ni ingreso, no se registra nada y sale de «Pendiente de conciliación».',
};
// A payment is Materiales or Trabajadores; a receipt Clientes or, when it is a bank
// receipt, Reembolso de proveedor. Obramat's movements are always materials
// («Regla Obramat»). The backend enforces all of it too.
const refundable = (r) => r.tipo === 'banco';
// A movement with another account of the company can also be a transfer between accounts.
const choices = (r) => [...baseChoices(r), ...(r.propia && r.tipo === 'banco' && r.registros === 0 && !r.lote ? ['transferencia'] : [])];
const baseChoices = (r) => (r.obramat
  ? (r.sentido === 'cobro' ? (refundable(r) ? ['reembolso_proveedor'] : []) : ['materiales'])
  : r.sentido === 'cobro' ? ['clientes', ...(refundable(r) ? ['reembolso_proveedor'] : [])] : ['materiales', 'trabajadores']);
// Every movement can change class; only an Obramat advance is materials as is (its
// cost enters with the delivery invoice). Changing it undoes what the old class
// registered from the movement (backend undoMovementFlow).
export const canClassify = (r) => !['compra_obramat', 'devolucion_anticipo'].includes(r.origen) && choices(r).some((c) => c !== r.clase);
// The new class replaces a flow of the old one: the movement then enters as if nothing were registered.
const undoes = (r, c) => r.lote || r.clase === 'reembolso_proveedor' || (r.origen === 'provisional' && c === 'trabajadores')
  || (r.clase === 'clientes' && r.origen === 'registro' && c === 'reembolso_proveedor');
const DESHACER = {
  trabajadores: 'Se deshace el envío a «Pago a trabajadores»: las líneas pendientes salen de «Pendiente de trabajador» y los pagos ya guardados (trabajador y obra) dejan de contar; quedan en su historial.',
  materiales: 'Se deshace el pago de materiales provisional (y la obra que tuviera); queda en su historial y se recupera si vuelves a clasificarlo como pago de materiales.',
  reembolso_proveedor: 'Se deshace el reembolso de proveedor (y la obra que tuviera); queda en su historial y se recupera si vuelves a clasificarlo como reembolso.',
  clientes: 'Se deshace el cobro de cliente (y la obra que tuviera); queda en su historial y se recupera si vuelves a clasificarlo como cobro de clientes.',
};
// With records, what each class does to them.
const CON_REGISTROS = (row, c) => (c === 'reembolso_proveedor'
  ? `Se registrará como material en negativo, que descuenta coste al asignarlo a una obra.${row.documentos ? ` Los conceptos del abono (${row.documentos}) se excluyen para no contarlo dos veces; tienen que estar sin clasificar, sin obra y sumar lo mismo que el cobro.` : ''}`
  : `Se clasificará entero${row.documentos ? ` su documento (${row.documentos})` : ''} de una vez.`);

export function Classify({ row, onClose, onDone }) {
  const options = choices(row).filter((c) => c !== row.clase);
  const [clase, setClase] = useState(options[0] || ''), [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  // Changing what is already classified needs a reason; a first classification does not.
  const needsReason = row.conocidas.length > 0 || row.clase === 'transferencia';
  const withRecords = row.registros > 0;
  const undoing = (c) => undoes(row, c) && DESHACER[row.clase];
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
        {row.sentido === 'cobro'
          ? (row.obramat ? 'Es un cobro de Obramat: siempre es un reembolso de proveedor (pago de materiales).' : refundable(row) ? 'Es un cobro: puede ser cobro de clientes o reembolso de proveedor.' : 'Es un cobro en efectivo: solo puede ser cobro de clientes.')
          : row.obramat ? 'Es un pago de Obramat: siempre es pago de materiales.' : 'Es un pago: puede ser de materiales o a trabajadores.'}
      </p>
      {options.length ? (
        <fieldset className="fin-choices">
          <legend>Clasificar como</legend>
          {options.map((c) => (
            <label key={c} className="fin-choice">
              <input type="radio" name="clase-movimiento" checked={clase === c} onChange={() => setClase(c)} />
              <span><strong>{CLASE_MOV[c].label}</strong><br />
                <span className="fin-muted fin-small">{undoing(c) ? `${DESHACER[row.clase]} ${EFECTO[c]}` : withRecords ? CON_REGISTROS(row, c) : EFECTO[c]}</span></span>
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
 * (Pago de materiales, Pago a trabajadores, Cobro de clientes, Reembolso de proveedor), concluded from
 * the documents the Bridge reconciled with it, or «Pendiente de clasificación». */
export default function ConceptoMovimientos({ toast, onChanged }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [clase, setClase] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null), [rule, setRule] = useState(false);
  // «Regla Obramat» on demand (it also runs after each periodic Bridge run).
  const [orphans, setOrphans] = useState(false);
  const applyRule = async () => {
    setRule(true);
    try {
      const r = await api.applyObramatRule();
      toast?.(r.evaluados ? `Regla Obramat: ${r.clasificados} ${r.clasificados === 1 ? 'movimiento clasificado' : 'movimientos clasificados'}${r.errores ? `, ${r.errores} sin clasificar (ábrelos para ver el motivo)` : ''}.` : 'Regla Obramat: no hay movimientos de Obramat pendientes.');
      if (r.clasificados) { setReload((n) => n + 1); onChanged?.(); }
    } catch (e) { toast?.(e.message); }
    setRule(false);
  };
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
        <button className="fin-btn" type="button" disabled={rule} onClick={applyRule} title="Clasifica como pago de materiales los movimientos de Obramat pendientes">{rule ? 'Aplicando…' : 'Aplicar regla Obramat'}</button>
        <button className="fin-btn" type="button" onClick={() => setOrphans(true)} title="Materiales importados sin registro contable">Materiales sin registro</button>
      </div>
      {editing ? <Classify row={editing} onClose={() => setEditing(null)} onDone={done} /> : null}
      {orphans ? <MaterialesSinRegistro onClose={() => setOrphans(false)} onDone={() => { setReload((n) => n + 1); onChanged?.(); }} /> : null}
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
