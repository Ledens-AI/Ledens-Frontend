import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../finanzas/api.js';
import { eur, fecha } from '../finanzas/format.js';
import { Badge, Dialog, ErrorBox } from '../finanzas/ui.jsx';

/* «Cuentas por pagar» of a project page (admins only: daily pay is personal
 * data, so a jefe de obra gets 403 and the card is simply not shown).
 * Backend: PayablesService.project / payProject (finanzas/payables.js).
 * The workers are the oficial and peón of each cuadrilla of the project's obras
 * (Planificación / Gantt). Every day that passes adds each one's jornal; the
 * week is paid on Friday, or on Saturday when that Saturday is worked — a click
 * on a day marks it worked or not, like the table in Gestión financiera →
 * Cuentas por pagar. «Registrar pago» marks the jornales paid (the payment
 * itself is still recorded from the bank or the cash). */

const DIA = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIA_LARGO = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const ROL = { oficial: 'Oficial', peon: 'Peón' };
const dowOf = (s) => { const g = new Date(s + 'T00:00:00Z').getUTCDay(); return g === 0 ? 7 : g; };
const sinAnio = (s) => fecha(s).replace(/ \d{4}$/, '');
const diaPago = (s) => `${DIA_LARGO[dowOf(s)]} ${sinAnio(s)}`;
const cents = (n) => Math.round(Number(n || 0) * 100);
const names = (list) => list.map((w) => w.name).join(', ');

function payLabel(g, today) {
  if (g.aPagar <= 0 && g.pagado > 0) return `Pagado · ${diaPago(g.date)}`;
  if (g.date === today) return 'Se paga hoy';
  if (g.ready) return `Pago pendiente desde el ${diaPago(g.date)}`;
  return `Se paga el ${diaPago(g.date)}`;
}

