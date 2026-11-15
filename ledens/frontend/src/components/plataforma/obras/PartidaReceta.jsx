import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Dialog } from '../finanzas/ui.jsx';

/* Recetas de las partidas (backend: presupuestos/recetas.js, migration 046):
 * the tools a partida requires (types of Ledens Tools) and the materials one
 * unit of it consumes. Shown in «Partidas» → Herramientas / Materiales; only
 * an admin edits them. Every change is saved at once and audited. Spanish only. */
const NUM = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });
export const qty = (v) => (v === null || v === undefined || v === '' ? '—' : NUM.format(Number(v)));
const toInput = (v) => (v === null || v === undefined ? '' : String(Number(v)).replace('.', ','));
const UNITS = ['ud', 'm', 'm²', 'm³', 'kg', 'l', 'saco', 'caja', 'rollo', 'cartucho', 'bote'];
export const KINDS = {
  herramientas: { title: 'Herramientas', empty: 'Sin herramientas', edit: 'Editar herramientas' },
  materiales: { title: 'Materiales', empty: 'Sin materiales', edit: 'Editar materiales' },
};

// One cell of the table: what the partida's receta says, in short.
export function RecetaResumen({ receta, kind, unit }) {
  const rows = receta?.[kind] || [];
  if (!rows.length) return <span className="fin-muted">{KINDS[kind].empty}</span>;
  if (kind === 'herramientas') {
    return <span className="obr-chips">{rows.map((h) => <span key={h.id} className="obr-chip" title={h.category}>{h.quantity > 1 ? `${h.name} ×${h.quantity}` : h.name}</span>)}</span>;
  }
  return (
    <ul className="obr-receta">{rows.map((m) => (
      <li key={m.id}><strong>{m.name}</strong>{` · ${qty(m.quantity)} ${m.unit}${unit ? ` por ${unit}` : ''}${Number(m.wastePct) ? ` + ${qty(m.wastePct)} % merma` : ''}`}</li>
    ))}</ul>
  );
}

