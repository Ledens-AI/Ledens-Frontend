import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Pager } from './ui.jsx';
import { CLASE } from './Conciliados.jsx';

const CLASES = { ...CLASE, mixta: { label: 'Mixta', bg: '#F2F2EF', fg: '#3A3A38', icon: 'ri-shuffle-line' } };
// Where the lines go once classified (the tab that then lists them).
const DESTINO = { materiales: 'Materiales', trabajadores: 'Pagos a trabajadores', clientes: 'Pagos de clientes' };
// A payment invoice is Materiales or Trabajadores; a receipt only Clientes (the backend enforces it too).
const choices = (r) => (r.sentido === 'cobro' ? ['clientes'] : r.sentido === 'pago' ? ['materiales', 'trabajadores'] : ['materiales', 'trabajadores', 'clientes']);

function Classify({ row, onClose, onDone }) {
  const options = choices(row).filter((c) => c !== row.clase);
  const [clase, setClase] = useState(options[0] || ''), [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  // Changing what is already classified needs a reason; a first classification does not.
  const needsReason = row.clases.some((c) => c !== 'sin_clasificar');
  const save = async () => {
    setSaving(true); setError('');
    try { onDone(await api.classifyInvoice(row.id, { clase, version: row.version, reason: reason.trim() || undefined })); }
    catch (e) { setError(e.message); setSaving(false); }
  };
  return (
    <Dialog title="Clasificar factura" onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={saving || !clase || (needsReason && reason.trim().length < 5)} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <p><strong>{row.numerodocumento || 'Factura sin número'}</strong> · {row.tercero || '—'} · {eur(row.total)}</p>
      <p className="fin-muted fin-small">
        {row.lineas === 1 ? '1 línea' : `${row.lineas} líneas`}. Ahora: {CLASES[row.clase]?.label || row.clase}.{' '}
        {row.sentido === 'cobro' ? 'Es una factura de cobro: solo puede ser de clientes.' : row.sentido === 'pago' ? 'Es una factura de pago: puede ser de materiales o de trabajadores.' : ''}
      </p>
      {options.length ? (
        <fieldset className="fin-choices">
          <legend>Clasificar la factura completa como</legend>
          {options.map((c) => (
            <label key={c} className="fin-choice">
              <input type="radio" name="clase-factura" checked={clase === c} onChange={() => setClase(c)} />
              <span><strong>{c === 'materiales' ? 'Pago de materiales' : c === 'trabajadores' ? 'Pago de trabajadores' : 'Cobro de clientes'}</strong>
                <span className="fin-muted"> · sus líneas pasan a «{DESTINO[c]}»</span></span>
            </label>
          ))}
        </fieldset>
      ) : <p>No hay otra clasificación posible para esta factura.</p>}
      <label className="fin-field"><span>{needsReason ? 'Motivo del cambio' : 'Motivo (opcional)'}</span>
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ej. es la factura del alicatador, mano de obra" /></label>
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </Dialog>
  );
}

/* Conceptos de facturas (admins): one row per invoice whose type was not
 * recognised automatically, classified as a whole as Materiales, Pagos a
 * trabajadores or Cobro de clientes. */
export default function Facturas({ toast, onChanged }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [clase, setClase] = useState('sin_clasificar'), [desde, setDesde] = useState(''), [hasta, setHasta] = useState('');
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    api.invoices({ q: query, clase, desde, hasta, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, clase, desde, hasta, page, reload]);
  const filter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const done = (res) => {
    setEditing(null); setReload((n) => n + 1); onChanged?.();
    toast?.(`Factura clasificada: ${res.lineas === 1 ? 'su línea pasa' : `sus ${res.lineas} líneas pasan`} a «${DESTINO[res.clase]}».`);
  };
  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº de factura, emisor o concepto" /></label>
        <label className="fin-field"><span>Clasificación</span>
          <select value={clase} onChange={filter(setClase)}>
            <option value="sin_clasificar">Pendientes de clasificar</option>
            <option value="">Todas</option>
            {['materiales', 'trabajadores', 'clientes', 'mixta', 'otros'].map((k) => <option key={k} value={k}>{CLASES[k].label}</option>)}
          </select></label>
        <label className="fin-field"><span>Desde</span><input type="date" value={desde} onChange={filter(setDesde)} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={hasta} onChange={filter(setHasta)} /></label>
        <button className="fin-btn" type="button" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
      </div>
      {editing ? <Classify row={editing} onClose={() => setEditing(null)} onDone={done} /> : null}
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
        {data && !data.rows.length ? (clase === 'sin_clasificar' && !query && !desde && !hasta
          ? <Empty icon="ri-checkbox-circle-line" title="Nada por clasificar" text="Todas las facturas tienen su clasificación." />
          : <Empty icon="ri-search-line" title="Ninguna factura coincide" text="Prueba con otros filtros." />) : null}
        {data && data.rows.length ? <>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr><th>Fecha</th><th>Factura</th><th>Emisor / receptor</th><th>Conceptos</th><th className="fin-num">Líneas</th><th className="fin-num">Total</th><th>Clasificación</th><th><span className="fin-sr">Acciones</span></th></tr></thead>
            <tbody>{data.rows.map((r) => {
              const c = CLASES[r.clase] || CLASES.otros;
              const can = choices(r).some((x) => x !== r.clase);
              return (
                <tr key={r.id}>
                  <td className="fin-nowrap">{fecha(r.fecha)}</td>
                  <td className="fin-nowrap">{r.numerodocumento || <span className="fin-muted">Sin número</span>}</td>
                  <td className="fin-ellipsis" title={r.tercero || ''}>{r.tercero || '—'}</td>
                  <td className="fin-ellipsis is-wide" title={r.conceptos}>{r.conceptos || '—'}</td>
                  <td className="fin-num">{r.lineas}</td>
                  <td className="fin-num fin-nowrap">{eur(r.total)}</td>
                  <td><Badge bg={c.bg} fg={c.fg} icon={c.icon}>{c.label}</Badge></td>
                  <td>{can ? <button type="button" className="fin-btn" onClick={() => setEditing(r)}>{r.clase === 'sin_clasificar' ? 'Clasificar' : 'Cambiar'}</button> : null}</td>
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
