import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { ActionError, useAction } from './ui.jsx';

/* «Nueva herramienta» (administración y jefe de obra) y edición de la ficha
 * (administración). The photo is required to register one: it goes with the
 * ficha in a single request (POST /api/herramientas/alta), so a tool never
 * exists without it. A jefe only gives name, photo, purchase date, type
 * (optional: «Sin clasificar») and which of his obras it is in; never costs.
 * Location, custodian and condition are never edited here: they change
 * through movements and incidents, so the history always explains them.
 * Editing sends the version read, and the server refuses it if someone saved
 * in between. */
const FIELDS = [
  ['name', 'Nombre', { required: true, max: 160, span: true }], ['brand', 'Marca', { max: 80 }], ['model', 'Modelo', { max: 80 }], ['serialNumber', 'Nº de serie', { max: 80 }],
];
const ADMIN = [
  ['acquiredOn', 'Fecha de adquisición', { type: 'date' }], ['cost', 'Coste (€, sin IVA)', { inputMode: 'decimal' }], ['supplier', 'Proveedor', { max: 160 }],
  ['warrantyUntil', 'Garantía hasta', { type: 'date' }], ['invoiceDocumentId', 'Factura (id del documento en Gestión financiera, opcional)', { max: 36, span: true }],
];

const PHOTO_TYPES = 'image/jpeg,image/png,image/heic,image/heif';

export default function ToolForm({ tool, admin = true, options, toast, onCancel, onSaved, onTypes }) {
  const editing = !!tool;
  const types = (options?.types || []).filter((t) => t.tracking !== 'consumible' && (admin || t.tracking === 'individual'));
  const obras = (options?.projects || []).filter((p) => p.open !== false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  useEffect(() => { if (!photo) { setPreview(''); return undefined; } const u = URL.createObjectURL(photo); setPreview(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const [v, setV] = useState(() => ({
    typeId: tool?.type.id || '', name: tool?.name || '', brand: tool?.brand || '', model: tool?.model || '', serialNumber: tool?.serialNumber || '',
    ownership: tool?.ownership || 'propia', ownerName: tool?.ownerName || '', rentalEndsOn: tool?.rentalEndsOn || '',
    acquiredOn: tool?.acquiredOn || '', cost: tool?.cost || '', supplier: tool?.supplier || '', warrantyUntil: tool?.warrantyUntil || '', invoiceDocumentId: tool?.invoiceDocumentId || '',
    notes: tool?.notes || '', locationId: '', projectId: obras.length === 1 ? obras[0].id : '', kitPrefix: '', kitItems: '',
  }));
  const [newType, setNewType] = useState(null);
  const action = useAction(toast);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const type = types.find((t) => t.id === v.typeId);
  const clean = (x) => (x === '' ? null : typeof x === 'string' ? x.trim() : x);

  const submit = async () => {
    if (!editing && !admin) {
      const ficha = { name: v.name.trim(), typeId: v.typeId || undefined, acquiredOn: v.acquiredOn || undefined, notes: clean(v.notes) || undefined, projectId: v.projectId || undefined };
      const out = await action.run(() => tools.register(photo, ficha), 'Herramienta dada de alta');
      if (out) onSaved(out);
      return;
    }
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
    const out = await action.run(() => (editing ? tools.update(tool.id, body) : tools.register(photo, body)), editing ? 'Ficha guardada' : 'Herramienta dada de alta');
    if (out) onSaved(out);
  };
  const createType = async () => {
    const out = await action.run(() => tools.createType(newType), 'Tipo creado');
    if (out) { setNewType(null); await onTypes?.(); setV((x) => ({ ...x, typeId: out.id })); }
  };

  const photoField = editing ? null : (
    <div className="fin-field">
      <span>Foto de la herramienta (obligatoria)</span>
      {preview ? <img src={preview} alt="Foto elegida" style={{ maxWidth: '100%', maxHeight: '220px', borderRadius: '10px', objectFit: 'contain', background: '#F8F9FC' }} /> : null}
      <input type="file" accept={PHOTO_TYPES} capture="environment" required aria-label="Foto de la herramienta" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
      {!photo ? <small className="fin-muted">Haz una foto con la cámara o elige una de la galería (JPG, PNG o HEIC).</small> : null}
    </div>
  );

  if (!editing && !admin) {
    const needObra = obras.length > 0;
    return (
      <div className="fin-form">
        <label className="fin-field"><span>Nombre</span><input value={v.name} maxLength={160} required onChange={set('name')} placeholder="Taladro percutor Bosch" /></label>
        {photoField}
        <div className="fin-grid-2">
          <label className="fin-field"><span>Fecha de compra (si la sabes)</span><input type="date" value={v.acquiredOn} max={new Date().toISOString().slice(0, 10)} onChange={set('acquiredOn')} /></label>
          <label className="fin-field"><span>Tipo (opcional)</span>
            <select value={v.typeId} onChange={set('typeId')}><option value="">Sin clasificar</option>
              {types.map((t) => <option key={t.id} value={t.id}>{`${t.category} · ${t.name}`}</option>)}</select></label>
        </div>
        {needObra ? <label className="fin-field"><span>¿En qué obra está?</span>
          <select value={v.projectId} onChange={set('projectId')} required><option value="">Elige la obra…</option>
            {obras.map((p) => <option key={p.id} value={p.id}>{[p.code, p.name].filter(Boolean).join(' · ')}</option>)}</select></label>
          : <p className="tl-banner is-info" style={{ margin: 0 }}><i className="ri-information-line" aria-hidden="true"></i><span>No tienes obras asignadas: la herramienta quedará a tu cargo hasta que administración le dé ubicación.</span></p>}
        <label className="fin-field"><span>Observaciones</span><textarea rows={2} value={v.notes} maxLength={2000} onChange={set('notes')} /></label>
        <ActionError error={action.error} onRetry={submit} />
        <div className="obr-actions">
          <button type="button" className="fin-btn" onClick={onCancel} disabled={action.busy}>Cancelar</button>
          <button type="button" className="fin-btn is-primary" onClick={submit} disabled={action.busy || !v.name.trim() || !photo || (needObra && !v.projectId)}>{action.busy ? 'Guardando…' : 'Dar de alta'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fin-form">
      {photoField}
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
        <button type="button" className="fin-btn is-primary" onClick={submit} disabled={action.busy || !v.typeId || !v.name.trim() || (!editing && !photo) || (v.ownership !== 'propia' && !v.ownerName.trim())}>{action.busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Dar de alta'}</button>
      </div>
    </div>
  );
}
