import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Pager } from './ui.jsx';

export const CLASE = {
  materiales: { label: 'Materiales', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-hammer-line' },
  trabajadores: { label: 'Pagos a trabajadores', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-user-settings-line' },
  clientes: { label: 'Cobro de clientes', bg: '#FDF0F4', fg: '#B84371', icon: 'ri-hand-coin-line' },
  sin_clasificar: { label: 'Sin clasificar', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-question-line' },
  otros: { label: 'Otros costes', bg: '#F2F2EF', fg: '#3A3A38', icon: 'ri-more-line' },
};
// A payment can be Materiales or Trabajadores; a receipt only Clientes (the backend enforces it too).
const choices = (r) => (r.sentido === 'cobro' ? ['clientes'] : ['materiales', 'trabajadores']);

/* Change of class with its reason: only the category changes, audited. */
function Reclassify({ row, onClose, onDone }) {
  const options = choices(row).filter((c) => c !== row.clase);
  const [clase, setClase] = useState(options[0] || ''), [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const save = async () => {
    setSaving(true); setError('');
    try { onDone(await api.reclassify(row.record_id, { clase, version: row.version, reason })); }
    catch (e) { setError(e.message); setSaving(false); }
  };
  return (
    <Dialog title="Cambiar clasificación" onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={saving || !clase || reason.trim().length < 5} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <p><strong>{row.concepto || 'Registro'}</strong> · {eur(row.importe)} · {row.numerodocumento || 'Sin documento'}</p>
      <p className="fin-muted fin-small">Ahora: {CLASE[row.clase]?.label || row.clase}. {row.sentido === 'cobro' ? 'Es un cobro: solo puede ser de clientes.' : 'Es un pago: puede ser de materiales o de trabajadores.'}</p>
      {options.length ? (
        <fieldset className="fin-choices">
          <legend>Nueva clasificación</legend>
          {options.map((c) => (
            <label key={c} className="fin-choice">
              <input type="radio" name="clase" checked={clase === c} onChange={() => setClase(c)} />
              <span><strong>{CLASE[c].label}</strong></span>
            </label>
          ))}
        </fieldset>
      ) : <p>No hay otra clasificación posible para este registro.</p>}
      <label className="fin-field"><span>Motivo del cambio</span>
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ej. es mano de obra, no material" /></label>
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </Dialog>
  );
}

/* Movimientos conciliados (admins): every record behind a reconciled bank
 * movement with how it is classified, and the change of class. */
export default function Conciliados({ toast, onChanged }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [clase, setClase] = useState(''), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    api.reconciled({ q: query, clase, desde, hasta, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, clase, desde, hasta, page, reload]);
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const done = (res) => {
    setData((d) => d && ({ ...d, rows: d.rows.map((r) => (r.record_id === res.record_id ? { ...r, clase: res.clase, category: res.category, version: res.version } : r)) }));
    setEditing(null); onChanged?.(); toast?.('Clasificación cambiada a ' + CLASE[res.clase].label + '.');
  };
  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tercero, concepto, documento o movimiento" /></label>
        <label className="fin-field"><span>Clasificación</span>
          <select value={clase} onChange={filter(setClase)}><option value="">Todas</option>{Object.entries(CLASE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
        <button className="fin-btn" type="button" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
      </div>
      {editing ? <Reclassify row={editing} onClose={() => setEditing(null)} onDone={done} /> : null}
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
        {data && !data.rows.length ? <Empty icon="ri-checkbox-multiple-line" title="Sin movimientos conciliados" text="Cuando un movimiento se concilia con su factura, sus conceptos aparecen aquí." /> : null}
        {data && data.rows.length ? <>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr><th>Fecha mov.</th><th>Movimiento</th><th>Documento</th><th>Tercero</th><th>Concepto</th><th className="fin-num">Importe</th><th>Clasificación</th><th>Proyecto</th><th><span className="fin-sr">Acciones</span></th></tr></thead>
            <tbody>{data.rows.map((r) => {
              const c = CLASE[r.clase] || CLASE.otros;
              const can = r.type !== 'cliente' && choices(r).some((x) => x !== r.clase);
              return (
                <tr key={r.record_id}>
                  <td className="fin-nowrap">{fecha(r.fecha_movimiento)}</td>
                  <td className="fin-ellipsis" title={r.movimiento}>{r.movimiento || '—'}</td>
                  <td className="fin-nowrap">{r.numerodocumento || <span className="fin-muted">Sin documento</span>}{r.line_number ? <span className="fin-muted"> · línea {r.line_number}</span> : null}</td>
                  <td className="fin-ellipsis">{r.tercero || '—'}</td>
                  <td className="fin-ellipsis is-wide" title={r.concepto}>{r.concepto || '—'}</td>
                  <td className="fin-num fin-nowrap">{eur(r.importe)}</td>
                  <td><Badge bg={c.bg} fg={c.fg} icon={c.icon}>{c.label}</Badge></td>
                  <td className="fin-ellipsis">{r.project_label || (r.parts ? `${r.parts} proyectos` : <span className="fin-muted">Sin proyecto</span>)}</td>
                  <td>{can ? <button type="button" className="fin-btn" onClick={() => setEditing(r)}>Cambiar</button> : null}</td>
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
