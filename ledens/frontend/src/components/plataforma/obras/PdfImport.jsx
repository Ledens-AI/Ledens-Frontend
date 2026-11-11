import React, { useState } from 'react';
import { api, archivos } from './api.js';
import { Badge, ErrorBox, Kpi } from '../finanzas/ui.jsx';
import Editor from './Editor.jsx';

// The budget PDF presented to the client: read it (text, else OCR), review it in
// the editor and send it; the original PDF is kept with the obra. With `parent`
// (an approved obra) it becomes an ampliación of it: approved separately by the
// client, and once approved it adds to the obra's total and progress.
export default function PdfImport({ project, parent, onCancel, onDone, toast }) {
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [chosen, setChosen] = useState(null); // the draft that goes to the editor (all the PDF, or only what is missing)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const read = async () => {
    setBusy(true); setError('');
    try { setChosen(null); setDraft(await api.readPdf(file)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  // An ampliación: insert every line of the PDF, or first analyse which ones the obra already has approved.
  if (draft && parent && !chosen) {
    return <Comparar parent={parent} draft={draft} fileName={file?.name} onCancel={onCancel} onChoose={setChosen} />;
  }
  if (draft) {
    return <Editor mode={parent ? 'ampliacion' : 'new'} parent={parent} initial={chosen || draft} project={parent ? undefined : project} sourceFile={file?.name} onCancel={onCancel} onSaved={async (d, { send }) => {
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

const STATUS = {
  existente: { label: 'Ya aprobada', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-checkbox-circle-line' },
  exceso: { label: 'Medición mayor', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-add-circle-line' },
  nueva: { label: 'Nueva', bg: '#E3E7F3', fg: '#3E4D85', icon: 'ri-file-add-line' },
};
const qtyText = (v) => String(Number(v)).replace('.', ',');

// What is left of the PDF once the lines the obra already has approved are
// taken out: a line in excess keeps only the difference, with a note.
function onlyMissing(draft, result) {
  const by = new Map(result.items.map((x) => [`${x.chapter}:${x.item}`, x]));
  const chapters = draft.chapters.map((c, ci) => ({
    ...c,
    items: c.items.flatMap((it, ii) => {
      const x = by.get(`${ci}:${ii}`);
      if (!x || x.status === 'nueva') return [it];
      if (x.status === 'existente') return [];
      const refs = [...new Set(x.matched.map((m) => m.ref))].join(', ');
      const notes = [{ type: 'nota', text: `Ya aprobadas ${qtyText(x.approvedQuantity)} ${it.unit} en ${refs}; el PDF pide ${qtyText(it.quantity)}: se añade solo la diferencia (${qtyText(x.extraQuantity)}).` }];
      if (x.priceDiffers) notes.push({ type: 'precio', text: `Precio aprobado ${String(Number(x.approvedUnitPrice)).replace('.', ',')} € sin IVA; el del PDF es distinto.` });
      return [{ ...it, quantity: x.extraQuantity, annotations: [...(it.annotations || []), ...notes] }];
    }),
  })).filter((c) => c.items.length);
  const { nuevas, excesos } = result.summary;
  return { ...draft, chapters, onlyMissing: `${nuevas} ${nuevas === 1 ? 'nueva' : 'nuevas'} y ${excesos} con medición mayor` };
}

function Comparar({ parent, draft, fileName, onCancel, onChoose }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lines = draft.chapters.reduce((a, c) => a + c.items.length, 0);
  const analyse = async () => {
    setBusy(true); setError('');
    try { setResult(await api.compare(parent.id, { chapters: draft.chapters })); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const by = result ? new Map(result.items.map((x) => [`${x.chapter}:${x.item}`, x])) : null;
  const missing = result ? result.summary.nuevas + result.summary.excesos : 0;
  return (
    <div className="fin-stack">
      <div className="fin-page-head">
        <h1>Ampliación desde PDF</h1>
        <p className="obr-project-line"><i className="ri-building-2-line" aria-hidden="true"></i><span>{'Ampliación de la obra '}<strong>{`${parent.ref} · ${parent.title}`}</strong></span></p>
        <p>{`Se han leído ${lines} ${lines === 1 ? 'partida' : 'partidas'}${fileName ? ` de «${fileName}»` : ''}. Si el PDF repite partidas que la obra ya tiene aprobadas, analízalo: el cliente solo tendrá que aprobar las que faltan.`}</p>
      </div>
      {error ? <ErrorBox message={error} /> : null}
      {!result ? (
        <div className="fin-card obr-decide">
          <div>
            <h2>¿Qué partidas van a la ampliación?</h2>
            <p className="fin-muted">«Analizar existentes» compara cada partida con lo aprobado en la obra y sus ampliaciones (mismo código, misma partida de la base o mismo nombre, con la misma unidad).</p>
          </div>
          <div className="obr-actions">
            <button type="button" className="fin-btn" onClick={onCancel} disabled={busy}>Cancelar</button>
            <button type="button" className="fin-btn" onClick={() => onChoose(draft)} disabled={busy}><i className="ri-file-copy-line"></i>Insertar todas</button>
            <button type="button" className="fin-btn is-primary" onClick={analyse} disabled={busy}><i className="ri-search-eye-line"></i>{busy ? 'Analizando…' : 'Analizar existentes'}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="fin-kpis">
            <Kpi label="Nuevas" value={String(result.summary.nuevas)} icon={STATUS.nueva.icon} hint="Van enteras a la ampliación" />
            <Kpi label="Con medición mayor" value={String(result.summary.excesos)} icon={STATUS.exceso.icon} tone={result.summary.excesos ? 'warn' : undefined} hint="Va solo la diferencia con lo aprobado" />
            <Kpi label="Ya aprobadas" value={String(result.summary.existentes)} icon={STATUS.existente.icon} hint="Se quitan: el cliente ya las aprobó" />
          </div>
          {draft.chapters.map((c, ci) => (
            <div className="fin-card is-flush" key={ci}>
              <div className="obr-chapter-head"><h2>{`${ci + 1}. ${c.name}`}</h2></div>
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead><tr><th>Partida</th><th className="fin-num">Cantidad del PDF</th><th>Resultado</th><th>En la obra</th></tr></thead>
                  <tbody>
                    {c.items.map((it, ii) => {
                      const x = by.get(`${ci}:${ii}`) || { status: 'nueva' };
                      const st = STATUS[x.status];
                      return (
                        <tr key={ii} className={x.status === 'existente' ? 'obr-optional' : ''}>
                          <td><strong>{it.name}</strong><div className="fin-muted fin-small">{[it.code, it.baseCode && it.baseCode !== it.code ? it.baseCode : null].filter(Boolean).join(' · ')}</div></td>
                          <td className="fin-num fin-nowrap">{`${qtyText(it.quantity)} ${it.unit}`}</td>
                          <td><Badge bg={st.bg} fg={st.fg} icon={st.icon}>{st.label}</Badge>
                            {x.status === 'exceso' ? <div className="fin-small">{`Se añaden ${qtyText(x.extraQuantity)} ${it.unit}`}</div> : null}
                            {x.priceDiffers ? <div className="fin-warn fin-small">Precio distinto del aprobado</div> : null}</td>
                          <td className="fin-small">{x.matched ? `${qtyText(x.approvedQuantity)} ${it.unit} aprobadas · ${[...new Set(x.matched.map((m) => m.ref))].join(', ')}` : <span className="fin-muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {!missing ? <p className="fin-warn"><i className="ri-information-line"></i><span>Todas las partidas del PDF ya están aprobadas en la obra: no hay nada que ampliar.</span></p> : null}
          <div className="obr-actions">
            <button type="button" className="fin-btn" onClick={onCancel}>Cancelar</button>
            <button type="button" className="fin-btn" onClick={() => onChoose(draft)}><i className="ri-file-copy-line"></i>Insertar todas igualmente</button>
            <button type="button" className="fin-btn is-primary" disabled={!missing} onClick={() => onChoose(onlyMissing(draft, result))}><i className="ri-arrow-right-line"></i>{`Continuar con las ${missing} que faltan`}</button>
          </div>
        </>
      )}
    </div>
  );
}
