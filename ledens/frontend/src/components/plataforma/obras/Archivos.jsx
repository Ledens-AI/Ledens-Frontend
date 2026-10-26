import React, { useCallback, useEffect, useRef, useState } from 'react';
import { archivos } from './api.js';
import { useObrasI18n } from './i18n.js';
import { Dialog, Empty, ErrorBox } from '../finanzas/ui.jsx';
import Carrusel from './Carrusel.jsx';

/* «Fotos y documentos» of an obra. The jefe de obra assigned (or an admin)
 * uploads photos (JPG, PNG, HEIC) and PDFs and withdraws them; the client of
 * the obra sees the photos in a carousel and downloads the documents. What
 * each user may do comes from the server (`can.upload`); readOnly is «Ver como». */
const MAX_PHOTO = 15 * 1024 * 1024;
const MAX_PDF = 20 * 1024 * 1024;
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f) => /^image\/(jpeg|png|heic|heif)$/.test(f.type) || /\.(jpe?g|png|heic|heif)$/i.test(f.name);
const mb = (b, locale = 'es-ES') => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`);
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// A JPEG preview drawn by the browser (≤ 480 px), so the server needs no image
// library. Browsers that cannot decode the photo (HEIC outside Safari) skip it.
async function makeThumb(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  } catch { return null; }
}

// The client's side follows the ES / EN switch; the upload form is team-only (Spanish).
export default function Archivos({ obraId, readOnly, toast }) {
  const { t, fecha, lang } = useObrasI18n();
  const locale = lang === 'en' ? 'en-GB' : 'es-ES';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState('');

  const load = useCallback(() => archivos.list(obraId).then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), [obraId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} retryLabel={t.retry} />;
  if (!data) return <div className="fin-loading fin-muted">{t.filesLoading}</div>;
  const canUpload = data.can.upload && !readOnly;
  const today = localDay(new Date());

  const add = (list) => {
    const items = [...list].map((f) => {
      const pdf = isPdf(f), image = isImage(f);
      const error = !pdf && !image ? 'Formato no admitido: fotos JPG, PNG o HEIC, o documentos PDF'
        : f.size > (pdf ? MAX_PDF : MAX_PHOTO) ? (pdf ? 'El PDF supera los 20 MB' : 'La foto supera los 15 MB') : '';
      const day = localDay(new Date(f.lastModified || Date.now()));
      return { key: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, file: f, pdf, title: '', description: '', date: day > today ? today : day,
        preview: image && /^image\/(jpeg|png)$/.test(f.type) ? URL.createObjectURL(f) : null, progress: 0, error, done: false };
    });
    setQueue((q) => [...q, ...items]);
  };
  const patch = (key, x) => setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...x } : it)));
  const drop = (key) => setQueue((q) => { const it = q.find((x) => x.key === key); if (it?.preview) URL.revokeObjectURL(it.preview); return q.filter((x) => x.key !== key); });

  const uploadAll = async () => {
    setBusy(true);
    let ok = 0;
    for (const it of queue.filter((x) => !x.done && !x.error)) {
      try {
        const saved = await archivos.upload(obraId, it.file, it, (p) => patch(it.key, { progress: p }));
        if (saved.kind === 'foto') { const t = await makeThumb(it.file); if (t) await archivos.thumb(obraId, saved.id, t).catch(() => {}); }
        patch(it.key, { done: true, progress: 1 });
        ok += 1;
      } catch (e) { patch(it.key, { error: e.message, progress: 0 }); }
    }
    setBusy(false);
    setQueue((q) => { q.filter((x) => x.done && x.preview).forEach((x) => URL.revokeObjectURL(x.preview)); return q.filter((x) => !x.done); });
    if (ok) { toast?.(ok === 1 ? 'Archivo subido' : `${ok} archivos subidos`); load(); }
  };

  const remove = async () => {
    setBusy(true); setRemoveError('');
    try {
      await archivos.remove(obraId, removing.id);
      setRemoving(null); toast?.(removing.kind === 'foto' ? 'Foto retirada' : 'Documento retirado'); load();
    } catch (e) { setRemoveError(e.message); }
    setBusy(false);
  };
  const removeBtn = (f) => (canUpload ? <button type="button" className="fin-btn is-danger is-small" onClick={() => { setRemoveError(''); setRemoving(f); }}><i className="ri-delete-bin-line"></i>Retirar</button> : null);
  const pending = queue.filter((x) => !x.done && !x.error).length;

  return (
    <div className="fin-stack">
      {canUpload ? (
        <div className="fin-card obr-up">
          <div className="fin-card-head"><h2>Subir fotos y documentos</h2></div>
          <p className="fin-muted obr-mb">El cliente de la obra los verá en su área de cliente en cuanto los subas. Fotos JPG, PNG o HEIC de hasta 15 MB; documentos PDF de hasta 20 MB.</p>
          <DropZone onFiles={add} disabled={busy} />
          {queue.length ? (
            <ul className="obr-up-list">
              {queue.map((it) => (
                <li key={it.key} className={it.error ? 'is-error' : ''}>
                  <span className="obr-up-thumb">{it.preview ? <img src={it.preview} alt="" /> : <i className={it.pdf ? 'ri-file-pdf-2-line' : 'ri-image-line'} aria-hidden="true"></i>}</span>
                  <div className="obr-up-fields">
                    <span className="obr-up-name"><strong>{it.file.name}</strong><span className="fin-muted fin-small">{mb(it.file.size)}</span></span>
                    {it.error ? <span className="fin-error-inline">{it.error}</span> : (
                      <div className="obr-up-grid">
                        <label className="fin-field"><span>Título (opcional)</span><input value={it.title} maxLength={200} disabled={busy} onChange={(e) => patch(it.key, { title: e.target.value })} placeholder={it.pdf ? 'Acta de replanteo' : 'Baño: regatas abiertas'} /></label>
                        <label className="fin-field"><span>{it.pdf ? 'Fecha del documento' : 'Fecha de la foto'}</span><input type="date" value={it.date} max={today} disabled={busy} onChange={(e) => patch(it.key, { date: e.target.value })} /></label>
                        <label className="fin-field obr-span2"><span>Descripción (opcional)</span><input value={it.description} maxLength={2000} disabled={busy} onChange={(e) => patch(it.key, { description: e.target.value })} /></label>
                      </div>
                    )}
                    {busy && !it.error ? <span className="fin-progress obr-bar"><span style={{ width: `${Math.round(it.progress * 100)}%`, background: '#5567AE' }}></span></span> : null}
                  </div>
                  <button type="button" className="fin-btn is-ghost is-small" aria-label={`Quitar ${it.file.name}`} disabled={busy} onClick={() => drop(it.key)}><i className="ri-close-line"></i></button>
                </li>
              ))}
            </ul>
          ) : null}
          {queue.length ? (
            <div className="obr-actions">
              <button type="button" className="fin-btn" disabled={busy} onClick={() => { queue.forEach((x) => x.preview && URL.revokeObjectURL(x.preview)); setQueue([]); }}>Vaciar</button>
              <button type="button" className="fin-btn is-primary" disabled={busy || !pending} onClick={uploadAll}><i className="ri-upload-2-line"></i>{busy ? 'Subiendo…' : pending === 1 ? 'Subir 1 archivo' : `Subir ${pending} archivos`}</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="fin-card">
        <div className="fin-card-head"><h2>{`${t.photos}${data.fotos.length ? ` · ${data.fotos.length}` : ''}`}</h2></div>
        {data.fotos.length ? <Carrusel fotos={data.fotos} actions={canUpload ? removeBtn : null} />
          : <Empty icon="ri-camera-line" title={t.noPhotos} text={canUpload ? t.noPhotosTeam : t.noPhotosClient} />}
      </div>

      <div className="fin-card">
        <div className="fin-card-head"><h2>{`${t.documents}${data.documentos.length ? ` · ${data.documentos.length}` : ''}`}</h2></div>
        {data.documentos.length ? (
          <ul className="obr-docs">
            {data.documentos.map((d) => (
              <li key={d.id}>
                <i className="ri-file-pdf-2-line obr-docs-icon" aria-hidden="true"></i>
                <span className="obr-row-main">
                  <strong>{d.title || d.name}</strong>
                  <span className="fin-muted fin-small">{[fecha(d.date), d.title ? d.name : null, mb(d.size, locale), d.uploadedBy ? t.docBy(d.uploadedBy) : null].filter(Boolean).join(' · ')}</span>
                  {d.description ? <span className="fin-small">{d.description}</span> : null}
                </span>
                <span className="obr-actions">
                  {removeBtn(d)}
                  <a className="fin-btn is-small" href={d.downloadUrl} download={d.name}><i className="ri-download-2-line"></i>{t.download}</a>
                </span>
              </li>
            ))}
          </ul>
        ) : <Empty icon="ri-file-text-line" title={t.noDocs} text={canUpload ? t.noDocsTeam : t.noDocsClient} />}
      </div>

      {removing ? (
        <Dialog title={removing.kind === 'foto' ? 'Retirar foto' : 'Retirar documento'} onClose={() => setRemoving(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setRemoving(null)}>Cancelar</button>
          <button type="button" className="fin-btn is-danger" disabled={busy} onClick={remove}><i className="ri-delete-bin-line"></i>Retirar</button></>}>
          <p>{`«${removing.title || removing.name}» dejará de verse para el cliente y para el equipo, y el archivo se borrará.`}</p>
          {removeError ? <span className="fin-error-inline">{removeError}</span> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function DropZone({ onFiles, disabled }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div className={'obr-drop' + (over ? ' is-over' : '')}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}>
      <i className="ri-upload-cloud-2-line" aria-hidden="true"></i>
      <span>Arrastra aquí las fotos o los PDF, o</span>
      {/* image/* without HEIC listed: iPhones then hand over a JPEG. */}
      <input ref={input} type="file" multiple hidden accept="image/*,application/pdf"
        onChange={(e) => { if (e.target.files.length) onFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" className="fin-btn is-primary" disabled={disabled} onClick={() => input.current?.click()}><i className="ri-add-line"></i>Elegir archivos</button>
    </div>
  );
}