export function RecetaDialog({ partida, kind, readOnly, onClose, onChange }) {
  const code = partida.values.id_partida;
  const unit = partida.values.unit_source;
  const [receta, setReceta] = useState(partida.receta || { herramientas: [], materiales: [] });
  const [types, setTypes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (kind === 'herramientas' && !readOnly) api.herramientasTipos().then(setTypes, (e) => setError(e.message)); }, [kind, readOnly]);
  const run = async (fn) => {
    setBusy(true); setError('');
    try { const r = await fn(); setReceta(r); onChange?.(r); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const rows = receta[kind] || [];
  return (
    <Dialog wide title={`${KINDS[kind].title} · ${code} · ${partida.values.name || ''}`} onClose={busy ? undefined : onClose}
      actions={<button type="button" className="fin-btn" onClick={onClose} disabled={busy}>Cerrar</button>}>
      <p className="fin-muted fin-small">{kind === 'herramientas'
        ? 'Herramientas obligatorias para ejecutar esta partida (cantidad por cuadrilla). Al comenzar la obra se comparan con las que hay en ella y se pueden solicitar las que faltan.'
        : `Cantidad de cada material por 1 ${unit || 'unidad'} de la partida, más la merma. Al presupuestar se multiplica por la medición de cada línea.`}</p>
      {error ? <span className="fin-error-inline">{error}</span> : null}
      {rows.length ? (
        <div className="fin-table-wrap"><table className="fin-table">
          <thead><tr>{kind === 'herramientas'
            ? <><th>Herramienta</th><th>Categoría</th><th className="fin-num">Cantidad</th><th>Observaciones</th></>
            : <><th>Material</th><th>Unidad</th><th className="fin-num">{`Por ${unit || 'unidad'}`}</th><th className="fin-num">Merma %</th><th>Observaciones</th></>}
            {readOnly ? null : <th><span className="fin-sr">Acciones</span></th>}</tr></thead>
          <tbody>{rows.map((r) => kind === 'herramientas'
            ? <ToolRow key={r.id} row={r} readOnly={readOnly} busy={busy} onSave={(b) => run(() => api.recetaUpdate(code, kind, r.id, b))} onRemove={() => run(() => api.recetaRemove(code, kind, r.id))} />
            : <MatRow key={r.id} row={r} readOnly={readOnly} busy={busy} onSave={(b) => run(() => api.recetaUpdate(code, kind, r.id, b))} onRemove={() => run(() => api.recetaRemove(code, kind, r.id))} />)}</tbody>
        </table></div>
      ) : <p className="fin-muted">{`${KINDS[kind].empty} todavía.`}</p>}
      {readOnly ? null : kind === 'herramientas'
        ? <AddTool types={types} busy={busy} taken={rows.map((r) => r.toolTypeId)} onAdd={(b) => run(() => api.recetaAdd(code, kind, b))} />
        : <AddMat unit={unit} busy={busy} onAdd={(b) => run(() => api.recetaAdd(code, kind, b))} />}
    </Dialog>
  );
}

function ToolRow({ row, readOnly, busy, onSave, onRemove }) {
  const [f, setF] = useState({ quantity: String(row.quantity), notes: row.notes || '' });
  useEffect(() => { setF({ quantity: String(row.quantity), notes: row.notes || '' }); }, [row.quantity, row.notes]);
  const dirty = f.quantity !== String(row.quantity) || f.notes !== (row.notes || '');
  return (
    <tr>
      <td><strong>{row.name}</strong>{row.origin === 'inicial' ? <span className="fin-muted fin-small"> · inicial</span> : null}</td>
      <td>{row.category}</td>
      <td className="fin-num">{readOnly ? row.quantity : <input className="obr-num-input" type="number" min="1" max="99" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} disabled={busy} aria-label="Cantidad" />}</td>
      <td>{readOnly ? row.notes || '—' : <input value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={busy} aria-label="Observaciones" />}</td>
      {readOnly ? null : <td className="fin-nowrap">
        {dirty ? <button type="button" className="fin-btn is-primary" disabled={busy || !(Number(f.quantity) >= 1)} onClick={() => onSave({ quantity: f.quantity, notes: f.notes })}>Guardar</button> : null}
        <button type="button" className="fin-btn" disabled={busy} onClick={onRemove} title="Quitar de la partida"><i className="ri-delete-bin-line"></i>Quitar</button>
      </td>}
    </tr>
  );
}

