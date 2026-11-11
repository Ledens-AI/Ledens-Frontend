import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { eur, fecha, parseImporte } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Kpi, Pager } from './ui.jsx';
import ProjectPicker from './ProjectPicker.jsx';

/* Cuentas por pagar (admins; backend: finanzas/payables.js, migration 034).
 * «Jornales»: workers × working days. Every day that passes generates each
 * worker's jornal (their daily pay); Monday–Friday count as worked unless marked
 * otherwise and Saturdays only when marked (click a cell to change it).
 * «Listado»: every payable — the jornales and those entered by hand — to impute
 * to a project, mark as paid or annul. */

const DIA = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ESTADOS = { pendiente: ['Pendiente', '#FBF1DE', '#7A4E0E'], pagada: ['Pagada', '#DEF3F0', '#2F6B63'], anulada: ['Anulada', '#F2F2EF', '#6B6B68'] };
const madridToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (s, days) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const shiftMonth = (s, n) => { const [y, m] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const sum = (...v) => v.reduce((a, x) => a + Number(x || 0), 0);

function Necesidad({ n }) {
  if (!n) return null;
  return (
    <div className="fin-kpis">
      <Kpi icon="ri-calendar-event-line" label={`Semanales · hasta el sáb ${fecha(n.semana.hasta)}`} value={eur(sum(n.semana.pendiente, n.semana.previsto))}
        hint={`${eur(n.semana.pendiente)} ya devengado y sin pagar + ${eur(n.semana.previsto)} previsto de aquí al sábado`} />
      <Kpi icon="ri-calendar-2-line" label={`Mensuales · hasta el ${fecha(n.mes.hasta)}`} value={eur(sum(n.mes.pendiente, n.mes.previsto))}
        hint={`${eur(n.mes.pendiente)} ya devengado y sin pagar + ${eur(n.mes.previsto)} previsto hasta fin de mes`} />
      <Kpi icon="ri-file-list-3-line" label="Otras cuentas pendientes" value={eur(n.otras.total)}
        hint={`${eur(n.otras.semana)} vencen esta semana · ${eur(n.otras.mes)} este mes (incluye las que no tienen vencimiento)`} />
      <Kpi icon="ri-money-euro-circle-line" tone="warn" label="Total a cubrir" value={eur(sum(n.semana.pendiente, n.semana.previsto, n.mes.pendiente, n.mes.previsto, n.otras.mes))}
        hint="Semanales hasta el sábado + mensuales hasta fin de mes + otras cuentas que vencen este mes" />
    </div>
  );
}

function Jornales({ toast, onNeed, onChanged }) {
  const [periodo, setPeriodo] = useState('semana');
  const [ref, setRef] = useState(madridToday());
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError('');
    api.payablesGrid({ desde: ref, periodo }).then((d) => { if (!cancelled) { setData(d); onNeed(d.necesidad); } }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [ref, periodo, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (items, message) => {
    setBusy(true);
    try {
      const r = await api.setAttendance(items);
      toast?.(message || `${r.updated} ${r.updated === 1 ? 'día actualizado' : 'días actualizados'}${r.generated ? ` · ${r.generated} jornales generados` : ''}${r.annulled ? ` · ${r.annulled} anulados` : ''}.`);
      setReload((n) => n + 1); onChanged?.();
    } catch (e) { toast?.(e.message); }
    setBusy(false);
  };
  // A click flips the day; going back to what the calendar says removes the exception.
  const flip = (w, c, dow) => { const works = !c.works; send([{ employeeId: w.id, date: c.date, works: works === (dow <= 5) ? null : works }]); };
  const column = (d, works) => {
    if (!data) return;
    const items = data.rows.filter((w) => w.activo).map((w) => ({ employeeId: w.id, date: d.date, works: works === null ? null : works === (d.dow <= 5) ? null : works }));
    if (items.length) send(items);
  };
  const setFreq = async (w, frequency) => {
    try { await api.setPaySettings(w.id, { frequency }); toast?.(`${w.name}: pago ${frequency}.`); setReload((n) => n + 1); onChanged?.(); } catch (e) { toast?.(e.message); }
  };
  const setAccrues = async (w) => {
    try { await api.setPaySettings(w.id, { accrues: !w.accrues }); toast?.(w.accrues ? `${w.name} deja de generar jornales.` : `${w.name} vuelve a generar jornales desde hoy.`); setReload((n) => n + 1); onChanged?.(); } catch (e) { toast?.(e.message); }
  };

  const title = data ? (periodo === 'semana' ? `Semana del ${fecha(data.from)} al ${fecha(data.to)}` : `${MESES[Number(data.from.slice(5, 7)) - 1]} ${data.from.slice(0, 4)}`) : '';
  const move = (n) => setRef((r) => (periodo === 'semana' ? shift(data?.from || r, 7 * n) : shiftMonth(data?.from || r, n)));
  const totals = useMemo(() => data && data.rows.reduce((a, w) => ({ devengado: a.devengado + w.devengado, previsto: a.previsto + w.previsto, total: a.total + w.total }), { devengado: 0, previsto: 0, total: 0 }), [data]);

  return (
    <div className="fin-card is-flush">
      <div className="fin-card-head fin-pad">
        <div className="fin-segmented" role="group" aria-label="Periodo">
          {[['semana', 'Semana'], ['mes', 'Mes']].map(([v, l]) => <button key={v} type="button" className={periodo === v ? 'is-on' : ''} aria-pressed={periodo === v} onClick={() => setPeriodo(v)}>{l}</button>)}
        </div>
        <button type="button" className="fin-btn is-ghost" aria-label="Anterior" onClick={() => move(-1)}><i className="ri-arrow-left-s-line"></i></button>
        <strong className="fin-cxp-title">{title}</strong>
        <button type="button" className="fin-btn is-ghost" aria-label="Siguiente" onClick={() => move(1)}><i className="ri-arrow-right-s-line"></i></button>
        <button type="button" className="fin-btn is-ghost" onClick={() => setRef(madridToday())}>Hoy</button>
        <span className="fin-grow"></span>
        <span className="fin-muted fin-small"><span className="fin-cxp-dot is-done"></span>Devengado <span className="fin-cxp-dot is-paid"></span>Pagado <span className="fin-cxp-dot is-forecast"></span>Previsto <span className="fin-cxp-dot is-off"></span>No trabaja</span>
      </div>
      {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
      {!error && !data ? <div className="fin-loading">Cargando jornales…</div> : null}
      {data && !data.rows.length ? <Empty icon="ri-team-line" title="No hay trabajadores activos" text="Dalos de alta en «Trabajadores» con su pago diario." /> : null}
      {data && data.rows.length ? (
        <div className="fin-table-wrap">
          <table className={'fin-table fin-cxp-grid' + (periodo === 'mes' ? ' is-month' : '')} aria-busy={busy}>
            <thead>
              <tr>
                <th className="fin-cxp-worker">Trabajador</th>
                {data.days.map((d) => (
                  <th key={d.date} className={'fin-cxp-day' + (d.dow === 6 ? ' is-sat' : '') + (d.today ? ' is-today' : '')}>
                    <span>{DIA[d.dow]} {Number(d.date.slice(8, 10))}</span>
                    <span className="fin-cxp-colact">
                      <button type="button" title="Todos trabajan este día" aria-label={`Todos trabajan el ${fecha(d.date)}`} disabled={busy} onClick={() => column(d, true)}><i className="ri-check-double-line"></i></button>
                      <button type="button" title="Nadie trabaja este día (festivo)" aria-label={`Nadie trabaja el ${fecha(d.date)}`} disabled={busy} onClick={() => column(d, false)}><i className="ri-close-line"></i></button>
                    </span>
                  </th>
                ))}
                <th className="fin-num">Devengado</th><th className="fin-num">Previsto</th><th className="fin-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((w) => (
                <tr key={w.id} className={w.warning ? 'is-inactive' : ''}>
                  <td className="fin-cxp-worker">
                    <strong>{w.name}</strong>
                    <div className="fin-cxp-meta">
                      {w.daily_pay ? <span>{eur(w.daily_pay)}/día</span> : null}
                      <select aria-label={`Frecuencia de pago de ${w.name}`} value={w.frequency} disabled={!w.activo} onChange={(e) => setFreq(w, e.target.value)}>
                        <option value="semanal">Semanal</option><option value="mensual">Mensual</option>
                      </select>
                      {w.activo && Number(w.daily_pay) > 0 ? (
                        <button type="button" className="fin-link" onClick={() => setAccrues(w)}>{w.accrues ? 'Pausar' : 'Reanudar'}</button>
                      ) : null}
                    </div>
                    {w.warning ? <Badge bg="#FBE0EA" fg="#B84371">{w.warning}</Badge> : null}
                  </td>
                  {w.cells.map((c, i) => {
                    const d = data.days[i], p = c.payable;
                    const cls = p ? (p.status === 'pagada' ? 'is-paid' : p.status === 'anulada' ? 'is-off is-annulled' : 'is-done') : c.forecast ? 'is-forecast' : c.works ? 'is-empty' : 'is-off';
                    const label = p ? `${eur(p.amount)}${p.status === 'pagada' ? ' · pagado' : p.status === 'anulada' ? ' · anulado' : ''}` : c.forecast ? `${eur(c.forecast)} previsto` : c.works ? 'Trabaja' : 'No trabaja';
                    return (
                      <td key={c.date} className={'fin-cxp-cell' + (d.dow === 6 ? ' is-sat' : '')}>
                        <button type="button" className={cls + (c.explicit ? ' is-explicit' : '')} disabled={busy || !w.activo}
                          title={`${w.name} · ${fecha(c.date)}: ${label}. Pulsa para marcar «${c.works ? 'No trabaja' : 'Trabaja'}».`}
                          aria-label={`${w.name}, ${fecha(c.date)}: ${label}. Cambiar a ${c.works ? 'no trabaja' : 'trabaja'}`}
                          onClick={() => flip(w, c, d.dow)}>
                          {p && p.status !== 'anulada' ? eur(p.amount) : c.forecast ? eur(c.forecast) : c.works ? '·' : '—'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="fin-num fin-nowrap">{eur(w.devengado)}</td>
                  <td className="fin-num fin-nowrap fin-muted">{eur(w.previsto)}</td>
                  <td className="fin-num fin-nowrap"><strong>{eur(w.total)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="fin-cxp-worker"><strong>Total del día</strong></td>
                {data.days.map((d) => <td key={d.date} className={'fin-num fin-nowrap fin-cxp-cell' + (d.dow === 6 ? ' is-sat' : '')}>{data.dayTotals[d.date] ? eur(data.dayTotals[d.date]) : '—'}</td>)}
                <td className="fin-num fin-nowrap">{eur(totals.devengado)}</td>
                <td className="fin-num fin-nowrap">{eur(totals.previsto)}</td>
                <td className="fin-num fin-nowrap"><strong>{eur(totals.total)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
      {data ? (
        <p className="fin-muted fin-small fin-pad">
          {`Se generan jornales desde el ${fecha(data.jornalesDesde)}. Cada día, al terminar, se genera el jornal de cada trabajador que lo ha trabajado; el día de hoy y los siguientes son una previsión. `}
          De lunes a viernes cuentan como trabajados y los sábados no: pulsa una casilla para cambiarlo (un sábado trabajado, una ausencia) o usa los botones de la cabecera para todo el día (un festivo). Las casillas marcadas a mano llevan borde.
        </p>
      ) : null}
    </div>
  );
}

const EMPTY_FORM = { concept: '', amount: '', counterparty: '', employeeId: '', project: null, dueOn: '', notes: '' };
const toForm = (r) => ({ concept: r.concept || '', amount: String(r.amount).replace('.', ','), counterparty: r.counterparty || '', employeeId: r.employee_id || '',
  project: r.project_id ? { id: r.project_id, label: r.project } : null, dueOn: r.due_on || '', notes: r.notes || '' });

function Listado({ toast, onNeed, onChanged, version }) {
  const [filters, setFilters] = useState({ estado: 'pendiente', origen: '', trabajador: '', desde: '', hasta: '' });
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState(new Map());
  const [edit, setEdit] = useState(null); // { row?, form, saving, error }
  const [dialog, setDialog] = useState(null); // { kind: 'pagar' | 'proyecto', paidOn, project, saving, error }

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    api.payables({ ...filters, q: query, pagina: page, tam: 50 }).then((d) => { if (!cancelled) { setData(d); onNeed(d.necesidad); } }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [filters, query, page, reload, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.payablesOptions().then((o) => setEmployees(o.employees), () => {}); }, []);

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); setSelected(new Map()); };
  const refresh = () => { setReload((n) => n + 1); setSelected(new Map()); onChanged?.(); };
  const sel = [...selected.values()];
  const rows = data?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (r) => setSelected((m) => { const n = new Map(m); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  const toggleAll = () => setSelected((m) => { const n = new Map(m); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.set(r.id, r)); return n; });

  const status = async (status, extra = {}) => {
    try {
      const r = await api.setPayableStatus({ ids: sel.map((x) => x.id), status, ...extra });
      toast?.(`${r.updated} ${r.updated === 1 ? 'cuenta' : 'cuentas'} ${status === 'pagada' ? 'pagadas' : status === 'anulada' ? 'anuladas' : 'pendientes'} · ${eur(r.importe)}.`);
      setDialog(null); refresh();
    } catch (e) { if (dialog) setDialog((d) => ({ ...d, saving: false, error: e.message })); else toast?.(e.message); }
  };
  const project = async () => {
    setDialog((d) => ({ ...d, saving: true, error: '' }));
    try {
      const r = await api.setPayableProject({ ids: sel.map((x) => x.id), projectId: dialog.project?.id || null });
      toast?.(`${r.updated} ${r.updated === 1 ? 'cuenta imputada' : 'cuentas imputadas'}.`); setDialog(null); refresh();
    } catch (e) { setDialog((d) => ({ ...d, saving: false, error: e.message })); }
  };

  const set = (k) => (e) => setEdit((x) => ({ ...x, form: { ...x.form, [k]: e.target.value }, error: '' }));
  const save = async () => {
    const f = edit.form, jornal = edit.row?.origin === 'jornal';
    const amount = parseImporte(f.amount);
    if (!jornal && !f.concept.trim()) return setEdit((x) => ({ ...x, error: 'El concepto es obligatorio.' }));
    if (!amount || Number(amount) <= 0) return setEdit((x) => ({ ...x, error: 'Importe no válido: euros, mayor que cero.' }));
    setEdit((x) => ({ ...x, saving: true, error: '' }));
    const body = { concept: f.concept, amount, counterparty: f.counterparty, employeeId: f.employeeId || null, projectId: f.project?.id || null, dueOn: f.dueOn || null, notes: f.notes };
    try {
      if (edit.row) {
        const { payable } = await api.updatePayable(edit.row.id, { ...body, version: edit.row.version });
        toast?.(payable.changed ? 'Cuenta actualizada.' : 'Sin cambios que guardar.');
      } else {
        const { payable } = await api.createPayable(body);
        toast?.(`«${payable.concept}» añadida: ${eur(payable.amount)}.`);
      }
      setEdit(null); refresh();
    } catch (e) { setEdit((x) => ({ ...x, saving: false, error: e.message })); }
  };

  const hasFilters = filters.estado !== 'pendiente' || filters.origen || filters.trabajador || filters.desde || filters.hasta || query;
  const f = edit?.form;
  const onlyManual = sel.length && sel.every((r) => r.origin === 'manual');
  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Concepto, acreedor, trabajador, proyecto o notas" /></label>
        <label className="fin-field"><span>Estado</span>
          <select value={filters.estado} onChange={(e) => setF({ estado: e.target.value })}>
            <option value="pendiente">Pendientes</option><option value="pagada">Pagadas</option><option value="anulada">Anuladas</option><option value="todas">Todas</option>
          </select></label>
        <label className="fin-field"><span>Origen</span>
          <select value={filters.origen} onChange={(e) => setF({ origen: e.target.value })}>
            <option value="">Todos</option><option value="jornal">Jornales</option><option value="manual">Añadidas a mano</option>
          </select></label>
        <label className="fin-field"><span>Trabajador</span>
          <select value={filters.trabajador} onChange={(e) => setF({ trabajador: e.target.value })}>
            <option value="">Todos</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
        <label className="fin-field"><span>Vence desde</span><input type="date" value={filters.desde} onChange={(e) => setF({ desde: e.target.value })} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={filters.hasta} onChange={(e) => setF({ hasta: e.target.value })} /></label>
        {hasFilters ? <button type="button" className="fin-btn is-ghost fin-self-end" onClick={() => { setQ(''); setF({ estado: 'pendiente', origen: '', trabajador: '', desde: '', hasta: '' }); }}>Limpiar filtros</button> : null}
        <button type="button" className="fin-btn is-primary fin-self-end" onClick={() => setEdit({ form: { ...EMPTY_FORM } })}><i className="ri-add-line"></i>Nueva cuenta por pagar</button>
      </div>

      {sel.length ? (
        <div className="fin-bulkbar" role="region" aria-label="Acciones sobre la selección">
          <strong>{sel.length} {sel.length === 1 ? 'cuenta seleccionada' : 'cuentas seleccionadas'}</strong>
          <span className="fin-muted">{eur(sum(...sel.map((r) => r.amount)))}</span>
          <span className="fin-grow"></span>
          <button type="button" className="fin-btn is-primary" onClick={() => setDialog({ kind: 'pagar', paidOn: madridToday() })}><i className="ri-check-line"></i>Marcar pagadas</button>
          <button type="button" className="fin-btn" onClick={() => setDialog({ kind: 'proyecto', project: null })}><i className="ri-folder-transfer-line"></i>Imputar a proyecto</button>
          {sel.some((r) => r.status === 'pagada') ? <button type="button" className="fin-btn" onClick={() => status('pendiente')}>Volver a pendientes</button> : null}
          {onlyManual ? <button type="button" className="fin-btn" onClick={() => status('anulada')}>Anular</button> : null}
          <button type="button" className="fin-btn is-ghost" onClick={() => setSelected(new Map())}>Quitar selección</button>
        </div>
      ) : null}

      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando cuentas por pagar…</div> : null}
        {data && !rows.length ? <Empty icon="ri-file-list-3-line" title={hasFilters ? 'Ninguna cuenta coincide' : 'No hay cuentas pendientes'} text="Añade una con «Nueva cuenta por pagar». Los jornales se generan solos cada día." /> : null}
        {rows.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr>
                <th className="fin-col-check"><input type="checkbox" aria-label="Seleccionar todas las de esta página" checked={allOnPage} onChange={toggleAll} /></th>
                <th>Vence</th><th>Concepto</th><th>Acreedor</th><th>Proyecto</th><th className="fin-num">Importe</th><th>Estado</th><th>Origen</th><th><span className="fin-sr">Acciones</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? 'is-selected' : r.status === 'anulada' ? 'is-inactive' : ''}>
                    <td className="fin-col-check"><input type="checkbox" aria-label={`Seleccionar ${r.concept}`} checked={selected.has(r.id)} onChange={() => toggle(r)} /></td>
                    <td className="fin-nowrap">{fecha(r.due_on)}</td>
                    <td><strong>{r.concept}</strong>{r.notes ? <div className="fin-muted fin-small">{r.notes}</div> : null}</td>
                    <td>{r.employee || r.counterparty || <span className="fin-muted">—</span>}{r.origin === 'jornal' ? <div className="fin-muted fin-small">{r.frequency === 'mensual' ? 'Pago mensual' : 'Pago semanal'}</div> : null}</td>
                    <td>{r.project ? <>{r.project}{r.project_code ? <div className="fin-muted fin-small">{r.project_code}</div> : null}</> : <span className="fin-muted">Sin proyecto</span>}</td>
                    <td className="fin-num fin-nowrap">{eur(r.amount)}</td>
                    <td><Badge bg={ESTADOS[r.status][1]} fg={ESTADOS[r.status][2]}>{ESTADOS[r.status][0]}</Badge>{r.paid_on ? <div className="fin-muted fin-small">{fecha(r.paid_on)}</div> : null}</td>
                    <td>{r.origin === 'jornal' ? <Badge bg="#DEF3F0" fg="#2F6B63">Jornal</Badge> : <Badge bg="#E3E7F3" fg="#3E4D85">Manual</Badge>}</td>
                    <td><button type="button" className="fin-iconbtn" title="Editar" aria-label={`Editar ${r.concept}`} onClick={() => setEdit({ row: r, form: toForm(r) })}><i className="ri-edit-line"></i></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && data.total > data.pageSize ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => { setPage(p); }} extra={`${eur(data.importe)} en total`} /> : null}
        {data && rows.length && data.total <= data.pageSize ? <div className="fin-pager"><span className="fin-muted">{`${data.total} ${data.total === 1 ? 'cuenta' : 'cuentas'} · ${eur(data.importe)}`}</span></div> : null}
      </div>

      {edit ? (
        <Dialog wide title={edit.row ? `Editar «${edit.row.concept}»` : 'Nueva cuenta por pagar'} onClose={() => !edit.saving && setEdit(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={edit.saving} onClick={() => setEdit(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={edit.saving} onClick={save}>{edit.saving ? 'Guardando…' : edit.row ? 'Guardar cambios' : 'Añadir'}</button>
          </>}>
          {edit.row?.origin === 'jornal' ? <div className="fin-warn"><i className="ri-information-line"></i>{`Jornal de ${edit.row.employee} del ${fecha(edit.row.work_date)}. Para quitarlo, marca ese día como «No trabaja» en la tabla de jornales.`}</div> : null}
          {edit.row && edit.row.status !== 'pendiente' ? <div className="fin-warn"><i className="ri-information-line"></i>El importe solo se puede cambiar mientras la cuenta está pendiente.</div> : null}
          <div className="fin-grid-form">
            {edit.row?.origin !== 'jornal' ? <label className="fin-field fin-span-all"><span>Concepto *</span><input type="text" maxLength={300} value={f.concept} onChange={set('concept')} autoFocus placeholder="p. ej. Alquiler de andamio, factura de fontanero" /></label> : null}
            <label className="fin-field"><span>Importe (€) *</span><input type="text" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="0,00" /></label>
            <label className="fin-field"><span>Vence</span><input type="date" value={f.dueOn} onChange={set('dueOn')} /></label>
            {edit.row?.origin !== 'jornal' ? <>
              <label className="fin-field"><span>Acreedor</span><input type="text" maxLength={200} value={f.counterparty} onChange={set('counterparty')} placeholder="Proveedor, subcontrata…" /></label>
              <label className="fin-field"><span>Trabajador (opcional)</span>
                <select value={f.employeeId} onChange={set('employeeId')}><option value="">Ninguno</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            </> : null}
            <div className="fin-field fin-span-all"><span>Proyecto</span>
              <ProjectPicker value={f.project} onChange={(p) => setEdit((x) => ({ ...x, form: { ...x.form, project: p }, error: '' }))} placeholder="Sin proyecto" />
              {f.project ? <button type="button" className="fin-link fin-small" onClick={() => setEdit((x) => ({ ...x, form: { ...x.form, project: null } }))}>Quitar proyecto</button> : null}
            </div>
            <label className="fin-field fin-span-all"><span>Notas</span><input type="text" maxLength={1000} value={f.notes} onChange={set('notes')} /></label>
          </div>
          {edit.error ? <div className="fin-error-inline">{edit.error}</div> : null}
        </Dialog>
      ) : null}

      {dialog?.kind === 'pagar' ? (
        <Dialog title={`Marcar ${sel.length} ${sel.length === 1 ? 'cuenta' : 'cuentas'} como pagadas`} onClose={() => !dialog.saving && setDialog(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={dialog.saving} onClick={() => setDialog(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={dialog.saving || !dialog.paidOn} onClick={() => { setDialog((d) => ({ ...d, saving: true, error: '' })); status('pagada', { paidOn: dialog.paidOn }); }}>{dialog.saving ? 'Guardando…' : `Pagar ${eur(sum(...sel.map((r) => r.amount)))}`}</button>
          </>}>
          <label className="fin-field"><span>Fecha de pago</span><input type="date" value={dialog.paidOn} onChange={(e) => setDialog((d) => ({ ...d, paidOn: e.target.value }))} /></label>
          <p className="fin-muted fin-small">Solo marca la deuda como pagada; el pago real se sigue registrando desde el banco o el efectivo.</p>
          {dialog.error ? <div className="fin-error-inline">{dialog.error}</div> : null}
        </Dialog>
      ) : null}
      {dialog?.kind === 'proyecto' ? (
        <Dialog title={`Imputar ${sel.length} ${sel.length === 1 ? 'cuenta' : 'cuentas'} a un proyecto`} onClose={() => !dialog.saving && setDialog(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={dialog.saving} onClick={() => setDialog(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={dialog.saving} onClick={project}>{dialog.saving ? 'Guardando…' : dialog.project ? 'Imputar' : 'Dejar sin proyecto'}</button>
          </>}>
          <ProjectPicker value={dialog.project} onChange={(p) => setDialog((d) => ({ ...d, project: p, error: '' }))} autoFocus placeholder="Buscar proyecto (vacío = sin proyecto)" />
          {dialog.error ? <div className="fin-error-inline">{dialog.error}</div> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

export default function CuentasPorPagar({ toast }) {
  const [vista, setVista] = useState('jornales');
  const [need, setNeed] = useState(null);
  const [version, setVersion] = useState(0);
  const onNeed = useCallback((n) => setNeed(n), []);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <div className="fin-stack">
      <Necesidad n={need} />
      <div className="fin-segmented" role="group" aria-label="Vista">
        {[['jornales', 'Jornales por día'], ['listado', 'Listado de cuentas']].map(([v, l]) => <button key={v} type="button" className={vista === v ? 'is-on' : ''} aria-pressed={vista === v} onClick={() => setVista(v)}>{l}</button>)}
      </div>
      {vista === 'jornales' ? <Jornales toast={toast} onNeed={onNeed} onChanged={changed} /> : <Listado toast={toast} onNeed={onNeed} onChanged={changed} version={version} />}
    </div>
  );
}
