import React, { useEffect, useState } from 'react';
import { tools } from './api.js';
import { BackLink } from './ui.jsx';
import { ErrorBox } from '../finanzas/ui.jsx';

/* Printable labels (administración). Each one: the QR (only an https link with
 * an opaque token), the permanent code in large type — readable and typeable
 * when the QR is scratched — and the name. Prints 3 × 8 per A4 sheet
 * (70 × 37 mm adhesive labels; styles in herramientas.css @media print). */
export default function Etiquetas({ ids, onBack }) {
  const [labels, setLabels] = useState(null);
  const [error, setError] = useState('');
  const load = () => tools.labels(ids).then((d) => { setLabels(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { load(); }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tl">
      <BackLink onBack={onBack} />
      <div className="tl-head tl-noprint">
        <div><h2>Etiquetas QR</h2><p>Hojas A4 de 3 × 8 etiquetas adhesivas (70 × 37 mm). Una etiqueta gastada se reimprime igual; una perdida se sustituye desde la ficha.</p></div>
        <button type="button" className="fin-btn is-primary" disabled={!labels} onClick={() => window.print()}><i className="ri-printer-line" aria-hidden="true"></i>Imprimir</button>
      </div>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      {labels ? (
        <div className="tl-print">
          <div className="tl-labels">
            {labels.map((l) => (
              <div key={l.id} className="tl-label">
                <img src={`${tools.qrSrc(l.id)}?v=${l.labelVersion}`} alt={`QR de ${l.code}`} />
                <div><span className="tl-code">{l.code}</span><strong>{l.name}</strong><small>{`Propiedad de Ledens · etiqueta ${l.labelVersion}`}</small></div>
              </div>
            ))}
          </div>
        </div>
      ) : !error ? <div className="fin-loading fin-muted">Preparando etiquetas…</div> : null}
    </div>
  );
}
