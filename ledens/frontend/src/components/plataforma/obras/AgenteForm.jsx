import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox } from '../finanzas/ui.jsx';

// Shared by the standalone "Generar con la documentación de la visita" flow
// (Obras.jsx) and the "Usar el agente" re-run inside the editor (Editor.jsx):
// notes + files in, a draft out via onDraft(draft). Never saves anything.
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error(`No se ha podido leer «${file.name}»`));
  r.readAsDataURL(file);
});

export default function AgenteForm({ onDraft, onCancel, submitLabel = 'Generar borrador' }) {
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const files = await Promise.all(picked.map(async (f) => ({ name: f.name, mime: f.type || 'text/plain', dataBase64: await fileToBase64(f) })));
      await onDraft(await api.readAgente({ notes, files }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div className="fin-card fin-form">
      {error ? <ErrorBox message={error} /> : null}
      <label className="fin-field"><span>Notas de la visita</span>
        <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Qué se pide, estancias afectadas, materiales y calidades comentadas, medidas tomadas, qué queda pendiente de decidir…" />
      </label>
      <label className="fin-field"><span>Fotos, planos, PDF o notas de voz transcritas (máximo 20 MB en total)</span>
        <input type="file" multiple accept="image/jpeg,image/png,image/heic,application/pdf,text/plain,.txt,.heic"
          onChange={(e) => { setPicked([...e.target.files]); setError(''); }} />
      </label>
      {picked.length ? <p className="fin-muted">{picked.length} archivo(s) seleccionado(s).</p> : null}
      {busy ? <p className="fin-muted">Leyendo la documentación de la visita… puede tardar un momento.</p> : null}
      <div className="obr-actions obr-start">
        {onCancel ? <button type="button" className="fin-btn" onClick={onCancel} disabled={busy}>Cancelar</button> : null}
        <button type="button" className="fin-btn is-primary" onClick={generate} disabled={busy || (!notes.trim() && !picked.length)}><i className="ri-magic-line"></i>{busy ? 'Generando…' : submitLabel}</button>
      </div>
    </div>
  );
}
