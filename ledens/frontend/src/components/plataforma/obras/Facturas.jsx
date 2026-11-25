import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from '../finanzas/format.js';
import { Dialog, ErrorBox } from '../finanzas/ui.jsx';
import { CLIENT_FIELDS, breakdown, clientProblems, missingLabels, parseCents, suggestions, toEuros } from './facturas.js';

/* Facturas a clientes of a project («Presupuestos y obras» → a project; admins).
 * «Generar factura» first makes sure the client's billing data is there (name,
 * CIF/NIF, address — taken from the project, its accounting or the last
 * invoice; asked for when missing) and then offers 20 %, 50 % or 100 % of what
 * is still to be collected, or another amount. The backend numbers, stores and
 * prints it (ledens/backend/src/facturas/); the PDF downloads right away and
 * stays in the project's list. Spanish only, like the rest of the team screens. */

const VAT_RATES = ['21', '10', '4', '0'];
const pctLabel = (v) => `${String(Number(v)).replace('.', ',')} %`;
const euros = (cents) => eur(toEuros(cents));

export function FacturaDialog({ projectId, pendiente, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState('cliente');
  const [cli, setCli] = useState(null);
  const [touched, setTouched] = useState({});
  const [choice, setChoice] = useState(null); // 20 | 50 | 100 | 'otro'
  const [otro, setOtro] = useState('');
  const [iva, setIva] = useState('21');
  const [concepto, setConcepto] = useState('');
  const [numero, setNumero] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoadError('');
    api.facturacion(projectId).then((x) => {
      setD(x);
      setCli({ ...x.cliente });
      setIva(x.ivaPct);
      setConcepto(x.concepto);
      setNumero(x.numero);
      setStep(x.faltan.length ? 'cliente' : 'importe');
    }, (e) => setLoadError(e.message));
  };
  useEffect(load, [projectId]);

  const options = useMemo(() => suggestions(pendiente), [pendiente]);
  const problems = cli ? clientProblems(cli) : {};
  const clientOk = cli && !Object.keys(problems).length;
  const totalCents = choice === 'otro' ? parseCents(otro) : options.find((o) => o.pct === choice)?.cents ?? null;
  const parts = totalCents ? breakdown(totalCents, iva) : null;
  const pendCents = pendiente === null || pendiente === undefined ? null : Math.round(Number(pendiente) * 100);
  const ready = clientOk && parts && parts.base > 0 && concepto.trim() && numero.trim() && !busy;

  const emit = async () => {
    setBusy(true);
    setError('');
    try {
      const { factura } = await api.emitirFactura(projectId, {
        cliente: cli, concepto, numero: numero.trim(), ivaPct: iva, total: toEuros(totalCents), porcentaje: typeof choice === 'number' ? choice : null,
      });
      let downloaded = true;
      try { await api.descargarFactura(projectId, factura.id); } catch { downloaded = false; }
      onDone(factura, downloaded);
    } catch (e) {
      setError(e.message);
      // Someone took that number meanwhile: offer the next one.
      if (e.status === 409) api.facturacion(projectId).then((x) => setNumero(x.numero), () => {});
      setBusy(false);
    }
  };

  if (loadError) return <Dialog title="Generar factura" onClose={onClose}><ErrorBox message={loadError} onRetry={load} /></Dialog>;
  if (!d || !cli) return <Dialog title="Generar factura" onClose={onClose}><p className="fin-muted">Cargando los datos del cliente…</p></Dialog>;

  if (step === 'cliente') {
    const missing = d.faltan.filter((k) => !String(cli[k] ?? '').trim() || problems[k]);
    return (
      <Dialog title="Generar factura · Datos del cliente" wide onClose={onClose} actions={<>
        <button type="button" className="fin-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={!clientOk}
          onClick={() => setStep('importe')}>Continuar<i className="ri-arrow-right-line"></i></button></>}>
        {d.faltan.length ? (
          <p className="fin-warn"><i className="ri-error-warning-line" aria-hidden="true"></i>
            <span>{missing.length
              ? `Faltan datos del cliente para poder facturar: ${missingLabels(missing).join(', ')}. Complétalos; se guardan para las próximas facturas de este proyecto.`
              : 'Datos completos. Se guardan para las próximas facturas de este proyecto.'}</span></p>
        ) : <p className="fin-muted">Revisa los datos que aparecerán en la factura. Se guardan para las próximas facturas de este proyecto.</p>}
        <div className="fin-grid-form obr-fact-client">
          {CLIENT_FIELDS.map((f) => {
            // An error shows once the field was left or changed, or at once for a stored value that is refused (a wrong CIF/NIF).
            const show = touched[f.key] || cli[f.key] !== d.cliente[f.key] || (d.faltan.includes(f.key) && String(cli[f.key] ?? '').trim());
            const err = show ? problems[f.key] : null;
            const hint = d.origen[f.key] && cli[f.key] === d.cliente[f.key] ? d.origen[f.key] : null;
            return (
              <label key={f.key} className={'fin-field' + (f.key === 'direccion' || f.key === 'nombre' ? ' obr-fact-wide' : '')}>
                <span>{f.label}{f.required ? ' *' : ''}</span>
                <input type={f.type || 'text'} value={cli[f.key] ?? ''} maxLength={f.max} autoComplete={f.autoComplete || 'off'}
                  aria-invalid={err ? 'true' : undefined} className={d.faltan.includes(f.key) && !String(cli[f.key] ?? '').trim() ? 'obr-fact-missing' : undefined}
                  onChange={(e) => setCli({ ...cli, [f.key]: e.target.value })} onBlur={() => setTouched({ ...touched, [f.key]: true })} />
                {err ? <span className="fin-error-inline fin-small">{err}</span> : hint ? <span className="fin-muted fin-small obr-fact-hint">{hint}</span> : null}
              </label>
            );
          })}
        </div>
      </Dialog>
    );
  }

  const over = pendCents !== null && totalCents && totalCents > pendCents;
  return (
    <Dialog title="Generar factura" wide onClose={busy ? undefined : onClose} actions={<>
      <button type="button" className="fin-btn is-ghost" disabled={busy} onClick={() => setStep('cliente')}><i className="ri-arrow-left-line"></i>Datos del cliente</button>
      <span className="fin-grow"></span>
      <button type="button" className="fin-btn" disabled={busy} onClick={onClose}>Cancelar</button>
      <button type="button" className="fin-btn is-primary" disabled={!ready} onClick={emit}>
        <i className={busy ? 'ri-loader-4-line' : 'ri-bill-line'}></i>{busy ? 'Generando…' : 'Generar factura'}</button></>}>
      <div className="obr-fact-summary">
        <i className="ri-user-3-line" aria-hidden="true"></i>
        <div>
          <strong>{cli.nombre}</strong>
          <span className="fin-muted">{[cli.nif, cli.direccion, cli.telefono, cli.email].filter((x) => String(x ?? '').trim()).join(' · ')}</span>
        </div>
      </div>

      <div className="fin-field">
        <span>Importe de la factura (con IVA)</span>
        {pendCents === null ? <p className="fin-muted fin-small obr-fact-hint">No se ha podido calcular el pendiente de cobro de este proyecto: indica el importe.</p>
          : pendCents <= 0 ? <p className="fin-muted fin-small obr-fact-hint">No queda importe pendiente de cobro en este proyecto (aprobado con IVA − cobrado).</p>
            : <p className="fin-muted fin-small obr-fact-hint">{`Pendiente de cobro: ${euros(pendCents)} (aprobado con IVA − cobrado)`}</p>}
        <div className="obr-fact-opts" role="radiogroup" aria-label="Importe de la factura">
          {options.map((o) => (
            <button key={o.pct} type="button" role="radio" aria-checked={choice === o.pct} className={'obr-fact-opt' + (choice === o.pct ? ' is-on' : '')} onClick={() => setChoice(o.pct)}>
              <span className="obr-fact-opt-pct">{`${o.pct} %`}</span>
              <span className="obr-fact-opt-amount">{euros(o.cents)}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={choice === 'otro'} className={'obr-fact-opt' + (choice === 'otro' ? ' is-on' : '')} onClick={() => setChoice('otro')}>
            <span className="obr-fact-opt-pct">Otro importe</span>
            <span className="obr-fact-opt-amount fin-muted">A tu elección</span>
          </button>
        </div>
      </div>
      {choice === 'otro' ? (
        <label className="fin-field"><span>Importe con IVA (€)</span>
          <input inputMode="decimal" value={otro} autoFocus placeholder="Ej.: 1.200,00" onChange={(e) => setOtro(e.target.value)}
            aria-invalid={otro && !parseCents(otro) ? 'true' : undefined} />
          {otro && !parseCents(otro) ? <span className="fin-error-inline fin-small">Importe no válido</span> : null}
        </label>
      ) : null}

      <div className="fin-grid-form">
        <label className="fin-field"><span>IVA</span>
          <select value={iva} onChange={(e) => setIva(e.target.value)}>
            {[...new Set([...VAT_RATES, String(Number(d.ivaPct))])].map((r) => <option key={r} value={r}>{pctLabel(r)}{r === String(Number(d.ivaPct)) ? ' (el del presupuesto)' : ''}</option>)}
          </select>
        </label>
        <label className="fin-field"><span>Nº de factura</span>
          <input value={numero} maxLength={30} onChange={(e) => setNumero(e.target.value)} />
          <span className="fin-muted fin-small obr-fact-hint">{numero.trim() === d.numero ? 'El siguiente de la serie.' : `El siguiente de la serie es ${d.numero}.`}</span>
        </label>
        <div className="fin-field"><span>Fecha</span><p className="obr-fact-static">{fecha(d.fecha)}</p></div>
      </div>
      <label className="fin-field"><span>Concepto</span>
        <textarea rows={2} maxLength={500} value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      </label>

      {parts ? (
        <dl className="obr-fact-totals">
          <div><dt>Base imponible</dt><dd>{euros(parts.base)}</dd></div>
          <div><dt>{`IVA (${pctLabel(iva)})`}</dt><dd>{euros(parts.iva)}</dd></div>
          <div className="is-total"><dt>Total factura</dt><dd>{euros(parts.total)}</dd></div>
        </dl>
      ) : null}

      {over ? <p className="fin-warn"><i className="ri-error-warning-line" aria-hidden="true"></i><span>{`El importe supera el pendiente de cobro (${euros(pendCents)}).`}</span></p> : null}
      {d.facturas.length ? (
        <p className="fin-warn"><i className="ri-information-line" aria-hidden="true"></i>
          <span>{`Este proyecto ya tiene ${d.facturas.length === 1 ? 'una factura emitida' : `${d.facturas.length} facturas emitidas`} desde Ledens por ${eur(d.facturado)} (la última, ${d.facturas[0].numero} del ${fecha(d.facturas[0].fecha)}). Si alguna aún no está cobrada, su importe sigue dentro del pendiente de cobro: no factures dos veces lo mismo.`}</span></p>
      ) : null}
      <p className="fin-muted fin-small obr-fact-hint">Una factura emitida no se puede modificar ni borrar.</p>
      {error ? <span className="fin-error-inline" role="alert">{error}</span> : null}
    </Dialog>
  );
}

// The invoices issued for the project, newest first, each one downloadable again.
export function FacturasProyecto({ projectId, facturas, toast }) {
  const [busy, setBusy] = useState(null);
  const download = (f) => {
    setBusy(f.id);
    api.descargarFactura(projectId, f.id).catch((e) => toast?.(e.message)).finally(() => setBusy(null));
  };
  return (
    <div className="fin-card is-flush">
      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead><tr><th>Nº</th><th>Fecha</th><th>Concepto</th><th className="fin-num">Base</th><th className="fin-num">Total</th><th aria-label="PDF"></th></tr></thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id}>
                <td className="fin-nowrap"><strong>{f.numero}</strong></td>
                <td className="fin-nowrap">{fecha(f.fecha)}</td>
                <td>{f.concepto}{f.porcentaje ? <span className="fin-muted">{` · ${f.porcentaje} % del pendiente`}</span> : null}</td>
                <td className="fin-num fin-nowrap">{eur(f.base)}</td>
                <td className="fin-num fin-nowrap">{eur(f.total)}</td>
                <td className="fin-num">
                  <button type="button" className="fin-btn is-small" disabled={busy === f.id} onClick={() => download(f)}>
                    <i className="ri-download-2-line"></i>PDF</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
