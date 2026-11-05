import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { eur, num } from '../finanzas/format.js';
import { Badge, Dialog, Empty, ErrorBox, Pager } from '../finanzas/ui.jsx';

/* Partidas (admins): the base de partidas (ledens.work_items, backend:
 * presupuestos/partidas.js). The table shows the important columns (name,
 * description, unit, prices, rendimiento…); «Editar» opens every value of the
 * partida. The columns come from the database itself, so a column added to
 * the base by the accounting import shows up here without a code change. The
 * code (PA-###) is never edited: budgets keep it. Spanish only. */
const isPrice = (k) => /price|precio/.test(k);
const show = (col, v, categoryCode) => {
  if (v == null || v === '') return '—';
  if (col.kind === 'category') return categoryCode ? `${categoryCode} · ${v}` : v;
  if (col.kind === 'number') return isPrice(col.key) ? eur(v) : num(v);
  if (col.kind === 'boolean') return v === 'true' ? 'Sí' : 'No';
  return v;
};
// What an input shows for a stored value (numbers with a decimal comma).
const toInput = (col, v, categoryCode) => (col.kind === 'category' ? categoryCode || '' : v == null ? '' : col.kind === 'number' ? String(Number(v)).replace('.', ',') : v);

export default function Partidas({ toast, readOnly }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [categoria, setCategoria] = useState('');
  const [activa, setActiva] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [reload, setReload] = useState(0);
  // Search as you type, without one request per key.
  useEffect(() => { const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    api.partidas({ q: query, categoria, activa, pagina: page }).then((d) => { if (n === seq.current) { setData(d); setError(''); } }, (e) => n === seq.current && setError(e.message));
  }, [query, categoria, activa, page]);
  useEffect(() => { load(); }, [load, reload]);
  const filter = (set) => (e) => { set(e.target.value); setPage(1); };
  const main = data ? data.columns.filter((c) => c.main && c.key !== 'id_partida') : [];
  const codeCol = data?.columns.find((c) => c.key === 'id_partida');

  return (
    <div className="fin obr">
      <div className="fin-page-head">
        <h1>Partidas</h1>
        <p>La base de partidas con la que se valoran los presupuestos (PDF, documentación de la visita y editor). Aquí se ven los valores principales de cada partida; «Editar» abre todos sus campos. Cada cambio queda en Auditoría. El código PA-### no se cambia: los presupuestos lo conservan.</p>
      </div>
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, descripción o palabras clave" /></label>
        <label className="fin-field"><span>Categoría</span>
          <select value={categoria} onChange={filter(setCategoria)}>
            <option value="">Todas</option>
            {(data?.categories || []).map((c) => <option key={c.code} value={c.code}>{`${c.code} · ${c.name}`}</option>)}
          </select></label>
        <label className="fin-field"><span>Estado</span>
          <select value={activa} onChange={filter(setActiva)}>
            <option value="">Todas</option><option value="si">Activas</option><option value="no">Inactivas</option>
          </select></label>
        <button className="fin-btn" type="button" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
      </div>
      {editing ? <Editar partida={editing} data={data} readOnly={readOnly} onClose={() => setEditing(null)}
        onSaved={(p, changed) => { setEditing(null); if (changed) { toast?.(p.values.id_partida ? `Partida ${p.values.id_partida} guardada` : 'Partida guardada'); setData((d) => ({ ...d, partidas: d.partidas.map((x) => (x.id === p.id ? p : x)) })); } else toast?.('Sin cambios'); }} /> : null}
      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={load} /> : null}
        {!error && !data ? <div className="fin-loading fin-muted">Cargando…</div> : null}
        {data && !data.partidas.length ? <Empty icon="ri-search-line" title="Ninguna partida coincide" text="Prueba con otros filtros." /> : null}
        {data && data.partidas.length ? <>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr>
              <th>{codeCol?.label || 'Código'}</th>
              {main.map((c) => <th key={c.key} className={c.kind === 'number' ? 'fin-num' : undefined}>{c.label}</th>)}
              <th><span className="fin-sr">Acciones</span></th>
            </tr></thead>
            <tbody>{data.partidas.map((p) => (
              <tr key={p.id}>
                <td className="fin-nowrap"><strong>{p.values.id_partida || '—'}</strong></td>
                {main.map((c) => {
                  const v = p.values[c.key];
                  if (c.kind === 'yesno') return <td key={c.key}>{v ? <Badge bg={v.toUpperCase() === 'SI' ? '#E6F4EA' : '#EDEDEA'} fg={v.toUpperCase() === 'SI' ? '#1E7B34' : '#3A3A38'}>{v.toUpperCase() === 'SI' ? 'Sí' : 'No'}</Badge> : '—'}</td>;
                  const text = show(c, v, p.categoryCode);
                  return <td key={c.key} className={c.kind === 'number' ? 'fin-num fin-nowrap' : c.long || c.key === 'name' ? 'fin-ellipsis is-wide' : 'fin-ellipsis'} title={typeof text === 'string' ? text : ''}>{text}</td>;
                })}
                <td><button type="button" className="fin-btn" onClick={() => setEditing(p)}>{readOnly ? 'Ver' : 'Editar'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </> : null}
      </div>
    </div>
  );
}

function Editar({ partida, data, readOnly, onClose, onSaved }) {
  const cols = data.columns;
  const initial = Object.fromEntries(cols.map((c) => [c.key, toInput(c, partida.values[c.key], partida.categoryCode)]));
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const dirty = cols.filter((c) => c.editable && f[c.key] !== initial[c.key]);
  const save = async () => {
    setBusy(true); setError('');
    // `from` is the value as stored (what the server compares), `to` what was typed.
    const changes = Object.fromEntries(dirty.map((c) => [c.key, { from: c.kind === 'category' ? partida.categoryCode || '' : partida.values[c.key] ?? '', to: f[c.key] }]));
    try {
      const r = await api.guardarPartida(partida.id, { changes });
      onSaved(r.partida, r.changed);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const field = (c) => {
    const dis = readOnly || !c.editable || busy;
    const label = <span>{c.label}{dirty.includes(c) ? ' •' : ''}</span>;
    if (c.kind === 'category') {
      return <label key={c.key} className="fin-field">{label}
        <select value={f[c.key]} onChange={set(c.key)} disabled={dis}>
          {f[c.key] ? null : <option value="">Sin categoría</option>}
          {data.categories.map((x) => <option key={x.code} value={x.code}>{`${x.code} · ${x.name}`}</option>)}
        </select></label>;
    }
    if (c.kind === 'yesno' || c.kind === 'boolean') {
      const [yes, no] = c.kind === 'yesno' ? ['SI', 'NO'] : ['true', 'false'];
      return <label key={c.key} className="fin-field">{label}
        <select value={c.kind === 'yesno' ? String(f[c.key]).toUpperCase() : f[c.key]} onChange={set(c.key)} disabled={dis}>
          <option value="">Sin indicar</option><option value={yes}>Sí</option><option value={no}>No</option>
        </select></label>;
    }
    if (c.long) return <label key={c.key} className="fin-field obr-span2">{label}<textarea rows={c.key === 'definicion_partida' ? 5 : 3} maxLength={c.max} value={f[c.key]} onChange={set(c.key)} disabled={dis} /></label>;
    if (c.key === 'unit_source') {
      return <label key={c.key} className="fin-field">{label}<input list="partidas-unidades" maxLength={c.max} value={f[c.key]} onChange={set(c.key)} disabled={dis} />
        <datalist id="partidas-unidades">{data.units.map((u) => <option key={u} value={u} />)}</datalist></label>;
    }
    return <label key={c.key} className={'fin-field' + (c.key === 'name' ? ' obr-span2' : '')}>{label}
      <input type={c.kind === 'date' ? 'date' : 'text'} inputMode={c.kind === 'number' ? 'decimal' : undefined} maxLength={c.kind === 'text' ? c.max : undefined}
        value={f[c.key]} onChange={set(c.key)} disabled={dis} title={c.editable ? undefined : 'Este campo no se modifica desde aquí'} /></label>;
  };
  const prices = cols.filter((c) => /^sale_price_(in|ex)cluding_vat$/.test(c.key));
  return (
    <Dialog wide title={`${partida.values.id_partida || 'Partida'} · ${partida.values.name || ''}`} onClose={busy ? undefined : onClose}
      actions={<>
        <button type="button" className="fin-btn" onClick={onClose} disabled={busy}>{readOnly ? 'Cerrar' : 'Cancelar'}</button>
        {readOnly ? null : <button type="button" className="fin-btn is-primary" onClick={save} disabled={busy || !dirty.length}><i className="ri-save-line"></i>{busy ? 'Guardando…' : dirty.length ? `Guardar ${dirty.length === 1 ? '1 cambio' : `${dirty.length} cambios`}` : 'Guardar'}</button>}
      </>}>
      {error ? <span className="fin-error-inline">{error}</span> : null}
      {prices.length === 2 && !readOnly ? <p className="fin-muted fin-small">Si cambias solo uno de los dos precios, el otro se recalcula con el 21 % de IVA.</p> : null}
      <div className="obr-grid">{cols.filter((c) => c.main).map(field)}</div>
      {cols.some((c) => !c.main) ? <>
        <h3 className="fin-small fin-muted" style={{ margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Más datos de la partida</h3>
        <div className="obr-grid">{cols.filter((c) => !c.main).map(field)}</div>
      </> : null}
    </Dialog>
  );
}
