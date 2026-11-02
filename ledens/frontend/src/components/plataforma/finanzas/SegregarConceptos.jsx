import React, { useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Dialog } from './ui.jsx';

const MAX_DETAIL = 4 * 1024 * 1024; // what the invoice reader (F0) accepts

/* One reconciled document without concepts: the file with the detail of its
 * products is read on the server, and its lines become the document's concepts
 * only when they add up to its total. */
function DetailUpload({ movementId, doc, onRead }) {
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pick = (e) => {
    const f = e.target.files?.[0] || null; setError('');
    if (f && f.size > MAX_DETAIL) { setFile(null); setError('El archivo supera 4 MB, el máximo que admite el lector.'); return; }
    setFile(f);
  };
  const read = async () => {
    setBusy(true); setError('');
    try { onRead(await api.attachDocumentDetail(movementId, doc.id, file)); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="fin-card">
      <p><strong>{doc.numerodocumento || 'Documento sin número'}</strong> · {eur(Math.abs(Number(doc.total)))}</p>
      <label className="fin-field"><span>Documento con el detalle de los productos (PDF, JPG o PNG, máx. 4 MB)</span>
        <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={pick} /></label>
      <button type="button" className="fin-btn is-primary" disabled={!file || busy} onClick={read}>{busy ? 'Leyendo productos…' : 'Leer productos'}</button>
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </div>
  );
}

/* «Segregar conceptos» (Materiales pendiente de asignación, admins): a provisional
 * material payment is replaced by the concepts of the invoice reconciled with its
 * bank movement. When that invoice has no concepts, the error says so and offers
 * to attach the document with the detail of its products. */
export default function SegregarConceptos({ row, onClose, onDone }) {
  const [state, setState] = useState({});
  const segregate = () => {
    setState({ loading: true });
    api.segregateMaterial(row.id).then(
      (res) => setState({ done: `Conceptos segregados de ${res.documentos.join(', ')}.` }),
      (e) => setState({ error: e.message, movementId: e.data?.movimiento_id, missing: e.data?.sin_conceptos || [] }),
    );
  };
  const started = state.loading || state.done || state.error;
  const onRead = (res) => setState({ done: res.segregado
    ? `Se han registrado ${res.lineas} conceptos de la factura y han sustituido al pago provisional.`
    : `Se han registrado ${res.lineas} conceptos de la factura.` });
  const finish = () => (state.done ? onDone() : onClose());
  return (
    <Dialog title="Segregar conceptos de la factura" onClose={finish}
      actions={<>
        <button type="button" className={state.done ? 'fin-btn is-primary' : 'fin-btn is-ghost'} disabled={state.loading} onClick={finish}>{state.done ? 'Entendido' : started ? 'Cerrar' : 'Cancelar'}</button>
        {started ? null : <button type="button" className="fin-btn is-primary" onClick={segregate}>Segregar conceptos</button>}
      </>}>
      <p>{fecha(row.fecha)} · {row.tercero || row.concepto || '—'} · {eur(row.importe)}</p>
      <p className="fin-muted fin-small">Pago de materiales provisional: se sustituye por los conceptos de la factura conciliada con su movimiento, que heredan su clasificación y su obra.</p>
      {state.loading ? <div className="fin-loading">Segregando…</div> : null}
      {state.done ? <p role="status"><i className="ri-checkbox-circle-line"></i> {state.done}</p> : null}
      {state.error ? <p className="fin-error-inline" role="alert">{state.error}</p> : null}
      {state.missing?.length && state.movementId ? (
        <div className="fin-stack">
          <p className="fin-muted fin-small">Adjunta el documento con el detalle de los productos (albarán, ticket o copia de la factura). Se leerán sus líneas y se registrarán como conceptos si suman el total del documento.</p>
          {state.missing.map((d) => <DetailUpload key={d.id} movementId={state.movementId} doc={d} onRead={onRead} />)}
        </div>
      ) : null}
    </Dialog>
  );
}
