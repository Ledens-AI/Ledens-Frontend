import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { eur, num } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Pager } from './ui.jsx';

const EMPTY = { code: '', name: '', positionId: '', tipo: '', dailyPay: '', hours: '' };
const toForm = (w) => ({ code: w.code || '', name: w.name || '', positionId: w.position_id || '', tipo: w.tipo || '',
  dailyPay: w.daily_pay != null ? String(w.daily_pay).replace('.', ',') : '', hours: w.hours != null ? String(w.hours).replace('.', ',') : '' });

/* Trabajadores: ledens.employees with alta, edición, baja and reactivación
 * (admins). Others see the list without the daily pay. A baja never deletes:
 * the worker keeps its payments and stops being offered for new ones. */
export default function Trabajadores({ toast }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState('');
  const [estado, setEstado] = useState('activos'), [puesto, setPuesto] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [positions, setPositions] = useState([]);
  const [edit, setEdit] = useState(null); // { worker?, form, saving, error }
  const [toggle, setToggle] = useState(null); // { worker, reason, saving, error }

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    api.workerList({ q: query, estado, puesto, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, estado, puesto, page, reload]);
  useEffect(() => { api.workerOptions().then((o) => setPositions(o.positions), () => {}); }, []);

  const canEdit = !!data?.canEdit;
  const set = (k) => (e) => setEdit((x) => ({ ...x, form: { ...x.form, [k]: e.target.value }, error: '' }));
  const check = (f) => {
    if (!f.name.trim()) return 'El nombre es obligatorio.';
    if (f.dailyPay && !/^\d{1,7}([.,]\d{1,2})?$/.test(f.dailyPay.trim())) return 'Pago diario no válido: euros con hasta 2 decimales.';
    if (f.hours && (!/^\d{1,2}([.,]\d{1,2})?$/.test(f.hours.trim()) || Number(f.hours.replace(',', '.')) <= 0 || Number(f.hours.replace(',', '.')) > 24)) return 'Horas por jornada entre 0 y 24.';
    return '';
  };
  // A stale version: reload the current row so the person can redo the change on top of it.
  // By id: the code or name may be exactly what the other person changed.
  const fresh = async (w) => (await api.getWorker(w.id).catch(() => null))?.worker;
  const replace = (w) => setData((d) => d && ({ ...d, rows: d.rows.map((r) => (r.id === w.id ? w : r)) }));
  // After a baja/reactivación the row may no longer match the status filter.
  const fits = (w) => estado === 'todos' || (estado === 'activos') === w.activo;

  const save = async () => {
    const err = check(edit.form);
    if (err) return setEdit((x) => ({ ...x, error: err }));
    setEdit((x) => ({ ...x, saving: true, error: '' }));
    const body = { ...edit.form, positionId: edit.form.positionId || null };
    try {
      if (edit.worker) {
        const { worker } = await api.updateWorker(edit.worker.id, { ...body, version: edit.worker.version });
        replace(worker);
        toast?.(worker.changed ? `${worker.name}: datos actualizados.` : 'Sin cambios que guardar.');
      } else {
        const { worker } = await api.createWorker(body);
        if (fits(worker)) setData((d) => d && ({ ...d, total: d.total + 1, rows: [worker, ...d.rows] }));
        toast?.(`${worker.name} dado de alta. Ya se puede elegir en «Pendiente de trabajador».`);
      }
      setEdit(null);
    } catch (e) {
      if (e.status === 409 && edit.worker && /cambiado/.test(e.message)) {
        const w = await fresh(edit.worker);
        if (w) { replace(w); return setEdit({ worker: w, form: toForm(w), saving: false, error: e.message }); }
      }
      setEdit((x) => ({ ...x, saving: false, error: e.message }));
    }
  };

  const confirmToggle = async () => {
    const t = toggle;
    setToggle({ ...t, saving: true, error: '' });
    try {
      const { worker } = await api.setWorkerActive(t.worker.id, { activo: !t.worker.activo, version: t.worker.version, reason: t.reason.trim() || undefined });
      setData((d) => d && (fits(worker) ? { ...d, rows: d.rows.map((r) => (r.id === worker.id ? worker : r)) } : { ...d, total: d.total - 1, rows: d.rows.filter((r) => r.id !== worker.id) }));
      toast?.(worker.activo ? `${worker.name} reactivado.` : `${worker.name} dado de baja. Conserva sus ${worker.pagos} pagos.`);
      setToggle(null);
    } catch (e) {
      if (e.status === 409) { const w = await fresh(t.worker); if (w) { replace(w); return setToggle({ ...t, worker: w, saving: false, error: e.message }); } }
      setToggle({ ...t, saving: false, error: e.message });
    }
  };

  const f = edit?.form;
  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código, tipo o puesto" /></label>
        <label className="fin-field"><span>Estado</span>
          <select value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }}>
            <option value="activos">Activos</option><option value="bajas">De baja</option><option value="todos">Todos</option>
          </select></label>
        <label className="fin-field"><span>Puesto</span>
          <select value={puesto} onChange={(e) => { setPuesto(e.target.value); setPage(1); }}>
            <option value="">Todos</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        {canEdit ? <button type="button" className="fin-btn is-primary fin-self-end" onClick={() => setEdit({ form: { ...EMPTY } })}><i className="ri-user-add-line"></i>Nuevo trabajador</button> : null}
      </div>

      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando trabajadores…</div> : null}
        {data && !data.rows.length ? (
          <Empty icon="ri-team-line" title={query || puesto || estado !== 'activos' ? 'Ningún trabajador coincide' : 'Todavía no hay trabajadores activos'}
            text={canEdit ? 'Da de alta el primero con «Nuevo trabajador».' : undefined} />
        ) : null}
        {data && data.rows.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>Código</th><th>Nombre</th><th>Puesto</th><th>Tipo</th>{canEdit ? <th className="fin-num">Pago diario</th> : null}<th className="fin-num">Horas/jornada</th><th className="fin-num">Pagos</th><th>Estado</th><th>Origen</th>{canEdit ? <th><span className="fin-sr">Acciones</span></th> : null}</tr></thead>
              <tbody>
                {data.rows.map((w) => (
                  <tr key={w.id} className={w.activo ? '' : 'is-inactive'}>
                    <td className="fin-nowrap">{w.code || <span className="fin-muted">—</span>}</td>
                    <td><strong>{w.name}</strong></td>
                    <td>{w.puesto || <span className="fin-muted">—</span>}</td>
                    <td>{w.tipo || <span className="fin-muted">—</span>}</td>
                    {canEdit ? <td className="fin-num fin-nowrap">{w.daily_pay != null ? eur(w.daily_pay) : <span className="fin-muted">—</span>}</td> : null}
                    <td className="fin-num">{w.hours != null ? num(w.hours) : <span className="fin-muted">—</span>}</td>
                    <td className="fin-num">{w.pagos}</td>
                    <td>{w.activo ? <Badge bg="#DEF3F0" fg="#2F6B63">Activo</Badge> : <Badge bg="#FBE0EA" fg="#B84371">De baja</Badge>}</td>
                    <td>{w.importado ? <Badge bg="#F2F2EF" fg="#3A3A38">Importado</Badge> : <Badge bg="#E3E7F3" fg="#3E4D85">Creado aquí</Badge>}</td>
                    {canEdit ? (
                      <td className="fin-nowrap">
                        <button type="button" className="fin-iconbtn" title="Editar" aria-label={`Editar ${w.name}`} onClick={() => setEdit({ worker: w, form: toForm(w) })}><i className="ri-edit-line"></i></button>
                        <button type="button" className="fin-btn is-ghost is-small" onClick={() => setToggle({ worker: w, reason: '' })}>{w.activo ? 'Dar de baja' : 'Reactivar'}</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && data.total > data.pageSize ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </div>

      {edit ? (
        <Dialog wide title={edit.worker ? `Editar a ${edit.worker.name}` : 'Nuevo trabajador'} onClose={() => !edit.saving && setEdit(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={edit.saving} onClick={() => setEdit(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={edit.saving} onClick={save}>{edit.saving ? 'Guardando…' : edit.worker ? 'Guardar cambios' : 'Dar de alta'}</button>
          </>}>
          {edit.worker?.importado ? <div className="fin-warn"><i className="ri-information-line"></i>Trabajador importado de la contabilidad: una importación posterior podría volver a cambiar estos datos.</div> : null}
          <div className="fin-grid-form">
            <label className="fin-field"><span>Nombre *</span><input type="text" maxLength={200} value={f.name} onChange={set('name')} autoFocus /></label>
            <label className="fin-field"><span>Código</span><input type="text" maxLength={50} value={f.code} onChange={set('code')} placeholder="p. ej. EMP-014" /></label>
            <label className="fin-field"><span>Puesto</span>
              <select value={f.positionId} onChange={set('positionId')}><option value="">Sin puesto</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="fin-field"><span>Tipo</span><input type="text" maxLength={200} value={f.tipo} onChange={set('tipo')} placeholder="p. ej. Fijo, Eventual, Autónomo" /></label>
            <label className="fin-field"><span>Pago diario (€)</span><input type="text" inputMode="decimal" value={f.dailyPay} onChange={set('dailyPay')} placeholder="0,00" /></label>
            <label className="fin-field"><span>Horas por jornada</span><input type="text" inputMode="decimal" value={f.hours} onChange={set('hours')} placeholder="8" /></label>
          </div>
          {edit.error ? <div className="fin-error-inline">{edit.error}</div> : null}
        </Dialog>
      ) : null}

      {toggle ? (
        <Dialog title={toggle.worker.activo ? `Dar de baja a ${toggle.worker.name}` : `Reactivar a ${toggle.worker.name}`} onClose={() => !toggle.saving && setToggle(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={toggle.saving} onClick={() => setToggle(null)}>Cancelar</button>
            <button type="button" className={'fin-btn ' + (toggle.worker.activo ? 'is-danger' : 'is-primary')} disabled={toggle.saving} onClick={confirmToggle}>
              {toggle.saving ? 'Guardando…' : toggle.worker.activo ? 'Dar de baja' : 'Reactivar'}</button>
          </>}>
          <p>{toggle.worker.activo
            ? `No se borra nada: conserva sus ${toggle.worker.pagos} pagos y su historial, pero deja de aparecer para pagos nuevos en «Pendiente de trabajador».`
            : 'Volverá a aparecer para pagos nuevos en «Pendiente de trabajador».'}</p>
          <label className="fin-field"><span>Motivo (opcional, queda en la auditoría)</span>
            <input type="text" maxLength={500} value={toggle.reason} onChange={(e) => setToggle({ ...toggle, reason: e.target.value })} placeholder={toggle.worker.activo ? 'p. ej. Fin de contrato' : ''} /></label>
          {toggle.error ? <div className="fin-error-inline">{toggle.error}</div> : null}
        </Dialog>
      ) : null}
    </div>
  );
}
