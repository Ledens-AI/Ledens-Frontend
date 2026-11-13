import React, { useState } from 'react';
import { tools } from './api.js';
import { INCIDENT_KINDS, alwaysBlocks, drafts } from './labels.js';
import { ActionError, Sheet, Tiles, useAction } from './ui.jsx';

/* «Reportar incidencia»: avería, rotura, pérdida, robo, accesorio que falta o
 * mantenimiento necesario, with a short description and an optional photo
 * taken with the phone. A tool that is not fit for use is blocked for new
 * assignments until administración reviews it (decided on the server).
 * What was typed is kept as a local draft until the server confirms it. */
const MAX_PHOTO = 15 * 1024 * 1024;

export function IncidentSheet({ tool, onClose, onDone, toast, movementId, receiving }) {
  const draftKey = `incidencia.${tool.id}`;
  const saved = drafts.load(draftKey) || {};
  const [kind, setKind] = useState(saved.kind || '');
  const [description, setDescription] = useState(saved.description || '');
  const [blocks, setBlocks] = useState(saved.blocks ?? false);
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [saved2, setSaved2] = useState(null); // incident saved, photo pending
  const action = useAction(toast);
  const keep = (patch) => drafts.save(draftKey, { kind, description, blocks, ...patch });
  const fixed = alwaysBlocks(kind);

  const pick = (e) => {
    const f = e.target.files?.[0];
    setPhotoError('');
    if (!f) return setPhoto(null);
    if (f.size > MAX_PHOTO) { setPhotoError('La foto supera los 15 MB'); return setPhoto(null); }
    setPhoto(f);
  };
  const uploadPhoto = async (incidentId) => {
    if (!photo) return true;
    try { await tools.incidentPhoto(incidentId, photo); return true; } catch (e) { setPhotoError(`La incidencia está guardada, pero la foto no se ha subido: ${e.message}`); return false; }
  };
  const submit = async () => {
    if (saved2) { if (await uploadPhoto(saved2.incident.id)) { toast?.('Foto añadida'); onDone?.(saved2); } return; }
    const body = { kind, description: description.trim(), blocksUse: fixed || blocks };
    const out = await action.run((key) => (receiving ? tools.receive(movementId, { incident: body }, key) : tools.report(tool.id, body, key)));
    if (!out) return;
    drafts.clear(draftKey);
    const incidentId = out.incident?.id;
    toast?.(receiving ? 'Recibida y con la incidencia registrada' : (body.blocksUse ? 'Incidencia registrada: la herramienta queda bloqueada hasta su revisión' : 'Incidencia registrada'));
    if (incidentId && !(await uploadPhoto(incidentId))) { setSaved2({ ...out, incident: { id: incidentId } }); return; }
    onDone?.(out);
  };

  return (
    <Sheet title={receiving ? 'Recibir con un problema' : 'Reportar incidencia'} onClose={onClose} actions={<>
      <button type="button" className="fin-btn" onClick={onClose} disabled={action.busy}>{saved2 ? 'Cerrar sin foto' : 'Cancelar'}</button>
      <button type="button" className="fin-btn is-primary" onClick={submit} disabled={action.busy || (!saved2 && (!kind || !description.trim()))}>
        {action.busy ? 'Guardando…' : saved2 ? 'Reintentar foto' : receiving ? 'Recibir y registrar' : 'Registrar incidencia'}
      </button>
    </>}>
      <p className="fin-muted" style={{ margin: 0 }}>{`${tool.code} · ${tool.name}`}</p>
      {!saved2 ? <>
        <div className="fin-field"><span>Qué ha pasado</span>
          <Tiles label="Tipo de incidencia" value={kind} onChange={(v) => { setKind(v); keep({ kind: v }); }}
            options={INCIDENT_KINDS.map(([value, label, icon, bad]) => ({ value, label, icon, bad }))} />
        </div>
        <label className="fin-field"><span>Descripción breve</span>
          <textarea rows={3} maxLength={2000} value={description} onChange={(e) => { setDescription(e.target.value); keep({ description: e.target.value }); }} placeholder="Ej.: no percute; cable pelado; falta la maleta" />
        </label>
        <label className="fin-check" style={{ display: 'flex', gap: '10px', alignItems: 'center', minHeight: '44px' }}>
          <input type="checkbox" checked={fixed || blocks} disabled={fixed} onChange={(e) => { setBlocks(e.target.checked); keep({ blocks: e.target.checked }); }} style={{ width: '22px', height: '22px' }} />
          <span>{fixed ? 'No apta para uso: queda bloqueada hasta que administración la revise' : 'No apta para uso (bloquearla hasta su revisión)'}</span>
        </label>
      </> : null}
      <label className="fin-field"><span>Foto (opcional)</span>
        <input type="file" accept="image/jpeg,image/png,image/heic,image/heif" capture="environment" onChange={pick} />
      </label>
      {photoError ? <p className="fin-error-inline" role="alert">{photoError}</p> : null}
      <ActionError error={action.error} onRetry={submit} />
    </Sheet>
  );
}
