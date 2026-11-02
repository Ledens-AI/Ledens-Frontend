import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import { Dialog } from './ui.jsx';

const MOTIVO = { mas_de_2_decimales: 'Importe con más de 2 decimales', sin_registro: 'Sin registro', sin_importe: 'Sin importe', importe_cero: 'Importe cero' };

/* Materiales sin registro contable (admins): imported materials that count
 * nowhere because they never got a financial record. Shows the plan from the
 * server and registers what cannot count twice (total rounded to cents); the
 * rest is listed with the reason it is left out. */
export default function MaterialesSinRegistro({ onClose, onDone }) {
  const [plan, setPlan] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false), [done, setDone] = useState(null);
  useEffect(() => { api.orphanMaterials().then(setPlan, (e) => setError(e.message)); }, []);
  const apply = async () => {
    setSaving(true); setError('');
    try { const r = await api.registerOrphanMaterials(); setDone(r.resumen); onDone?.(); }
    catch (e) { setError(e.message); }
    setSaving(false);
  };
  const omitted = plan?.filas.filter((f) => f.accion === 'omitir') || [];
  const n = plan?.resumen.registrar || 0;
  return (
    <Dialog title="Materiales sin registro contable" onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>{done ? 'Cerrar' : 'Cancelar'}</button>
        {!done && n ? <button type="button" className="fin-btn is-primary" disabled={saving} onClick={apply}>{saving ? 'Registrando…' : `Registrar ${n}`}</button> : null}
      </>}>
      <p className="fin-muted fin-small">Materiales importados que no tienen registro contable: no cuentan en ninguna lista ni en la rentabilidad y dejan su movimiento pendiente. Se registran con el importe redondeado a céntimos, sin tocar el dato importado, y solo cuando no pueden contar dos veces; los de un pago quedan como pago de materiales provisional.</p>
      {!plan && !error ? <div className="fin-loading">Buscando…</div> : null}
      {error ? <p className="fin-error-inline" role="alert">{error}</p> : null}
      {done ? <p role="status"><i className="ri-checkbox-circle-line"></i> {done.registrar} registrados · {done.omitir} omitidos.</p> : null}
      {plan && !done ? <>
        <p><strong>{plan.resumen.total}</strong> sin registro · <strong>{n}</strong> se registrarán · <strong>{plan.resumen.omitir}</strong> se omiten.</p>
        <p className="fin-muted fin-small">{Object.entries(plan.resumen.por_motivo).map(([k, v]) => `${MOTIVO[k] || k}: ${v}`).join(' · ')}</p>
        {omitted.length ? <>
          <p><strong>Se omiten</strong> (revísalos a mano):</p>
          <div className="fin-table-wrap"><table className="fin-table">
            <thead><tr><th>Fecha</th><th>Pago / documento</th><th className="fin-num">Importe</th><th>Motivo</th></tr></thead>
            <tbody>{omitted.slice(0, 100).map((f) => (
              <tr key={f.id}><td className="fin-nowrap">{fecha(f.fecha)}</td><td className="fin-ellipsis">{f.concepto_pago || f.numerodocumento || f.description || '—'}</td>
                <td className="fin-num fin-nowrap">{f.total === null ? '—' : eur(-Number(f.total))}</td><td className="fin-small">{f.motivo_accion}</td></tr>
            ))}</tbody>
          </table></div>
          {omitted.length > 100 ? <p className="fin-muted fin-small">Y {omitted.length - 100} más.</p> : null}
        </> : null}
      </> : null}
    </Dialog>
  );
}
