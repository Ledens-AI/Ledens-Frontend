import React, { useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Dialog } from './ui.jsx';

const MAX_DETAIL = 4 * 1024 * 1024; // what the invoice reader (F0) accepts
const MAX_FILES = 6; // documents of one anticipo (backend ORDER_MAX_FILES)

/* One reconciled document without concepts. One file: the detail of its products,
 * read on the server; its lines become the document's concepts only when they add
 * up to its total. Several (an anticipo, from any supplier): the anticipo, its
 * devoluciones and the invoices with its products, which must add up to it
 * (anticipo = productos + devoluciones); each devolución is reconciled with its receipt in the same account,
 * and when several receipts fit the admin picks one. */
function DetailUpload({ materialId, movementId, doc, onRead }) {
  const [files, setFiles] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ambiguous, setAmbiguous] = useState([]), [choices, setChoices] = useState({});
  const pick = (e) => {
    const list = [...(e.target.files || [])]; setError(''); setAmbiguous([]); setChoices({});
    const big = list.find((f) => f.size > MAX_DETAIL);
    if (big) { setFiles([]); setError(`${big.name} supera 4 MB, el máximo que admite el lector.`); return; }
    if (list.length > MAX_FILES) { setFiles([]); setError(`Adjunta como máximo ${MAX_FILES} documentos.`); return; }
    setFiles(list);
  };
  const read = async () => {
    setBusy(true); setError('');
    try {
      onRead(files.length === 1 ? await api.attachDocumentDetail(movementId, doc.id, files[0]) : await api.segregateOrder(materialId, files, choices));
    } catch (e) {
      const options = e.data?.devoluciones_ambiguas || [];
      setAmbiguous(options);
      setError(options.length ? 'Hay varios cobros que pueden ser la devolución: elige cuál es y vuelve a segregar.' : e.message);
      setBusy(false);
    }
  };
  const chosen = ambiguous.every((d) => choices[d.documento]);
  return (
    <div className="fin-card">
      <p><strong>{doc.numerodocumento || 'Documento sin número'}</strong> · {eur(Math.abs(Number(doc.total)))}</p>
      <label className="fin-field"><span>Documento con el detalle de los productos (PDF, JPG o PNG, máx. 4 MB), o, si es un anticipo, a la vez sus devoluciones y las facturas con sus productos</span>
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={pick} /></label>
      {files.length > 1 ? <ul className="fin-small">{files.map((f) => <li key={f.name}>{f.name}</li>)}</ul> : null}
      {ambiguous.map((d) => (
        <fieldset key={d.documento} className="fin-field">
          <legend>Cobro de la devolución {d.documento} ({eur(Number(d.importe))})</legend>
          {d.candidatos.map((c) => (
            <label key={c.id} className="fin-small">
              <input type="radio" name={'dev-' + d.documento} checked={choices[d.documento] === c.id} disabled={busy}
                onChange={() => setChoices((x) => ({ ...x, [d.documento]: c.id }))} />
              {' '}{fecha(c.fecha)} · {c.tercero || c.concepto || '—'} · {c.source_id}
            </label>
          ))}
        </fieldset>
      ))}
      <button type="button" className="fin-btn is-primary" disabled={!files.length || busy || !chosen} onClick={read}>
        {busy ? 'Leyendo documentos…' : files.length > 1 ? 'Segregar con estos documentos' : 'Leer productos'}</button>
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
    </div>
  );
}

// What «Segregar» with the documents of an anticipo did with each devolución.
const devolucion = (d) => d.movimiento
  ? `La devolución ${d.documento} (${eur(Number(d.importe))}) ${d.vinculado ? 'se ha conciliado con el cobro' : 'ya estaba conciliada con el cobro'} ${d.movimiento.source_id || ''} del ${fecha(d.movimiento.fecha)}.`
  : `La devolución ${d.documento} (${eur(Number(d.importe))}) aún no tiene cobro en la cuenta del pago: concílialo en el Bridge cuando llegue.`;

/* «Segregar» (Materiales pendiente de asignación, admins): a material is replaced
 * by the lines of the invoice reconciled with its bank movement. Without a document
 * yet, or with one without concepts (an anticipo), the error says so; for the
 * latter it offers to attach the document with the detail of its products, or the
 * documents of the anticipo (devoluciones and invoices). */
export default function SegregarConceptos({ row, onClose, onDone }) {
  const [state, setState] = useState({});
  const segregate = () => {
    setState({ loading: true });
    api.segregateMaterial(row.id).then(
      (res) => setState({ done: `Líneas segregadas de ${res.documentos.join(', ')}.` }),
      (e) => setState({ error: e.message, movementId: e.data?.movimiento_id, missing: e.data?.sin_conceptos || [] }),
    );
  };
  const started = state.loading || state.done || state.error;
  const onRead = (res) => setState({
    done: res.devoluciones
      ? `Se han registrado ${res.lineas} productos${res.pedido ? ` del pedido ${res.pedido}` : ''} y han sustituido al pago provisional.`
      : res.segregado
        ? `Se han registrado ${res.lineas} conceptos de la factura y han sustituido al pago provisional.`
        : `Se han registrado ${res.lineas} conceptos de la factura.`,
    notes: (res.devoluciones || []).map(devolucion),
  });
  const finish = () => (state.done ? onDone() : onClose());
  return (
    <Dialog title="Segregar en las líneas de la factura" onClose={finish}
      actions={<>
        <button type="button" className={state.done ? 'fin-btn is-primary' : 'fin-btn is-ghost'} disabled={state.loading} onClick={finish}>{state.done ? 'Entendido' : started ? 'Cerrar' : 'Cancelar'}</button>
        {started ? null : <button type="button" className="fin-btn is-primary" onClick={segregate}>Segregar</button>}
      </>}>
      <p>{fecha(row.fecha)} · {row.tercero || row.concepto || '—'} · {eur(row.importe)}</p>
      <p className="fin-muted fin-small">El material se sustituye por cada una de las líneas de la factura conciliada con su movimiento, que heredan su clasificación y su obra. Necesita un documento asignado con conceptos: un anticipo no tiene líneas que segregar.</p>
      {state.loading ? <div className="fin-loading">Segregando…</div> : null}
      {state.done ? <p role="status"><i className="ri-checkbox-circle-line"></i> {state.done}</p> : null}
      {state.notes?.map((n) => <p key={n} className="fin-small">{n}</p>)}
      {state.error && !state.done ? <p className="fin-error-inline" role="alert">{state.error}</p> : null}
      {!state.done && state.missing?.length && state.movementId ? (
        <div className="fin-stack">
          <p className="fin-muted fin-small">Adjunta el documento con el detalle de los productos (albarán, ticket o copia de la factura). Si es un anticipo, adjunta a la vez sus devoluciones y las facturas con sus productos (y, si quieres, el propio anticipo), de cualquier proveedor. Tienen que cuadrar: anticipo = productos + devoluciones; cada devolución se concilia con su cobro en la misma cuenta.</p>
          {state.missing.map((d) => <DetailUpload key={d.id} materialId={row.id} movementId={state.movementId} doc={d} onRead={onRead} />)}
        </div>
      ) : null}
    </Dialog>
  );
}