export default function CuentasPorPagarProyecto({ projectId, readOnly, toast }) {
  const [data, setData] = useState(null); // null: loading · { hidden } · { error } · the card
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(null); // { title, items, importe, lines }
  const [paidOn, setPaidOn] = useState('');
  const [message, setMessage] = useState('');
  const notify = (m) => (toast ? toast(m) : setMessage(m));

  const load = useCallback(() => api.projectPayables(projectId).then(setData,
    (e) => setData(e.status === 403 ? { hidden: true } : { error: e.message })), [projectId]);
  useEffect(() => { setData(null); load(); }, [load]);

  if (!data || data.hidden) return null;
  const head = <h3 className="obr-h3">Cuentas por pagar</h3>;
  if (data.error) return <>{head}<ErrorBox message={data.error} onRetry={load} /></>;

  const { today, days, workers, pagos, totales: t } = data;
  const byId = new Map(workers.map((w) => [w.id, w]));

  // A click flips the day; going back to what the calendar says removes the exception.
  const flip = async (w, c) => {
    const works = !c.works, dow = dowOf(c.date);
    setBusy(true);
    try {
      await api.setAttendance([{ employeeId: w.id, date: c.date, works: works === (dow <= 5) ? null : works }]);
      notify(`${w.name}: ${fecha(c.date)} ${works ? 'trabaja' : 'no trabaja'}.`);
      await load();
    } catch (e) { notify(e.message); }
    setBusy(false);
  };

  const openPay = (g) => {
    const ws = g.workers.map((x) => byId.get(x.id)).filter((w) => w && w.aPagar + w.atrasado.importe > 0);
    const lines = ws.map((w) => ({ name: w.name, importe: (cents(w.aPagar) + cents(w.atrasado.importe)) / 100, atrasado: w.atrasado.importe }));
    setPaidOn(today);
    setPaying({ title: `Pago del ${diaPago(g.date)}`, items: ws.map((w) => ({ employeeId: w.id, hasta: g.date })), lines,
      importe: lines.reduce((a, l) => a + cents(l.importe), 0) / 100 });
  };
  const openPayAtrasado = () => {
    const ws = workers.filter((w) => w.atrasado.importe > 0);
    const lines = ws.map((w) => ({ name: w.name, importe: w.atrasado.importe, desde: w.atrasado.desde, hasta: w.atrasado.hasta }));
    setPaidOn(today);
    setPaying({ title: 'Pago de semanas anteriores', items: ws.map((w) => ({ employeeId: w.id, hasta: w.atrasado.hasta })), lines,
      importe: lines.reduce((a, l) => a + cents(l.importe), 0) / 100 });
  };
  const pay = async () => {
    setBusy(true);
    try {
      const r = await api.payProjectPayables(projectId, { items: paying.items, paidOn: paidOn || undefined });
      notify(`Pago registrado: ${r.updated} ${r.updated === 1 ? 'jornal' : 'jornales'} · ${eur(r.importe)}.`);
      setPaying(null);
      await load();
    } catch (e) { notify(e.message); }
    setBusy(false);
  };

  if (!workers.length) {
    return (
      <>
        {head}
        <div className="fin-card">
          <p className="fin-muted obr-cxp-empty"><i className="ri-team-line" aria-hidden="true"></i> Aún no hay trabajadores asignados a las obras de este proyecto. Elígelos en «Planificación (Gantt)»: el oficial y el peón de cada cuadrilla. A partir de ahí, aquí verás lo que se les debe cada día y cuándo se les paga.</p>
        </div>
      </>
    );
  }

  const atrasados = workers.filter((w) => w.atrasado.importe > 0);
  return (
    <>
      {head}
      <div className="fin-card is-flush obr-cxp">
        <div className="obr-cxp-pagos">
          {pagos.map((g) => (
            <div key={g.frequency + g.date} className={'obr-cxp-pago' + (g.ready && g.aPagar > 0 ? ' is-ready' : '') + (g.aPagar <= 0 && g.pagado > 0 ? ' is-paid' : '')}>
              <span className="obr-cxp-when"><i className={g.aPagar <= 0 && g.pagado > 0 ? 'ri-checkbox-circle-line' : 'ri-calendar-event-line'} aria-hidden="true"></i>{payLabel(g, today)}{g.frequency === 'mensual' ? ' · mensual' : ''}</span>
              <strong className="obr-cxp-amount">{eur(g.aPagar <= 0 && g.pagado > 0 ? g.pagado : g.aPagar)}</strong>
              <span className="fin-muted fin-small">
                {g.aPagar <= 0 && g.pagado > 0 ? `Jornales pagados de ${names(g.workers)}`
                  : `${eur(g.pendiente)} ya devengado + ${eur(g.previsto)} previsto hasta el pago${g.pagado > 0 ? ` · ${eur(g.pagado)} ya pagado` : ''}`}
              </span>
              {g.aPagar > 0 ? <span className="fin-small">{names(g.workers)}</span> : null}
              {g.ready && g.aPagar > 0 && !readOnly ? (
                <button type="button" className="fin-btn is-primary is-small" disabled={busy} onClick={() => openPay(g)}><i className="ri-hand-coin-line"></i>Registrar pago</button>
              ) : null}
            </div>
          ))}
        </div>

        {atrasados.length ? (
          <p className="fin-warn obr-cxp-warn">
            <i className="ri-error-warning-line" aria-hidden="true"></i>
            <span>{`${eur(t.atrasado)} de días anteriores sin pagar: ${atrasados.map((w) => `${w.name} ${eur(w.atrasado.importe)}`).join(', ')}.`}</span>
            {!readOnly ? <button type="button" className="fin-btn is-small" disabled={busy} onClick={openPayAtrasado}>Registrar pago</button> : null}
          </p>
        ) : null}

        <div className="fin-table-wrap">
          <table className="fin-table fin-cxp-grid obr-cxp-table" aria-busy={busy}>
            <thead>
              <tr>
                <th className="fin-cxp-worker">Trabajador</th>
                {days.map((d) => <th key={d.date} className={'fin-cxp-day' + (d.dow === 6 ? ' is-sat' : '') + (d.today ? ' is-today' : '')}><span>{`${DIA[d.dow]} ${Number(d.date.slice(8, 10))}`}</span></th>)}
                <th>Día de pago</th>
                <th className="fin-num">A pagar</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className={w.warning ? 'is-inactive' : ''}>
                  <td className="fin-cxp-worker">
                    <strong>{w.name}</strong>
                    <div className="fin-cxp-meta">
                      {w.roles.length ? <span>{w.roles.map((r) => ROL[r] || r).join(' y ')}</span> : null}
                      {Number(w.daily_pay) > 0 ? <span>{`${eur(w.daily_pay)}/día`}</span> : null}
                      {w.obras.length > 1 ? <span>{w.obras.map((o) => o.ref).join(', ')}</span> : null}
                    </div>
                    {w.otrosProyectos.length ? <div className="fin-muted fin-small" title="Sus jornales son los mismos en los dos proyectos: no se reparten.">{`También en ${w.otrosProyectos.map((p) => p.code || p.name).join(', ')}`}</div> : null}
                    {w.warning ? <Badge bg="#FBE0EA" fg="#B84371">{w.warning}</Badge> : null}
                  </td>
                  {w.cells.map((c, i) => {
                    const d = days[i], p = c.payable;
                    const cls = p ? (p.status === 'pagada' ? 'is-paid' : p.status === 'anulada' ? 'is-off is-annulled' : 'is-done') : c.forecast ? 'is-forecast' : c.works ? 'is-empty' : 'is-off';
                    const label = p ? `${eur(p.amount)}${p.status === 'pagada' ? ' · pagado' : p.status === 'anulada' ? ' · anulado' : ' · devengado'}` : c.forecast ? `${eur(c.forecast)} previsto` : c.works ? 'Trabaja' : 'No trabaja';
                    return (
                      <td key={c.date} className={'fin-cxp-cell' + (d.dow === 6 ? ' is-sat' : '')}>
                        <button type="button" className={cls + (c.explicit ? ' is-explicit' : '')} disabled={busy || readOnly || !w.activo}
                          title={`${w.name} · ${fecha(c.date)}: ${label}.${readOnly ? '' : ` Pulsa para marcar «${c.works ? 'No trabaja' : 'Trabaja'}».`}`}
                          aria-label={`${w.name}, ${fecha(c.date)}: ${label}. Cambiar a ${c.works ? 'no trabaja' : 'trabaja'}`}
                          onClick={() => flip(w, c)}>
                          {p && p.status !== 'anulada' ? eur(p.amount) : c.forecast ? eur(c.forecast) : c.works ? '·' : '—'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="fin-nowrap">
                    {w.frequency === 'mensual' ? `Fin de mes · ${sinAnio(w.payday)}` : `${DIA[dowOf(w.payday)]} ${sinAnio(w.payday)}`}
                    {w.frequency !== 'mensual' && dowOf(w.payday) === 6 ? <div className="fin-muted fin-small">Trabaja el sábado</div> : null}
                  </td>
                  <td className="fin-num fin-nowrap">
                    <strong>{eur(w.aPagar)}</strong>
                    {w.pagado > 0 ? <div className="fin-muted fin-small">{`${eur(w.pagado)} pagado`}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="fin-cxp-worker"><strong>Total</strong></td>
                <td colSpan={days.length + 1} className="fin-muted fin-small">{`${eur(t.pendiente)} ya devengado + ${eur(t.previsto)} previsto${t.pagado > 0 ? ` · ${eur(t.pagado)} pagado` : ''}`}</td>
                <td className="fin-num fin-nowrap"><strong>{eur(t.aPagar)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="fin-muted fin-small obr-cxp-note">
          Cada día que pasa se suma el jornal de cada trabajador (su pago diario de «Trabajadores»); hoy y los días que quedan son una previsión. Se paga el viernes, o el sábado si ese sábado trabaja: pulsa la casilla de un día para marcarlo como trabajado o no.
          {' '}«Registrar pago» marca sus jornales como pagados; el pago en sí se sigue registrando desde el banco o el efectivo.
        </p>
        {message ? <p className="fin-small obr-cxp-note" role="status">{message}</p> : null}
      </div>

      {paying ? (
        <Dialog title={paying.title} onClose={() => !busy && setPaying(null)}
          actions={<>
            <button type="button" className="fin-btn" disabled={busy} onClick={() => setPaying(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={busy || !paidOn} onClick={pay}><i className="ri-hand-coin-line"></i>{`Marcar ${eur(paying.importe)} como pagado`}</button>
          </>}>
          <p>Se marcan como pagados todos los jornales pendientes de:</p>
          <ul className="obr-cxp-lines">
            {paying.lines.map((l) => (
              <li key={l.name}><span>{l.name}{l.desde ? <span className="fin-muted fin-small">{` · del ${sinAnio(l.desde)} al ${sinAnio(l.hasta)}`}</span> : l.atrasado > 0 ? <span className="fin-muted fin-small">{` · incluye ${eur(l.atrasado)} de días anteriores`}</span> : null}</span><strong>{eur(l.importe)}</strong></li>
            ))}
          </ul>
          <label className="fin-field"><span>Fecha del pago</span><input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <p className="fin-muted fin-small">Solo cierra la cuenta por pagar: el pago en sí se registra desde el banco o el efectivo, como siempre.</p>
        </Dialog>
      ) : null}
    </>
  );
}
