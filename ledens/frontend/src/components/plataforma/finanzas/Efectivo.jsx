import React, { useState } from 'react';
import { api } from './api.js';
import { eur, fecha, parseImporte } from './format.js';
import { Dialog } from './ui.jsx';
import ProjectPicker from './ProjectPicker.jsx';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* Alta de un pago o cobro en efectivo. It lands in Pendiente de conciliación,
 * where it is assigned later. onSaved receives the created entry. */
export function CashForm({ onClose, onSaved }) {
  const [f, setF] = useState({ kind: 'pago', amount: '', date: today(), concept: '', counterparty: '' });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amount = parseImporte(f.amount);
  const valid = amount !== null && Number(amount) > 0 && f.date && f.concept.trim();
  const save = async () => {
    setSaving(true); setError('');
    try { onSaved(await api.createCash({ ...f, amount })); } catch (e) { setError(e.message); setSaving(false); }
  };
  return (
    <Dialog title="Añadir efectivo" onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={!valid || saving} onClick={save}>{saving ? 'Guardando…' : 'Añadir'}</button>
      </>}>
      <div className="fin-seg" role="radiogroup" aria-label="Tipo">
        {[['pago', 'Pago (sale dinero)'], ['cobro', 'Cobro (entra dinero)']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={'fin-btn' + (f.kind === k ? ' is-primary' : '')} onClick={() => setF((x) => ({ ...x, kind: k }))}>{l}</button>
        ))}
      </div>
      <div className="fin-grid-form">
        <label className="fin-field"><span>Importe (€)</span><input inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="0,00" autoFocus aria-invalid={f.amount !== '' && amount === null} /></label>
        <label className="fin-field"><span>Fecha</span><input type="date" value={f.date} onChange={set('date')} /></label>
        <label className="fin-field fin-span-all"><span>Concepto</span><input value={f.concept} onChange={set('concept')} maxLength={300} placeholder={f.kind === 'pago' ? 'Ej. compra en ferretería, jornal…' : 'Ej. entrega a cuenta del cliente'} /></label>
        <label className="fin-field fin-span-all"><span>{f.kind === 'pago' ? 'Pagado a (opcional)' : 'Cobrado de (opcional)'}</span><input value={f.counterparty} onChange={set('counterparty')} maxLength={200} /></label>
      </div>
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </Dialog>
  );
}

/* Asignar un efectivo: a pago goes to Pagos a trabajadores (split in Pendiente
 * de trabajador) or to Pagos de materiales; a cobro goes to Pagos de clientes.
 * The project is optional: without it the record waits in Pendiente de asignación. */
export function AssignCash({ row, onClose, onDone }) {
  const pago = Number(row.importe) < 0;
  const [target, setTarget] = useState(pago ? 'trabajadores' : 'clientes');
  const [project, setProject] = useState(null), [description, setDescription] = useState(row.concepto || '');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const options = pago
    ? [['trabajadores', 'Pagos a trabajadores', 'Se reparte en líneas en Pendiente de trabajador, donde eliges trabajador y proyecto.'],
       ['materiales', 'Pagos de materiales', 'Se registra como gasto de material.']]
    : [['clientes', 'Pagos de clientes', 'Se registra como cobro del cliente.']];
  const save = async () => {
    setSaving(true); setError('');
    try {
      if (target === 'trabajadores') {
        const res = await api.classifyWorkerPayments([row.id]);
        if (!res.results[0]?.ok) throw new Error(res.results[0]?.error || 'No se pudo enviar');
      } else {
        await api.assignCash(row.id, { target, projectId: project?.id || null, description: target === 'materiales' ? description : undefined });
      }
      onDone(target);
    } catch (e) { setError(e.message); setSaving(false); }
  };
  return (
    <Dialog title={`Asignar ${pago ? 'pago' : 'cobro'} en efectivo`} onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={saving} onClick={save}>{saving ? 'Asignando…' : 'Asignar'}</button>
      </>}>
      <p><strong>{eur(row.importe)}</strong> · {fecha(row.fecha)} · {row.concepto}{row.tercero ? ` · ${row.tercero}` : ''}</p>
      <fieldset className="fin-choices">
        <legend>Destino</legend>
        {options.map(([k, l, help]) => (
          <label key={k} className="fin-choice">
            <input type="radio" name="cash-target" checked={target === k} onChange={() => setTarget(k)} />
            <span><strong>{l}</strong><br /><span className="fin-muted fin-small">{help}</span></span>
          </label>
        ))}
      </fieldset>
      {target !== 'trabajadores' ? (
        <div className="fin-grid-form">
          <div className="fin-field fin-span-all"><span>Proyecto (opcional)</span><ProjectPicker value={project} onChange={setProject} label="Proyecto" /></div>
          {target === 'materiales' ? <label className="fin-field fin-span-all"><span>Descripción del material</span><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></label> : null}
          {!project ? <p className="fin-muted fin-small fin-span-all">Sin proyecto quedará en Pendiente de asignación.</p> : null}
        </div>
      ) : null}
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </Dialog>
  );
}
