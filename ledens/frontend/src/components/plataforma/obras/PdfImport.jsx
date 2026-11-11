import React, { useState } from 'react';
import { api, archivos } from './api.js';
import { ErrorBox } from '../finanzas/ui.jsx';
import Editor from './Editor.jsx';

// The budget PDF presented to the client: read it (text, else OCR), review it in
// the editor and send it; the original PDF is kept with the obra. With `parent`
// (an approved obra) it becomes an ampliación of it: approved separately by the
// client, and once approved it adds to the obra's total and progress.
export default function PdfImport({ project, parent, onCancel, onDone, toast }) {
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const read = async () => {
    setBusy(true); setError('');
    try { setDraft(await api.readPdf(file)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (draft) {
    return <Editor mode={parent ? 'ampliacion' : 'new'} parent={parent} initial={draft} project={parent ? undefined : project} sourceFile={file?.name} onCancel={onCancel} onSaved={async (d, { send }) => {
      const notes = [];
      // Files hang from the obra: an added presupuesto keeps its PDF there, under its reference.
      const title = d.parent ? `Presupuesto original (PDF) · ${d.ref}` : 'Presupuesto original (PDF)';
      try { await archivos.upload(d.parent?.id || d.id, file, { title }); } catch (e) { notes.push(`el PDF original no se ha guardado (${e.message})`); }
      let msg = 'Borrador guardado';
      if (send) { try { await api.send(d.id); msg = parent ? 'Ampliación enviada: cuando el cliente la apruebe se sumará a la obra' : 'Presupuesto enviado: queda pendiente de que el cliente lo apruebe'; } catch (e) { msg = 'Guardado como borrador'; notes.push(`no se ha podido enviar (${e.message})`); } }
      toast?.(notes.length ? `${msg}; ${notes.join('; ')}` : msg);
      onDone(d.id);
    }} />;
  }
  return (
    <div className="fin-stack">
      <div className="fin-page-head">
        <h1>{parent ? 'Ampliación desde PDF' : 'Subir PDF de presupuesto'}</h1>
        {parent ? <p className="obr-project-line"><i className="ri-building-2-line" aria-hidden="true"></i><span>{'Ampliación de la obra '}<strong>{`${parent.ref} · ${parent.title}`}</strong></span></p> : null}
        {!parent && project ? <p className="obr-project-line"><i className="ri-building-4-line" aria-hidden="true"></i><span>{'Proyecto '}<strong>{[project.code, project.name].filter(Boolean).join(' · ')}</strong></span></p> : null}
        <p>{parent
          ? 'Sube el PDF del presupuesto de los trabajos nuevos. Se leen capítulos, partidas, mediciones, precios e importes; lo revisas y se lo envías al cliente. Cuando lo apruebe, se suma al total y al avance de la obra.'
          : 'Sube el PDF que has presentado al cliente. Se leen capítulos, partidas, mediciones, precios e importes; lo revisas y se lo envías para que lo apruebe.'}</p>
      </div>
      {error ? <ErrorBox message={error} /> : null}
      <div className="fin-card fin-form">
        <label className="fin-field"><span>Presupuesto en PDF (máximo 20 MB)</span>
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }} />
        </label>
        {busy ? <p className="fin-muted">Leyendo el PDF… Si es un escaneo, el OCR puede tardar unos segundos.</p> : null}
        <div className="obr-actions obr-start">
          <button type="button" className="fin-btn" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className="fin-btn is-primary" onClick={read} disabled={busy || !file}><i className="ri-scan-2-line"></i>{busy ? 'Leyendo…' : 'Leer PDF'}</button>
        </div>
      </div>
    </div>
  );
}
