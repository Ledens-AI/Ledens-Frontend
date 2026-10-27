import React, { useEffect, useState } from 'react';
import { api, KIND, parseDecimal } from './api.js';
import { eur } from '../finanzas/format.js';
import { ErrorBox } from '../finanzas/ui.jsx';

const blankItem = () => ({ code: '', name: '', description: '', unit: 'ud', quantity: '', unitPrice: '', kind: 'confirmada' });
const fromVersion = (v) => (v?.chapters || []).map((c) => ({
  name: c.name,
  items: c.items.map((i) => ({ code: i.code || '', name: i.name, description: i.description || '', unit: i.unit, quantity: String(Number(i.quantity)).replace('.', ','), unitPrice: String(Number(i.unitPrice)).replace('.', ','), kind: i.kind, check: !!i.check })),
}));

/* Budget editor: chapters with coded lines (unit, quantity, net unit price,
 * kind), one VAT rate, conditions/exclusions. mode: 'new' (admin picks client
 * and jefe), 'ampliacion' (of `parent`) or 'edit' (the presupuesto `doc`). The
 * server validates everything again. */
export default function Editor({ mode, doc, parent, initial, onSaved, onCancel }) {
  const [title, setTitle] = useState(doc?.title || initial?.title || (mode === 'ampliacion' ? `Ampliación de ${parent.title}` : ''));
  const [address, setAddress] = useState(doc?.address || initial?.address || '');
  // An ampliación starts with the VAT rate of the obra it extends.
  const rateOf = doc || (mode === 'ampliacion' ? parent : null);
  const [vatRate, setVatRate] = useState(rateOf ? String(Number(rateOf.version.vatRate)).replace('.', ',') : initial ? String(initial.vatRate).replace('.', ',') : '21');
  const [notes, setNotes] = useState(doc?.version.notes || initial?.notes || '');
  const [chapters, setChapters] = useState(() => (doc ? fromVersion(doc.version) : initial ? fromVersion(initial) : [{ name: '', items: [blankItem()] }]));
  const [opts, setOpts] = useState(null);
  const [clientId, setClientId] = useState('');
  const [jefeId, setJefeId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (mode === 'new') api.options().then(setOpts, (e) => setError(e.message)); }, [mode]);

  const setChapter = (ci, patch) => setChapters((cs) => cs.map((c, i) => (i === ci ? { ...c, ...patch } : c)));
  const setItem = (ci, ii, patch) => setChapters((cs) => cs.map((c, i) => (i === ci ? { ...c, items: c.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : c)));
  const lineAmount = (it) => { const q = parseDecimal(it.quantity, 3), p = parseDecimal(it.unitPrice, 6); return q && p ? Number(q) * Number(p) : 0; };
  const counted = (it) => it.kind === 'confirmada' || it.kind === 'condicionada';
  // Summed unrounded, rounded once (as the server does).
  const base = Math.round(chapters.reduce((a, c) => a + c.items.reduce((b, it) => b + (counted(it) ? lineAmount(it) : 0), 0), 0) * 100) / 100;
  const rate = Number(parseDecimal(vatRate, 2) ?? 0);

  const save = async (send) => {
    setError('');
    const r = parseDecimal(vatRate, 2);
    if (r === null || Number(r) >= 100) return setError('Tipo de IVA no válido');
    const body = { title, address, vatRate: r, notes, chapters: [] };
    for (const [ci, c] of chapters.entries()) {
      const items = [];
      for (const [ii, it] of c.items.entries()) {
        const where = `partida ${ci + 1}.${ii + 1}`;
        const quantity = parseDecimal(it.quantity, 3), unitPrice = parseDecimal(it.unitPrice, 6);
        if (!it.name.trim()) return setError(`Falta el nombre de la ${where}`);
        if (!quantity || Number(quantity) === 0) return setError(`Cantidad no válida en la ${where}`);
        if (unitPrice === null) return setError(`Precio no válido en la ${where}`);
        const { check, ...line } = it;
        items.push({ ...line, quantity, unitPrice });
      }
      body.chapters.push({ name: c.name, items });
    }
    if (mode === 'new') { body.clientId = clientId; body.jefeId = jefeId || undefined; }
    if (mode === 'ampliacion') body.parentId = parent.id;
    if (mode === 'edit') body.version = doc.versions[0]?.number;
    setSaving(true);
    try {
      onSaved(mode === 'edit' ? await api.save(doc.id, body) : await api.create(body), { send: send === true });
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fin-stack obr-editor">
      <div className="fin-page-head">
        <h1>{initial ? 'Revisar presupuesto leído del PDF' : mode === 'new' ? 'Nuevo presupuesto' : mode === 'ampliacion' ? 'Nueva ampliación' : `Editar ${doc.ref}`}</h1>
        <p>{mode === 'edit' && doc.versions[0]?.status !== 'draft'
          ? `El cliente ya tiene la versión ${doc.versions[0].number}. Al guardar se prepara la versión ${doc.versions[0].number + 1} como borrador; no la verá hasta que la envíes.`
          : initial ? 'Comprueba capítulos, partidas, mediciones y precios, elige el cliente y envíaselo: quedará pendiente de su aprobación. Los precios se guardan sin IVA.'
          : 'Se guarda como borrador. El cliente no lo verá hasta que lo envíes. Los precios son sin IVA.'}</p>
      </div>
      {initial ? <PdfSummary initial={initial} all={Math.round(chapters.reduce((a, c) => a + c.items.reduce((b, it) => b + lineAmount(it), 0), 0) * 100) / 100} rate={rate} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <div className="fin-card fin-form">
        <div className="obr-grid">
          <label className="fin-field obr-span2"><span>Título</span><input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Reforma de baño principal" /></label>
          <label className="fin-field obr-span2"><span>Dirección de la obra</span><input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} /></label>
          {mode === 'new' ? (<>
            <label className="fin-field"><span>Cliente</span>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">{opts ? 'Selecciona el cliente' : 'Cargando…'}</option>
                {(opts?.clients || []).map((c) => <option key={c.id} value={c.id}>{`${c.name} · ${c.email}`}</option>)}
              </select>
            </label>
            <label className="fin-field"><span>Jefe de obra</span>
              <select value={jefeId} onChange={(e) => setJefeId(e.target.value)}>
                <option value="">Sin asignar</option>
                {(opts?.jefes || []).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </label>
          </>) : null}
          <label className="fin-field"><span>IVA (%)</span><input className="fin-w-num" inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(e.target.value)} /></label>
        </div>
      </div>

      {chapters.map((c, ci) => (
        <div className="fin-card" key={ci}>
          <div className="fin-card-head">
            <label className="fin-field fin-grow"><span>{`Capítulo ${ci + 1}`}</span><input value={c.name} maxLength={200} onChange={(e) => setChapter(ci, { name: e.target.value })} placeholder="Fontanería y saneamiento" /></label>
            <button type="button" className="fin-btn is-ghost fin-self-end" onClick={() => setChapters((cs) => cs.filter((_, i) => i !== ci))} aria-label={`Quitar capítulo ${ci + 1}`}><i className="ri-delete-bin-line"></i></button>
          </div>
          <div className="fin-table-wrap">
            <table className="fin-table obr-edit-table">
              <thead><tr><th>Código</th><th>Partida y descripción</th><th>Tipo</th><th>Unidad</th><th className="fin-num">Cantidad</th><th className="fin-num">Precio (sin IVA)</th><th className="fin-num">Importe</th><th></th></tr></thead>
              <tbody>
                {c.items.map((it, ii) => (
                  <tr key={ii} className={it.check ? 'obr-check' : undefined} title={it.check ? 'Cantidad × precio no coincide con el importe del PDF: revísala' : undefined}>
                    <td><input aria-label="Código" value={it.code} maxLength={40} onChange={(e) => setItem(ci, ii, { code: e.target.value })} className="obr-in obr-in-code" /></td>
                    <td>
                      <input aria-label="Partida" value={it.name} maxLength={300} onChange={(e) => setItem(ci, ii, { name: e.target.value })} className="obr-in" placeholder="Nombre de la partida" />
                      <textarea aria-label="Descripción" value={it.description} maxLength={4000} rows={2} onChange={(e) => setItem(ci, ii, { description: e.target.value })} className="obr-in obr-in-desc" placeholder="Descripción (opcional)" />
                    </td>
                    <td><select aria-label="Tipo" value={it.kind} onChange={(e) => setItem(ci, ii, { kind: e.target.value })}>{Object.entries(KIND).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></td>
                    <td><input aria-label="Unidad" value={it.unit} maxLength={20} onChange={(e) => setItem(ci, ii, { unit: e.target.value })} className="obr-in obr-in-unit" /></td>
                    <td className="fin-num"><input aria-label="Cantidad" inputMode="decimal" value={it.quantity} onChange={(e) => setItem(ci, ii, { quantity: e.target.value })} className={'obr-in obr-in-num' + (it.quantity && !parseDecimal(it.quantity, 3) ? ' is-invalid' : '')} /></td>
                    <td className="fin-num"><input aria-label="Precio unitario" inputMode="decimal" value={it.unitPrice} onChange={(e) => setItem(ci, ii, { unitPrice: e.target.value })} className={'obr-in obr-in-num' + (it.unitPrice && parseDecimal(it.unitPrice, 6) === null ? ' is-invalid' : '')} /></td>
                    <td className="fin-num fin-nowrap">{eur(lineAmount(it))}{counted(it) ? null : <div className="fin-muted fin-small">no suma</div>}</td>
                    <td><button type="button" className="fin-btn is-ghost is-small" aria-label="Quitar partida" onClick={() => setChapter(ci, { items: c.items.filter((_, j) => j !== ii) })}><i className="ri-close-line"></i></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="fin-btn is-small obr-mt" onClick={() => setChapter(ci, { items: [...c.items, blankItem()] })}><i className="ri-add-line"></i>Añadir partida</button>
        </div>
      ))}
      <div><button type="button" className="fin-btn" onClick={() => setChapters((cs) => [...cs, { name: '', items: [blankItem()] }])}><i className="ri-add-line"></i>Añadir capítulo</button></div>

      <div className="fin-card fin-form">
        <label className="fin-field"><span>Condiciones y exclusiones</span><textarea rows={4} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="No incluye permisos ni tasas…" /></label>
        <div className="obr-totals">
          <span>Base imponible</span><strong>{eur(base)}</strong>
          <span>{`IVA ${vatRate || 0} %`}</span><strong>{eur(Math.round(base * rate) / 100)}</strong>
          <span>Total con IVA</span><strong>{eur(base + Math.round(base * rate) / 100)}</strong>
        </div>
        <p className="fin-muted fin-small">Las partidas pendientes de decisión y las opciones solo suman si el cliente las elige al aprobar.</p>
      </div>
      <div className="obr-actions">
        <button type="button" className="fin-btn" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="button" className={'fin-btn' + (initial ? '' : ' is-primary')} onClick={() => save(false)} disabled={saving}><i className="ri-save-line"></i>{saving ? 'Guardando…' : 'Guardar borrador'}</button>
        {initial ? <button type="button" className="fin-btn is-primary" onClick={() => save(true)} disabled={saving}><i className="ri-send-plane-line"></i>{saving ? 'Guardando…' : 'Guardar y enviar al cliente'}</button> : null}
      </div>
    </div>
  );
}

// What was read from the PDF, to compare before sending.
// `all`: every line, options included, as the PDF adds them up.
function PdfSummary({ initial, all, rate }) {
  const total = Math.round((all + all * rate / 100) * 100) / 100;
  const doc = Number(initial.totalDocument);
  const shown = initial.pricesIncludeVat ? total : all;
  const differs = Math.abs(shown - doc) > 0.05;
  return (
    <div className="fin-stack">
      <p className={differs ? 'fin-warn' : 'fin-muted'}>
        <i className={initial.source === 'ocr' ? 'ri-scan-2-line' : 'ri-file-text-line'}></i>
        {` Leído ${initial.source === 'ocr' ? 'con OCR' : 'del texto del PDF'}: suma de importes del PDF ${eur(doc)} ${initial.pricesIncludeVat ? 'con IVA (los precios se han pasado a base imponible)' : 'sin IVA'}; ahora ${eur(shown)}.`}
        {differs ? ' No coinciden: revisa las partidas marcadas o las que falten.' : ''}
      </p>
      {initial.warnings?.length ? <div className="fin-warn"><i className="ri-error-warning-line"></i><span>{initial.warnings.join(' ')}</span></div> : null}
    </div>
  );
}
