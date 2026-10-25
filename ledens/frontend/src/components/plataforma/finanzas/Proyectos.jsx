import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { fecha } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Pager } from './ui.jsx';

const EMPTY = { code: '', name: '', customerId: '', customerName: '', salesman: '', address: '', municipio: '', provincia: '', statusId: '', startDate: '', endDate: '' };
const toForm = (p) => ({ code: p.code || '', name: p.name || '', customerId: p.customer_id || '', customerName: p.customer_id ? '' : p.customer_name_source || '',
  salesman: p.salesman || '', address: p.address || '', municipio: p.municipio || '', provincia: p.provincia || '', statusId: p.status_id || '',
  startDate: p.start_date || '', endDate: p.end_date || '' });

/* Proyectos: the list of ledens.projects with create/edit (admins). Jefes de
 * obra see their granted projects read-only. Saving sends the version of the
 * row that was shown, so a change made meanwhile is reported, not overwritten. */
export default function Proyectos({ toast }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [estado, setEstado] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [options, setOptions] = useState({ statuses: [], customers: [] });
  const [edit, setEdit] = useState(null); // { project?, form, saving, error }

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    api.projectList({ q: query, estado, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, estado, page, reload]);
  useEffect(() => { api.projectOptions().then(setOptions, () => {}); }, []);

  const canEdit = !!data?.canEdit;
  // Picking a registered client drops any free text typed before (the field is hidden then).
  const set = (k) => (e) => setEdit((x) => ({ ...x, form: { ...x.form, [k]: e.target.value, ...(k === 'customerId' && e.target.value ? { customerName: '' } : {}) }, error: '' }));
  const check = (f) => {
    if (!f.name.trim()) return 'El nombre es obligatorio.';
    if (f.startDate && f.endDate && f.endDate < f.startDate) return 'La fecha de fin no puede ser anterior a la de inicio.';
    return '';
  };
  const save = async () => {
    const err = check(edit.form);
    if (err) return setEdit((x) => ({ ...x, error: err }));
    setEdit((x) => ({ ...x, saving: true, error: '' }));
    const body = { ...edit.form, customerId: edit.form.customerId || null, statusId: edit.form.statusId || null };
    try {
      if (edit.project) {
        const { project } = await api.updateProject(edit.project.id, { ...body, version: edit.project.version });
        setData((d) => d && ({ ...d, rows: d.rows.map((r) => (r.id === project.id ? project : r)) }));
        toast?.(project.changed ? `Proyecto «${project.name}» actualizado.` : 'Sin cambios que guardar.');
      } else {
        const { project } = await api.createProject(body);
        setData((d) => d && ({ ...d, total: d.total + 1, rows: [project, ...d.rows] }));
        toast?.(`Proyecto «${project.name}» creado. Ya se puede asignar en Gestión financiera.`);
      }
      setEdit(null);
    } catch (e) {
      // A stale version: show the current row so the person can redo the change on top of it.
      if (e.status === 409 && edit.project && /cambiado/.test(e.message)) {
        // By id: the code or name may be exactly what the other person changed.
        const fresh = (await api.getProject(edit.project.id).catch(() => null))?.project;
        if (fresh) {
          setData((d) => d && ({ ...d, rows: d.rows.map((r) => (r.id === fresh.id ? fresh : r)) }));
          return setEdit({ project: fresh, form: toForm(fresh), saving: false, error: e.message });
        }
      }
      setEdit((x) => ({ ...x, saving: false, error: e.message }));
    }
  };

  const f = edit?.form;
  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, cliente, dirección o municipio" /></label>
        <label className="fin-field"><span>Estado</span>
          <select value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }}>
            <option value="">Todos</option>
            {options.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        {canEdit ? <button type="button" className="fin-btn is-primary fin-self-end" onClick={() => setEdit({ form: { ...EMPTY } })}><i className="ri-add-line"></i>Nuevo proyecto</button> : null}
      </div>

      <div className="fin-card is-flush">
        {error ? <ErrorBox message={error} onRetry={() => setReload((n) => n + 1)} /> : null}
        {!error && !data ? <div className="fin-loading">Cargando proyectos…</div> : null}
        {data && !data.rows.length ? (
          <Empty icon="ri-building-2-line" title={query || estado ? 'Ningún proyecto coincide' : 'Todavía no hay proyectos'}
            text={canEdit ? 'Crea el primero con «Nuevo proyecto».' : 'Si esperabas ver proyectos, pide acceso a un administrador.'} />
        ) : null}
        {data && data.rows.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>Código</th><th>Nombre</th><th>Cliente</th><th>Municipio</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Origen</th>{canEdit ? <th><span className="fin-sr">Editar</span></th> : null}</tr></thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <td className="fin-nowrap">{p.code || <span className="fin-muted">—</span>}</td>
                    <td className="fin-ellipsis is-wide" title={p.address || ''}><strong>{p.name}</strong>{p.address ? <div className="fin-muted fin-small">{p.address}</div> : null}</td>
                    <td className="fin-ellipsis">{p.cliente || <span className="fin-muted">—</span>}</td>
                    <td>{[p.municipio, p.provincia].filter(Boolean).join(', ') || <span className="fin-muted">—</span>}</td>
                    <td>{p.estado || <span className="fin-muted">—</span>}</td>
                    <td className="fin-nowrap">{fecha(p.start_date)}</td>
                    <td className="fin-nowrap">{fecha(p.end_date)}</td>
                    <td>{p.importado ? <Badge bg="#F2F2EF" fg="#3A3A38">Importado</Badge> : <Badge bg="#E3E7F3" fg="#3E4D85">Creado aquí</Badge>}</td>
                    {canEdit ? <td><button type="button" className="fin-iconbtn" aria-label={`Editar ${p.name}`} title="Editar" onClick={() => setEdit({ project: p, form: toForm(p) })}><i className="ri-edit-line"></i></button></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && data.total > data.pageSize ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </div>

      {edit ? (
        <Dialog wide title={edit.project ? `Editar «${edit.project.name}»` : 'Nuevo proyecto'} onClose={() => !edit.saving && setEdit(null)}
          actions={<>
            <button type="button" className="fin-btn is-ghost" disabled={edit.saving} onClick={() => setEdit(null)}>Cancelar</button>
            <button type="button" className="fin-btn is-primary" disabled={edit.saving} onClick={save}>{edit.saving ? 'Guardando…' : edit.project ? 'Guardar cambios' : 'Crear proyecto'}</button>
          </>}>
          {edit.project?.importado ? <div className="fin-warn"><i className="ri-information-line"></i>Proyecto importado de la contabilidad: una importación posterior podría volver a cambiar estos datos.</div> : null}
          <div className="fin-grid-form">
            <label className="fin-field"><span>Nombre *</span><input type="text" maxLength={200} value={f.name} onChange={set('name')} autoFocus /></label>
            <label className="fin-field"><span>Código</span><input type="text" maxLength={50} value={f.code} onChange={set('code')} placeholder="p. ej. OBRA-2026-014" /></label>
            <label className="fin-field"><span>Estado</span>
              <select value={f.statusId} onChange={set('statusId')}><option value="">Sin estado</option>{options.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="fin-field"><span>Cliente registrado</span>
              <select value={f.customerId} onChange={set('customerId')}><option value="">Ninguno</option>{options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            {!f.customerId ? <label className="fin-field"><span>Nombre del cliente</span><input type="text" maxLength={200} value={f.customerName} onChange={set('customerName')} placeholder="Si no está registrado" /></label> : null}
            <label className="fin-field"><span>Comercial</span><input type="text" maxLength={200} value={f.salesman} onChange={set('salesman')} /></label>
            <label className="fin-field"><span>Dirección</span><input type="text" maxLength={200} value={f.address} onChange={set('address')} /></label>
            <label className="fin-field"><span>Municipio</span><input type="text" maxLength={200} value={f.municipio} onChange={set('municipio')} /></label>
            <label className="fin-field"><span>Provincia</span><input type="text" maxLength={200} value={f.provincia} onChange={set('provincia')} /></label>
            <label className="fin-field"><span>Inicio</span><input type="date" value={f.startDate} onChange={set('startDate')} /></label>
            <label className="fin-field"><span>Fin</span><input type="date" value={f.endDate} onChange={set('endDate')} /></label>
          </div>
          {edit.error ? <div className="fin-error-inline">{edit.error}</div> : null}
        </Dialog>
      ) : null}
    </div>
  );
}
