import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { eur, fechaHora } from '../finanzas/format.js';
import { Empty, ErrorBox } from '../finanzas/ui.jsx';

/* Partidas propuestas (admins): lines of imported budgets that no partida of
 * the base covers. Approving appends a partida to the base (ledens.work_items)
 * with the next free PA-###; nothing existing is changed. Spanish only. */
export default function Propuestas({ toast, onCount, readOnly }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('pending');
  // The parent passes a new onCount each render: read it through a ref so a
  // refreshed badge does not reload this list again.
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const load = useCallback(() => api.propuestas(status).then((d) => { setData(d); setError(''); if (status === 'pending') countRef.current?.(d.propuestas.length); }, (e) => setError(e.message)), [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="fin obr">
      <div className="fin-page-head">
        <h1>Partidas propuestas</h1>
        <p>Líneas de presupuestos importados que ninguna partida de la base cubre. Al aprobarla se añade al final de la base con el siguiente código PA-### libre; las partidas existentes no se modifican. Sin precio queda inactiva y pendiente de valoración.</p>
      </div>
      <div className="fin-segmented">
        {[['pending', 'Pendientes'], ['approved', 'Aprobadas'], ['rejected', 'Rechazadas']].map(([k, l]) => <button key={k} type="button" className={status === k ? 'is-on' : ''} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {!data ? <div className="fin-loading fin-muted">Cargando…</div>
        : !data.propuestas.length ? <Empty icon="ri-add-box-line" title={status === 'pending' ? 'No hay partidas pendientes' : 'Nada por aquí'} text="Aparecen al guardar un presupuesto importado de PDF con líneas que la base no cubre." />
        : data.propuestas.map((p) => <Propuesta key={p.id} p={p} categories={data.categories} readOnly={readOnly || status !== 'pending'} toast={toast} onDone={load} />)}
    </div>
  );
}

function Propuesta({ p, categories, readOnly, toast, onDone }) {
  const [f, setF] = useState({
    name: p.name, definition: p.definition || '', unit: p.unit, priceInclVat: p.priceInclVat == null ? '' : String(Number(p.priceInclVat)).replace('.', ','),
    categoryCode: p.categoryCode || '', newCategoryName: '', incluyeMateriales: '', subcategoria: '', palabrasClave: '', note: '',
  });
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const approve = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...f, priceInclVat: f.priceInclVat.trim() === '' ? '' : f.priceInclVat.replace(/\./g, '').replace(',', '.') };
      if (f.categoryCode !== '__new') delete body.newCategoryName; else body.categoryCode = '';
      const r = await api.aprobarPropuesta(p.id, body);
      toast?.(`Partida ${r.code} añadida a la base${r.active ? '' : ' (inactiva, pendiente de valoración)'}`);
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const reject = async () => {
    setBusy(true); setError('');
    try { await api.rechazarPropuesta(p.id, { note: f.note }); toast?.('Propuesta rechazada'); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="fin-card fin-form">
      <div className="fin-card-head">
        <div>
          <h2>{p.status === 'approved' ? `${p.createdCode} · ${p.name}` : p.name}</h2>
          <span className="fin-muted fin-small">{[p.presupuesto ? `${p.presupuesto.ref} «${p.presupuesto.title}»` : null, p.line ? `línea «${p.line.name}»` : null, `propuesta por ${p.createdBy || '—'} el ${fechaHora(p.createdAt)}`].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="obr-base-chip is-new">{p.priceInclVat == null ? 'Sin precio' : `${eur(p.priceInclVat)} IVA incl. / ${p.unit}`}</span>
      </div>
      {p.reason ? <p className="fin-muted fin-small">{p.reason}</p> : null}
      {p.origin ? <p className="fin-muted fin-small">{p.origin}{p.priceSource ? ` Precio: ${p.priceSource}.` : ''}</p> : null}
      {p.decisionNote ? <p className="fin-warn">{`${p.status === 'rejected' ? 'Rechazada' : 'Nota'} (${p.decidedBy || '—'}): ${p.decisionNote}`}</p> : null}
      {error ? <span className="fin-error-inline">{error}</span> : null}
      {readOnly ? null : (<>
        <div className="obr-grid">
          <label className="fin-field obr-span2"><span>Nombre</span><input value={f.name} maxLength={300} onChange={set('name')} /></label>
          <label className="fin-field"><span>Unidad</span><input value={f.unit} maxLength={20} onChange={set('unit')} /></label>
          <label className="fin-field"><span>Precio con IVA (vacío: sin precio)</span><input inputMode="decimal" value={f.priceInclVat} onChange={set('priceInclVat')} /></label>
          <label className="fin-field"><span>Categoría</span>
            <select value={f.categoryCode} onChange={set('categoryCode')}>
              <option value="">Elige una categoría</option>
              {categories.map((c) => <option key={c.code} value={c.code}>{`${c.code} · ${c.name}`}</option>)}
              <option value="__new">Nueva categoría…</option>
            </select>
          </label>
          {f.categoryCode === '__new' ? <label className="fin-field"><span>Nombre de la categoría nueva</span><input value={f.newCategoryName} maxLength={200} onChange={set('newCategoryName')} /></label> : null}
          <label className="fin-field"><span>Incluye materiales</span>
            <select value={f.incluyeMateriales} onChange={set('incluyeMateriales')}><option value="">Sin indicar</option><option value="SI">SI</option><option value="NO">NO</option></select>
          </label>
          <label className="fin-field"><span>Subcategoría</span><input value={f.subcategoria} maxLength={200} onChange={set('subcategoria')} /></label>
          <label className="fin-field obr-span2"><span>Palabras clave</span><input value={f.palabrasClave} maxLength={1000} onChange={set('palabrasClave')} placeholder="separadas por comas" /></label>
          <label className="fin-field obr-span2"><span>Definición (incluye, auxiliares, no incluye)</span><textarea rows={4} maxLength={4000} value={f.definition} onChange={set('definition')} /></label>
          <label className="fin-field obr-span2"><span>{rejecting ? 'Motivo del rechazo' : 'Nota (opcional)'}</span><input value={f.note} maxLength={1000} onChange={set('note')} /></label>
        </div>
        <div className="obr-actions obr-start">
          {rejecting ? (<>
            <button type="button" className="fin-btn" onClick={() => setRejecting(false)} disabled={busy}>Cancelar</button>
            <button type="button" className="fin-btn is-danger" onClick={reject} disabled={busy || !f.note.trim()}>Rechazar propuesta</button>
          </>) : (<>
            <button type="button" className="fin-btn is-danger" onClick={() => setRejecting(true)} disabled={busy}>Rechazar…</button>
            <button type="button" className="fin-btn is-primary" onClick={approve} disabled={busy || !f.categoryCode || (f.categoryCode === '__new' && !f.newCategoryName.trim())}><i className="ri-check-line"></i>Aprobar y añadir a la base</button>
          </>)}
        </div>
      </>)}
    </div>
  );
}