function MatRow({ row, readOnly, busy, onSave, onRemove }) {
  const init = () => ({ name: row.name, unit: row.unit, quantity: toInput(row.quantity), wastePct: toInput(row.wastePct), notes: row.notes || '' });
  const [f, setF] = useState(init);
  useEffect(() => { setF(init()); }, [row.name, row.unit, row.quantity, row.wastePct, row.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const i = init();
  const dirty = Object.keys(i).some((k) => f[k] !== i[k]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (readOnly) {
    return <tr><td><strong>{row.name}</strong></td><td>{row.unit}</td><td className="fin-num">{qty(row.quantity)}</td><td className="fin-num">{qty(row.wastePct)}</td><td>{row.notes || '—'}</td></tr>;
  }
  return (
    <tr>
      <td><input value={f.name} maxLength={160} onChange={set('name')} disabled={busy} aria-label="Material" />{row.origin === 'inicial' ? <span className="fin-muted fin-small"> inicial</span> : null}</td>
      <td><input className="obr-unit-input" list="receta-unidades" value={f.unit} maxLength={20} onChange={set('unit')} disabled={busy} aria-label="Unidad" /></td>
      <td className="fin-num"><input className="obr-num-input" inputMode="decimal" value={f.quantity} onChange={set('quantity')} disabled={busy} aria-label="Cantidad por unidad" /></td>
      <td className="fin-num"><input className="obr-num-input" inputMode="decimal" value={f.wastePct} onChange={set('wastePct')} disabled={busy} aria-label="Merma %" /></td>
      <td><input value={f.notes} maxLength={500} onChange={set('notes')} disabled={busy} aria-label="Observaciones" /></td>
      <td className="fin-nowrap">
        {dirty ? <button type="button" className="fin-btn is-primary" disabled={busy || !f.name.trim() || !f.unit.trim() || !f.quantity} onClick={() => onSave(f)}>Guardar</button> : null}
        <button type="button" className="fin-btn" disabled={busy} onClick={onRemove} title="Quitar de la partida"><i className="ri-delete-bin-line"></i>Quitar</button>
      </td>
    </tr>
  );
}

function AddTool({ types, busy, taken, onAdd }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [category, setCategory] = useState('');
  const match = types?.types.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const isNew = !!name.trim() && !match;
  const add = async () => {
    const ok = await onAdd(match ? { toolTypeId: match.id, quantity } : { name: name.trim(), category: category || undefined, quantity });
    if (ok) { setName(''); setQuantity('1'); setCategory(''); }
  };
  return (
    <div className="fin-card obr-receta-add">
      <h3 className="obr-h3">Añadir herramienta</h3>
      <div className="obr-grid">
        <label className="fin-field obr-span2"><span>Herramienta</span>
          <input list="receta-herramientas" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Escribe o elige del inventario" disabled={busy} />
          <datalist id="receta-herramientas">{(types?.types || []).filter((t) => !taken.includes(t.id)).map((t) => <option key={t.id} value={t.name}>{t.category}</option>)}</datalist></label>
        <label className="fin-field"><span>Cantidad</span><input type="number" min="1" max="99" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={busy} /></label>
        {isNew ? <label className="fin-field"><span>Categoría (nueva herramienta)</span>
          <input list="receta-categorias" value={category} maxLength={80} onChange={(e) => setCategory(e.target.value)} placeholder="General" disabled={busy} />
          <datalist id="receta-categorias">{(types?.categories || []).map((c) => <option key={c} value={c} />)}</datalist></label> : null}
      </div>
      {isNew ? <p className="fin-muted fin-small">No está en el inventario de Herramientas: se crea allí como tipo nuevo, sin unidades.</p> : null}
      {match && taken.includes(match.id) ? <p className="fin-error-inline">Ya está en esta partida.</p> : null}
      <button type="button" className="fin-btn is-primary" disabled={busy || !name.trim() || !(Number(quantity) >= 1) || (match && taken.includes(match.id))} onClick={add}><i className="ri-add-line"></i>Añadir</button>
    </div>
  );
}

function AddMat({ unit, busy, onAdd }) {
  const empty = { name: '', unit: '', quantity: '', wastePct: '0', notes: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const add = async () => { if (await onAdd(f)) setF(empty); };
  return (
    <div className="fin-card obr-receta-add">
      <h3 className="obr-h3">Añadir material</h3>
      <div className="obr-grid">
        <label className="fin-field obr-span2"><span>Material</span><input value={f.name} maxLength={160} onChange={set('name')} placeholder="p. ej. Pintura plástica" disabled={busy} /></label>
        <label className="fin-field"><span>Unidad del material</span><input list="receta-unidades" value={f.unit} maxLength={20} onChange={set('unit')} placeholder="l, kg, ud…" disabled={busy} /></label>
        <label className="fin-field"><span>{`Cantidad por ${unit || 'unidad'} de partida`}</span><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} placeholder="0,25" disabled={busy} /></label>
        <label className="fin-field"><span>Merma %</span><input inputMode="decimal" value={f.wastePct} onChange={set('wastePct')} disabled={busy} /></label>
        <label className="fin-field"><span>Observaciones</span><input value={f.notes} maxLength={500} onChange={set('notes')} disabled={busy} /></label>
      </div>
      <datalist id="receta-unidades">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      <button type="button" className="fin-btn is-primary" disabled={busy || !f.name.trim() || !f.unit.trim() || !f.quantity.trim()} onClick={add}><i className="ri-add-line"></i>Añadir</button>
    </div>
  );
}
