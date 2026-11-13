import React, { useState } from 'react';
import { tools } from './api.js';
import { ActionError, useAction } from './ui.jsx';

/* Alta / edición de una herramienta (administración). Location, custodian and
 * condition are never edited here: they change through movements and
 * incidents, so the history always explains them. Editing sends the version
 * read, and the server refuses it if someone saved in between. */
const FIELDS = [
  ['name', 'Nombre', { required: true, max: 160, span: true }], ['brand', 'Marca', { max: 80 }], ['model', 'Modelo', { max: 80 }], ['serialNumber', 'Nº de serie', { max: 80 }],
];
const ADMIN = [
  ['acquiredOn', 'Fecha de adquisición', { type: 'date' }], ['cost', 'Coste (€, sin IVA)', { inputMode: 'decimal' }], ['supplier', 'Proveedor', { max: 160 }],
  ['warrantyUntil', 'Garantía hasta', { type: 'date' }], ['invoiceDocumentId', 'Factura (id del documento en Gestión financiera, opcional)', { max: 36, span: true }],
];

export default function ToolForm({ tool, options, toast, onCancel, onSaved, onTypes }) {
  const editing = !!tool;
  const types = (options?.types || []).filter((t) => t.tracking !== 'consumible');
  const [v, setV] = useState(() => ({
    typeId: tool?.type.id || '', name: tool?.name || '', brand: tool?.brand || '', model: tool?.model || '', serialNumber: tool?.serialNumber || '',
    ownership: tool?.ownership || 'propia', ownerName: tool?.ownerName || '', rentalEndsOn: tool?.rentalEndsOn || '',
    acquiredOn: tool?.acquiredOn || '', cost: tool?.cost || '', supplier: tool?.supplier || '', warrantyUntil: tool?.warrantyUntil || '', invoiceDocumentId: tool?.invoiceDocumentId || '',
    notes: tool?.notes || '', locationId: '', kitPrefix: '', kitItems: '',
  }));
  const [newType, setNewType] = useState(null);
  const action = useAction(toast);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const type = types.find((t) => t.id === v.typeId);
  const clean = (x) => (x === '' ? null : typeof x === 'string' ? x.trim() : x);

  const submit = async () => {
    const body = { typeId: v.typeId, ownership: v.ownership };
    for (const k of ['name', 'brand', 'model', 'serialNumber', 'ownerName', 'rentalEndsOn', 'acquiredOn', 'supplier', 'warrantyUntil', 'invoiceDocumentId', 'notes']) body[k] = clean(v[k]);
    body.cost = v.cost ? String(v.cost).replace(',', '.').trim() : null;
    if (!editing) {
      if (v.locationId) body.locationId = v.locationId;
      if (type?.tracking === 'kit') {
        body.kitPrefix = v.kitPrefix.trim() || undefined;
        body.kitItems = v.kitItems.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(\d+)\s*[x×]?\s+(.+)$/i); return m ? { quantity: Number(m[1]), name: m[2] } : { quantity: 1, name: l }; });
      }
    } else body.version = tool.version;
    const out = await action.run(() => (editing ? tools.update(tool.id, body) : tools.create(body)), editing ? 'Ficha guardada' : 'Herramienta dada de alta');
    if (out) onSaved(out);
  };
  const createType = async () => {
    const out = await action.run(() => tools.createType(newType), 'Tipo creado');
    if (out) { setNewType(null); await onTypes?.(); setV((x) => ({ ...x, typeId: out.id })); }
  };

  return (
    <div className="fin-form">
      <div className="fin-grid-2">
        <label className="fin-field"><span>Tipo</span>
          <select value={v.typeId} onChange={(e) => (e.target.value === '__new' ? setNewType({ name: '', category: '', tracking: 'individual' }) : set('typeId')(e))} required>
            <option value="">Elige un tipo…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{`${t.category} · ${t.name}${t.tracking === 'kit' ? ' (kit)' : ''}`}</option>)}
            {!editing ? <option value="__new">+ Nuevo tipo…</option> : null}
          </select>
        </label>
        {!editing ? <label className="fin-field"><span>Ubicación inicial</span>
          <select value={v.locationId} onChange={set('locationId')}><option value="">Almacén central</option>
            {(options?.locations || []).filter((l) => !['pendiente'].includes(l.kind) && !l.system).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : <span />}
      </div>
      {newType ? (
        <div className="fin-card" style={{ background: '#F8F9FC' }}>
          <div className="fin-grid-3">
            <label className="fin-field"><span>Nombre del tipo</span><input value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} placeholder="Rozadora" /></label>
            <label className="fin-field"><span>Categoría</span><input value={newType.category} onChange={(e) => setNewType({ ...newType, category: e.target.value })} placeholder="Corte" /></label>
            <label className="fin-field"><span>Seguimiento</span><select value={newType.tracking} onChange={(e) => setNewType({ ...newType, tracking: e.target.value })}>
              <option value="individual">Individual (QR por unidad)</option><option value="kit">Kit (se mueve junto)</option><option value="consumible">Consumible (por cantidad)</option></select></label>
          </div>
          <div className="obr-actions obr-mt"><button type="button" className="fin-btn" onClick={() => setNewType(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={!newType.name.trim() || !newType.category.trim() || action.busy} onClick={createType}>Crear tipo</button></div>
        </div>
      ) : null}
      <div className="fin-grid-2">
        {FIELDS.map(([k, label, o]) => <label key={k} className="fin-field" style={o.span ? { gridColumn: '1 / -1' } : undefined}><span>{label}</span><input value={v[k]} maxLength={o.max} required={o.required} onChange={set(k)} /></label>)}
      </div>
      <div className="fin-grid-3">
        <label className="fin-field"><span>Propiedad</span><select value={v.ownership} onChange={set('ownership')}><option value="propia">De Ledens</option><option value="alquilada">Alquilada</option><option value="tercero">De un tercero</option></select></label>
        {v.ownership !== 'propia' ? <label className="fin-field"><span>{v.ownership === 'alquilada' ? 'Empresa de alquiler' : 'Propietario'}</span><input value={v.ownerName} maxLength={160} onChange={set('ownerName')} /></label> : null}
        {v.ownership === 'alquilada' ? <label className="fin-field"><span>Fin del alquiler</span><input type="date" value={v.rentalEndsOn} onChange={set('rentalEndsOn')} /></label> : null}
      </div>
      <div className="fin-grid-2">
        {ADMIN.map(([k, label, o]) => <label key={k} className="fin-field" style={o.span ? { gridColumn: '1 / -1' } : undefined}><span>{label}</span><input type={o.type || 'text'} inputMode={o.inputMode} maxLength={o.max} value={v[k]} onChange={set(k)} /></label>)}
      </div>
      {!editing && type?.tracking === 'kit' ? <>
        <label className="fin-field"><span>Prefijo del código del kit (p. ej. FONTANERIA → KIT-FONTANERIA-001)</span><input value={v.kitPrefix} maxLength={20} onChange={set('kitPrefix')} /></label>
        <label className="fin-field"><span>Componentes (uno por línea, con cantidad delante: «2 Llave grifa»)</span><textarea rows={4} value={v.kitItems} onChange={set('kitItems')} /></label>
      </> : null}
      <label className="fin-field"><span>Observaciones</span><textarea rows={2} value={v.notes} maxLength={2000} onChange={set('notes')} /></label>
      <ActionError error={action.error} onRetry={submit} />
      <div className="obr-actions">
        <button type="button" className="fin-btn" onClick={onCancel} disabled={action.busy}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" onClick={submit} disabled={action.busy || !v.typeId || !v.name.trim() || (v.ownership !== 'propia' && !v.ownerName.trim())}>{action.busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Dar de alta'}</button>
      </div>
    </div>
  );
}
