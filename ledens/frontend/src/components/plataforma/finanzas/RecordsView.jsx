import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, num, fecha, TIPO, ESTADO } from './format.js';
import ProjectPicker from './ProjectPicker.jsx';
import RecordDrawer from './RecordDrawer.jsx';
import { Kpi, Badge, Dialog, Empty, ErrorBox, Pager } from './ui.jsx';

const key = (r) => r.type + ':' + r.id;
const EMPTY_FILTERS = { q: '', tipo: '', estado: '', proyecto: null, desde: '', hasta: '', min: '', max: '' };

/* One screen for "Pendientes de asignación" (mode="pendientes", all three
 * types, only records without a project) and for each table's own screen
 * (mode = material | trabajador | cliente, every record of that table).
 * Filtering, sorting and paging all happen on the server. */
export default function RecordsView({ mode, summary, initialProject, onChanged, toast }) {
  const pending = mode === 'pendientes';
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, proyecto: initialProject || null });
  const [draftQ, setDraftQ] = useState('');
  const [sort, setSort] = useState({ by: 'fecha', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Map());
  const [busy, setBusy] = useState({});
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => { setFilters({ ...EMPTY_FILTERS, proyecto: initialProject || null }); setDraftQ(''); setPage(1); setSelected(new Map()); }, [mode, initialProject]);
  useEffect(() => { const t = setTimeout(() => { setFilters((f) => (f.q === draftQ ? f : { ...f, q: draftQ })); setPage(1); }, 300); return () => clearTimeout(t); }, [draftQ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.records({
      pendientes: pending ? 1 : undefined, tipo: pending ? filters.tipo : mode, estado: filters.estado,
      proyecto: filters.proyecto?.id, q: filters.q, desde: filters.desde, hasta: filters.hasta,
      min: filters.min, max: filters.max, orden: sort.by, dir: sort.dir, pagina: page, tam: 25,
    }).then(
      (d) => { if (!cancelled) { setData(d); setError(''); setLoading(false); } },
      (e) => { if (!cancelled) { setError(e.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [mode, pending, filters, sort, page, reload]);

  const refresh = useCallback(() => { setReload((n) => n + 1); onChanged?.(); }, [onChanged]);
  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const replaceRow = (rec) => setData((d) => d && ({ ...d, rows: d.rows.map((r) => (key(r) === key(rec) ? { ...r, ...rec } : r)) }));

  // Inline assignment. Changing an existing project asks for a reason first.
  const assign = async (row, project, reason) => {
    if ((row.project_id || row.parts > 0) && reason === undefined) {
      setDialog({ kind: 'reason', row, project, reason: '' });
      return;
    }
    setBusy((b) => ({ ...b, [key(row)]: true }));
    try {
      const { record } = await api.assign(row.type, row.id, { projectId: project.id, version:row.version,expectedProjectId: row.project_id || null, reason });
      replaceRow({ ...record, suggestion: undefined });
      toast(`Asignado a ${project.label}.`);
      onChanged?.();
    } catch (e) {
      toast(e.message);
      if (e.status === 409) setReload((n) => n + 1);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key(row)]; return n; });
    }
  };

  const rows = data?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const toggleAll = () => setSelected((s) => { const n = new Map(s); rows.forEach((r) => (allOnPage ? n.delete(key(r)) : n.set(key(r), r))); return n; });
  const toggle = (r) => setSelected((s) => { const n = new Map(s); n.has(key(r)) ? n.delete(key(r)) : n.set(key(r), r); return n; });
  const sel = [...selected.values()];
  const withProject = sel.filter((r) => r.project_id || r.parts > 0).length;

  const runBulk = async (body) => {
    setDialog((d) => ({ ...d, saving: true, error: '' }));
    try {
      const res = await api.bulk({ ...body, items: sel.map((r) => ({ type: r.type, id: r.id,version:r.version })) });
      const byKey = new Map(sel.map((r) => [key(r), r]));
      setDialog({ kind: 'result', res, rows: res.results.map((x) => ({ ...x, row: byKey.get(x.type + ':' + x.id) })) });
      setSelected(new Map(res.results.filter((x) => !x.ok).map((x) => [x.type + ':' + x.id, byKey.get(x.type + ':' + x.id)])));
      refresh();
    } catch (e) {
      setDialog((d) => ({ ...d, saving: false, error: e.message }));
    }
  };

  const th = (label, by, cls) => (
    <th className={cls} aria-sort={sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {by ? (
        <button type="button" className="fin-sort" onClick={() => { setSort((s) => ({ by, dir: s.by === by && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(1); }}>
          {label}<i className={sort.by === by ? (sort.dir === 'asc' ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line') : 'ri-expand-up-down-line'} aria-hidden="true"></i>
        </button>
      ) : label}
    </th>
  );

  const hasFilters = filters.q || filters.tipo || filters.estado || filters.proyecto || filters.desde || filters.hasta || filters.min || filters.max;
  const terceroLabel = pending ? 'Proveedor / Cliente / Trabajador' : TIPO[mode].tercero;

  return (
    <div className="fin-stack">
      {pending ? (
        <div className="fin-kpis">
          <Kpi label="Registros pendientes" value={summary ? num(summary.pendientes) : '…'} icon="ri-inbox-line" />
          <Kpi label="Importe pendiente de asignar" value={summary ? eur(summary.importePendiente) : '…'} icon="ri-money-euro-circle-line" hint="Suma en valor absoluto de costes y cobros sin proyecto" />
          {Object.entries(TIPO).map(([t, d]) => (
            <Kpi key={t} label={d.plural} value={summary ? num(summary.porTipo[t].pendientes) : '…'} icon={d.icon}
              active={filters.tipo === t} onClick={() => setF({ tipo: filters.tipo === t ? '' : t })} />
          ))}
        </div>
      ) : null}

      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow">
          <span>Buscar</span>
          <input type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Proveedor, trabajador, cliente, concepto o nº de factura" />
        </label>
        {pending ? (
          <label className="fin-field">
            <span>Tipo</span>
            <select value={filters.tipo} onChange={(e) => setF({ tipo: e.target.value })}>
              <option value="">Todos</option>
              {Object.entries(TIPO).map(([t, d]) => <option key={t} value={t}>{d.label}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="fin-field">
              <span>Estado</span>
              <select value={filters.estado} onChange={(e) => setF({ estado: e.target.value })}>
                <option value="">Todos</option>
                {Object.entries(ESTADO).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
              </select>
            </label>
            <div className="fin-field fin-w-picker">
              <span>Proyecto</span>
              <ProjectPicker value={filters.proyecto} onChange={(p) => setF({ proyecto: p })} placeholder="Todos los proyectos" label="Filtrar por proyecto" />
            </div>
          </>
        )}
        <label className="fin-field"><span>Desde</span><input type="date" value={filters.desde} onChange={(e) => setF({ desde: e.target.value })} /></label>
        <label className="fin-field"><span>Hasta</span><input type="date" value={filters.hasta} onChange={(e) => setF({ hasta: e.target.value })} /></label>
        <label className="fin-field fin-w-num"><span>Importe mín.</span><input type="number" step="0.01" inputMode="decimal" value={filters.min} onChange={(e) => setF({ min: e.target.value })} /></label>
        <label className="fin-field fin-w-num"><span>Importe máx.</span><input type="number" step="0.01" inputMode="decimal" value={filters.max} onChange={(e) => setF({ max: e.target.value })} /></label>
        {hasFilters ? <button type="button" className="fin-btn is-ghost fin-self-end" onClick={() => { setDraftQ(''); setF({ ...EMPTY_FILTERS }); }}>Limpiar filtros</button> : null}
      </div>

      {sel.length ? (
        <div className="fin-bulkbar" role="region" aria-label="Acciones sobre la selección">
          <strong>{sel.length} {sel.length === 1 ? 'registro seleccionado' : 'registros seleccionados'}</strong>
          <span className="fin-muted">{eur(sel.reduce((a, r) => a + Number(r.importe), 0))}</span>
          <span className="fin-grow"></span>
          <button type="button" className="fin-btn is-primary" onClick={() => setDialog({ kind: 'bulk-assign', project: null, reason: '' })}>
            <i className="ri-folder-transfer-line"></i>{withProject ? 'Cambiar proyecto' : 'Asignar proyecto'}
          </button>
          <button type="button" className="fin-btn" onClick={() => setDialog({ kind: 'bulk-review', note: '' })}><i className="ri-flag-line"></i>Marcar para revisión</button>
          <button type="button" className="fin-btn is-ghost" onClick={() => setSelected(new Map())}>Quitar selección</button>
        </div>
      ) : null}

      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error ? (
          <div className="fin-table-wrap" aria-busy={loading}>
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="fin-col-check"><input type="checkbox" aria-label="Seleccionar todos los de esta página" checked={allOnPage} onChange={toggleAll} /></th>
                  {pending ? th('Tipo', 'tipo') : null}
                  {th('Fecha', 'fecha')}
                  <th>Documento</th>
                  {th(terceroLabel, 'tercero')}
                  {th('Concepto', 'concepto')}
                  {mode === 'material' ? <th className="fin-num">Cantidad</th> : null}
                  {th('Importe', 'importe', 'fin-num')}
                  <th className="fin-col-project">Proyecto</th>
                  {th('Estado', 'estado')}
                  <th><span className="fin-sr">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const k = key(r);
                  const split = r.parts > 0;
                  return (
                    <tr key={k} className={selected.has(k) ? 'is-selected' : ''}>
                      <td className="fin-col-check"><input type="checkbox" aria-label="Seleccionar registro" checked={selected.has(k)} onChange={() => toggle(r)} /></td>
                      {pending ? <td><Badge {...TIPO[r.type]} icon={TIPO[r.type].icon}>{TIPO[r.type].label}</Badge></td> : null}
                      <td className="fin-nowrap">{fecha(r.fecha)}</td>
                      <td className="fin-nowrap">{r.numerodocumento || (r.document_id ? 'Sin número' : <span className="fin-muted">Sin documento</span>)}</td>
                      <td className="fin-ellipsis" title={r.tercero || ''}>{r.tercero || <span className="fin-muted">—</span>}</td>
                      <td className="fin-ellipsis is-wide" title={r.concepto || ''}>{r.concepto || <span className="fin-muted">—</span>}</td>
                      {mode === 'material' ? <td className="fin-num fin-nowrap">{r.quantity != null ? `${num(r.quantity)} ${r.unidad || ''}` : '—'}</td> : null}
                      <td className="fin-num fin-nowrap"><strong>{eur(r.importe)}</strong></td>
                      <td className="fin-col-project">
                        {split ? (
                          <button type="button" className="fin-link" onClick={() => setOpen(r)}>{`Distribuido en ${r.parts} proyectos`}</button>
                        ) : (
                          <ProjectPicker compact value={r.project_id ? { id: r.project_id, label: r.project_label } : null}
                            placeholder="Asignar proyecto…" disabled={!!busy[k]} onChange={(p) => p.id !== r.project_id && assign(r, p)} />
                        )}
                        {r.suggestion && !r.project_id && !split ? (
                          <button type="button" className="fin-suggest" disabled={!!busy[k]} onClick={() => assign(r, { id: r.suggestion.projectId, label: r.suggestion.label })}
                            title={`Sugerencia (no confirmada): ${r.suggestion.reason}`}>
                            <i className="ri-lightbulb-line"></i>Sugerido: {r.suggestion.label}
                          </button>
                        ) : null}
                      </td>
                      <td>{busy[k] ? <span className="fin-muted">Guardando…</span> : <Badge {...ESTADO[r.estado]}>{ESTADO[r.estado].label}</Badge>}</td>
                      <td><button type="button" className="fin-iconbtn" aria-label="Ver detalle y editar" title="Ver detalle y editar" onClick={() => setOpen(r)}><i className="ri-side-bar-line"></i></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && !rows.length ? (
              pending && !hasFilters
                ? <Empty icon="ri-checkbox-circle-line" title="No hay registros pendientes" text="Todos los materiales, pagos a trabajadores y cobros tienen proyecto." />
                : <Empty icon="ri-search-line" title="Ningún registro coincide" text="Prueba con otros filtros." />
            ) : null}
            {loading && !rows.length ? <div className="fin-loading">Cargando registros…</div> : null}
          </div>
        ) : null}
        {data && data.total > 0 ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} extra={`Importe filtrado: ${eur(data.totalImporte)}`} /> : null}
      </div>

      {open ? (
        <RecordDrawer type={open.type} id={open.id} onClose={() => setOpen(null)} toast={toast}
          onSaved={(rec) => { replaceRow(rec); onChanged?.(); }} />
      ) : null}

      {dialog?.kind === 'reason' ? (
        <Dialog title="Cambiar el proyecto" onClose={() => setDialog(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" onClick={() => setDialog(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={!dialog.reason.trim()}
              onClick={() => { const d = dialog; setDialog(null); assign(d.row, d.project, d.reason.trim()); }}>Cambiar proyecto</button>
          </>}>
          <p>{dialog.row.parts > 0 ? `Este registro está distribuido en ${dialog.row.parts} proyectos.` : <>Este registro está asignado a <strong>{dialog.row.project_label}</strong>.</>}{' '}
            Pasará a <strong>{dialog.project.label}</strong>.</p>
          <label className="fin-field"><span>Motivo del cambio (queda en la auditoría)</span>
            <textarea rows={3} autoFocus value={dialog.reason} maxLength={500} onChange={(e) => setDialog({ ...dialog, reason: e.target.value })} /></label>
        </Dialog>
      ) : null}

      {dialog?.kind === 'bulk-assign' ? (
        <Dialog title={withProject ? 'Cambiar proyecto' : 'Asignar proyecto'} onClose={() => !dialog.saving && setDialog(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={dialog.saving} onClick={() => setDialog(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={dialog.saving || !dialog.project || (withProject > 0 && !dialog.reason.trim())}
              onClick={() => runBulk({ action: 'assign', projectId: dialog.project.id, reason: dialog.reason.trim() || undefined })}>
              {dialog.saving ? 'Guardando…' : `Asignar ${sel.length} ${sel.length === 1 ? 'registro' : 'registros'}`}
            </button>
          </>}>
          <p>Se asignarán <strong>{sel.length} {sel.length === 1 ? 'registro' : 'registros'}</strong> ({eur(sel.reduce((a, r) => a + Number(r.importe), 0))}) al proyecto que elijas.</p>
          <div className="fin-field"><span>Proyecto</span>
            <ProjectPicker autoFocus value={dialog.project} onChange={(p) => setDialog({ ...dialog, project: p })} /></div>
          {withProject ? (
            <>
              <div className="fin-warn"><i className="ri-alert-line"></i>{withProject === 1 ? '1 registro ya tiene' : `${withProject} registros ya tienen`} proyecto asignado o una distribución: se sustituirá.</div>
              <label className="fin-field"><span>Motivo del cambio (obligatorio)</span>
                <textarea rows={2} maxLength={500} value={dialog.reason} onChange={(e) => setDialog({ ...dialog, reason: e.target.value })} /></label>
            </>
          ) : null}
          {dialog.error ? <div className="fin-error-inline">{dialog.error}</div> : null}
        </Dialog>
      ) : null}

      {dialog?.kind === 'bulk-review' ? (
        <Dialog title="Marcar para revisión" onClose={() => !dialog.saving && setDialog(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={dialog.saving} onClick={() => setDialog(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={dialog.saving} onClick={() => runBulk({ action: 'review', note: dialog.note.trim() || undefined })}>
              {dialog.saving ? 'Guardando…' : `Marcar ${sel.length}`}
            </button>
          </>}>
          <p>Los {sel.length} registros quedarán en estado <strong>Revisión</strong> hasta que alguien les asigne proyecto.</p>
          <label className="fin-field"><span>Nota para quien lo revise (opcional)</span>
            <textarea rows={2} maxLength={500} value={dialog.note} onChange={(e) => setDialog({ ...dialog, note: e.target.value })} /></label>
          {dialog.error ? <div className="fin-error-inline">{dialog.error}</div> : null}
        </Dialog>
      ) : null}

      {dialog?.kind === 'result' ? (
        <Dialog title="Resultado de la operación" onClose={() => setDialog(null)}
          actions={<button type="button" className="fin-btn is-primary" onClick={() => setDialog(null)}>Entendido</button>}>
          <p><strong>{dialog.res.ok}</strong> {dialog.res.ok === 1 ? 'registro actualizado' : 'registros actualizados'}
            {dialog.res.failed ? <>, <strong className="fin-danger">{dialog.res.failed} sin cambios</strong>. Los que fallaron siguen seleccionados.</> : '.'}</p>
          <ul className="fin-result-list">
            {dialog.rows.map((x) => (
              <li key={x.type + x.id} className={x.ok ? 'is-ok' : 'is-fail'}>
                <i className={x.ok ? 'ri-checkbox-circle-fill' : 'ri-close-circle-fill'}></i>
                <span>{x.row ? `${TIPO[x.row.type].label} · ${fecha(x.row.fecha)} · ${x.row.tercero || '—'} · ${eur(x.row.importe)}` : x.id}</span>
                <span className="fin-muted">{x.ok ? (x.changed ? 'Actualizado' : 'Ya estaba así') : x.error}</span>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}
    </div>
  );
}
