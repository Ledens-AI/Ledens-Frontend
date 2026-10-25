import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, fecha } from './format.js';
import ProjectPicker from './ProjectPicker.jsx';
import { Badge, Empty, ErrorBox, Pager } from './ui.jsx';

const ROL = { oficial: { label: 'Oficial', bg: '#E3E7F3', fg: '#3E4D85' }, ayudante: { label: 'Ayudante', bg: '#DEF3F0', fg: '#2F6B63' } };

/* «Pendiente de trabajador»: bank movements sent here from «Pendiente de
 * conciliación» with «Pago a trabajadores», already split by the server
 * (FinanzasService.splitWorkerPayment). Each line needs a worker and a project;
 * «Guardar» creates the payment, which then only appears, read-only, in
 * «Pagos a trabajadores» with the movement's date. */
export default function PendienteTrabajador({ toast, onChanged }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [employees, setEmployees] = useState(null), [empError, setEmpError] = useState('');
  // lineId → { employeeId, project, saving, error }
  const [draft, setDraft] = useState(() => new Map());

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    api.workerQueue({ q: query, pagina: page, tam: 20 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, page, reload]);
  useEffect(() => { api.employees().then((d) => setEmployees(d.employees), (e) => setEmpError(e.message)); }, []);

  const get = (id) => draft.get(id) || {};
  const patch = (ids, p) => setDraft((m) => { const n = new Map(m); ids.forEach((id) => n.set(id, { ...(n.get(id) || {}), ...p })); return n; });
  const ready = (id) => { const d = get(id); return d.employeeId && d.project && !d.saving; };
  const allLines = (data?.rows || []).flatMap((b) => b.lines);
  const readyIds = allLines.map((l) => l.id).filter(ready);

  // Saved lines leave the page; a movement without lines left disappears too.
  const save = async (ids) => {
    if (!ids.length) return;
    patch(ids, { saving: true, error: '' });
    try {
      const res = await api.saveWorkerSplits(ids.map((id) => ({ splitId: id, employeeId: get(id).employeeId, projectId: get(id).project.id })));
      const ok = new Set(res.results.filter((r) => r.ok).map((r) => r.splitId));
      res.results.filter((r) => !r.ok).forEach((r) => patch([r.splitId], { saving: false, error: r.error }));
      setDraft((m) => { const n = new Map(m); ok.forEach((id) => n.delete(id)); return n; });
      setData((d) => {
        if (!d) return d;
        const rows = d.rows.map((b) => ({ ...b, saved: b.saved + b.lines.filter((l) => ok.has(l.id)).length, lines: b.lines.filter((l) => !ok.has(l.id)) })).filter((b) => b.lines.length);
        return { ...d, rows, lines: d.lines - ok.size, total: d.total - (d.rows.length - rows.length) };
      });
      if (ok.size) { onChanged?.(); toast?.(ok.size === 1 ? 'Pago guardado: ya aparece en Pagos a trabajadores.' : `${ok.size} pagos guardados: ya aparecen en Pagos a trabajadores.`); }
      if (res.failed && !ok.size) toast?.('No se ha guardado ningún pago. Revisa el aviso en cada línea.');
    } catch (e) {
      patch(ids, { saving: false, error: e.message });
    }
  };
  // If saving emptied this page, fetch it again (or the previous one).
  useEffect(() => {
    if (data && !data.rows.length && data.total > 0) { if (page > 1 && (page - 1) * data.pageSize >= data.total) setPage((p) => p - 1); else setReload((n) => n + 1); }
  }, [data, page]);

  const giveBack = async (b) => {
    try {
      await api.returnWorkerBatch(b.id);
      setData((d) => d && ({ ...d, rows: d.rows.filter((x) => x.id !== b.id), total: d.total - 1, lines: d.lines - b.lines.length }));
      toast?.('Movimiento devuelto a Pendiente de conciliación.');
    } catch (e) { toast?.(e.message); }
  };

  const employeeSelect = (value, onChange, label, disabled) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled || !employees}>
      <option value="">{employees ? 'Elige trabajador…' : 'Cargando…'}</option>
      {(employees || []).map((e) => <option key={e.id} value={e.id}>{e.position ? `${e.name} · ${e.position}` : e.name}</option>)}
    </select>
  );

  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Beneficiario, concepto o referencia del movimiento" /></label>
        {data ? <span className="fin-muted fin-self-end">{`${data.lines} ${data.lines === 1 ? 'pago pendiente' : 'pagos pendientes'} en ${data.total} ${data.total === 1 ? 'movimiento' : 'movimientos'}`}</span> : null}
      </div>
      {empError ? <ErrorBox message={`No se han podido cargar los trabajadores: ${empError}`} /> : null}

      {readyIds.length ? (
        <div className="fin-bulkbar is-staged" role="region" aria-label="Pagos listos para guardar">
          <strong>{readyIds.length === 1 ? '1 pago listo para guardar' : `${readyIds.length} pagos listos para guardar`}</strong>
          <span className="fin-grow"></span>
          <button type="button" className="fin-btn is-primary" disabled={readyIds.length > 100} onClick={() => save(readyIds)}>
            <i className="ri-save-3-line"></i>{readyIds.length === 1 ? 'Guardar' : `Guardar todos (${readyIds.length})`}
          </button>
        </div>
      ) : null}

      {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
      {!error && !data ? <div className="fin-loading">Cargando…</div> : null}
      {data && !data.rows.length && !data.total ? (
        <div className="fin-card"><Empty icon="ri-checkbox-circle-line" title="No hay pagos pendientes de trabajador"
          text="Envía aquí los pagos de nóminas desde «Pendiente de conciliación» con el botón «Pago a trabajadores»." /></div>
      ) : null}

      {(data?.rows || []).map((b) => {
        const lineIds = b.lines.map((l) => l.id);
        const busy = lineIds.some((id) => get(id).saving);
        return (
          <div className="fin-card is-flush" key={b.id}>
            <div className="fin-batch-head">
              <div className="fin-batch-title">
                <strong>{eur(b.total_amount)}</strong>
                <Badge {...ROL[b.role]}>{`${ROL[b.role].label} · ${eur(b.unit_amount)}`}</Badge>
                <span className="fin-muted">{[fecha(b.fecha), b.tercero, b.concepto, b.source_id].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="fin-batch-all">
                <label className="fin-field"><span>Trabajador para todos</span>
                  {employeeSelect('', (v) => v && patch(lineIds, { employeeId: v, error: '' }), 'Trabajador para todos los pagos del movimiento', busy)}</label>
                <div className="fin-field fin-w-picker"><span>Proyecto para todos</span>
                  <ProjectPicker value={null} placeholder="Proyecto…" label="Proyecto para todos los pagos del movimiento" disabled={busy}
                    onChange={(p) => patch(lineIds, { project: p, error: '' })} /></div>
                {b.saved === 0 ? <button type="button" className="fin-btn is-ghost fin-self-end" disabled={busy} onClick={() => giveBack(b)}>Devolver a conciliación</button> : null}
              </div>
            </div>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead><tr><th>Pago</th><th>Fecha</th><th className="fin-num">Importe</th><th>Rol</th><th>Trabajador</th><th className="fin-col-project">Proyecto</th><th><span className="fin-sr">Guardar</span></th></tr></thead>
                <tbody>
                  {b.lines.map((l) => {
                    const d = get(l.id);
                    return (
                      <tr key={l.id} className={d.employeeId || d.project ? 'is-staged' : ''}>
                        <td className="fin-nowrap">{`${l.line} de ${b.lines.length + b.saved}`}</td>
                        <td className="fin-nowrap">{fecha(b.fecha)}</td>
                        <td className="fin-num fin-nowrap"><strong>{eur(l.amount)}</strong></td>
                        <td><Badge {...ROL[l.role]}>{ROL[l.role].label}</Badge></td>
                        <td>{employeeSelect(d.employeeId, (v) => patch([l.id], { employeeId: v, error: '' }), 'Trabajador', d.saving)}</td>
                        <td className="fin-col-project">
                          <ProjectPicker compact value={d.project || null} placeholder="Proyecto…" disabled={d.saving} onChange={(p) => patch([l.id], { project: p, error: '' })} />
                          {d.error ? <div className="fin-error-inline fin-small">{d.error}</div> : null}
                        </td>
                        <td>
                          <button type="button" className="fin-btn is-primary is-small" disabled={!ready(l.id)} onClick={() => save([l.id])}
                            title={ready(l.id) ? undefined : 'Elige trabajador y proyecto'}>
                            <i className="ri-check-line"></i>{d.saving ? 'Guardando…' : 'Guardar'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {data && data.total > data.pageSize ? <div className="fin-card is-flush"><Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div> : null}
    </div>
  );
}
