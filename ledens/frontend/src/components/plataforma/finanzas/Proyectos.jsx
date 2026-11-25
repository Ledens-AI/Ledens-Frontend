import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { fecha } from './format.js';
import { Badge, Dialog, Empty, ErrorBox, Pager } from './ui.jsx';
import { nifProblem } from '../obras/facturas.js';

const EMPTY = { name: '', customerId: '', customerName: '', cif: '', salesman: '', address: '', municipio: '', provincia: '', statusId: '', startDate: '', endDate: '' };
const toForm = (p) => ({ name: p.name || '', customerId: p.customer_id || '', customerName: p.customer_id ? '' : p.customer_name_source || '', cif: p.cif || '',
  salesman: p.salesman || '', address: p.address || '', municipio: p.municipio || '', provincia: p.provincia || '', statusId: p.status_id || '',
  startDate: p.start_date || '', endDate: p.end_date || '' });

/* Proyectos: the list of ledens.projects with create/edit (admins). Jefes de
 * obra see their granted projects read-only. Saving sends the version of the
 * row that was shown, so a change made meanwhile is reported, not overwritten.
 * The code is never typed: the backend gives a new project the next P<año>-<NNN>
 * (the form shows it as a preview) and it does not change afterwards.
 * The CIF del cliente is optional here and checked like an invoice's; «Generar
 * factura» takes it from the project only, and opens this same window
 * (ProyectoDialog with requireCif) when the project has none. */
export default function Proyectos({ toast }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [estado, setEstado] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [options, setOptions] = useState({ statuses: [], customers: [] });
  const [edit, setEdit] = useState(null); // { project? } — null: closed, {}: new project

  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    api.projectList({ q: query, estado, pagina: page, tam: 25 }).then((d) => { if (!cancelled) setData(d); }, (e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [query, estado, page, reload]);
  const loadOptions = () => api.projectOptions().then(setOptions, () => {});
  useEffect(() => { loadOptions(); }, []);

  const canEdit = !!data?.canEdit;
  const replace = (project) => setData((d) => d && ({ ...d, rows: d.rows.map((r) => (r.id === project.id ? project : r)) }));
  const saved = (project, created) => {
    if (created) {
      setData((d) => d && ({ ...d, total: d.total + 1, rows: [project, ...d.rows] }));
      toast?.(`Proyecto «${project.name}» creado con el código ${project.code}. Ya se puede asignar en Gestión financiera.`);
      loadOptions(); // the preview of the next code moves on
    } else {
      replace(project);
      toast?.(project.changed ? `Proyecto «${project.name}» actualizado.` : 'Sin cambios que guardar.');
    }
    setEdit(null);
  };

  return (
    <div className="fin-stack">
      <div className="fin-card fin-filters">
        <label className="fin-field fin-grow"><span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, cliente, CIF, dirección o municipio" /></label>
        <label className="fin-field"><span>Estado</span>
          <select value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }}>
            <option value="">Todos</option>
            {options.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        {canEdit ? <button type="button" className="fin-btn is-primary fin-self-end" onClick={() => setEdit({})}><i className="ri-add-line"></i>Nuevo proyecto</button> : null}
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
                    <td className="fin-ellipsis">{p.cliente || <span className="fin-muted">—</span>}{p.cif ? <div className="fin-muted fin-small">{p.cif}</div> : null}</td>
                    <td>{[p.municipio, p.provincia].filter(Boolean).join(', ') || <span className="fin-muted">—</span>}</td>
                    <td>{p.estado || <span className="fin-muted">—</span>}</td>
                    <td className="fin-nowrap">{fecha(p.start_date)}</td>
                    <td className="fin-nowrap">{fecha(p.end_date)}</td>
                    <td>{p.importado ? <Badge bg="#F2F2EF" fg="#3A3A38">Importado</Badge> : <Badge bg="#E3E7F3" fg="#3E4D85">Creado aquí</Badge>}</td>
                    {canEdit ? <td><button type="button" className="fin-iconbtn" aria-label={`Editar ${p.name}`} title="Editar" onClick={() => setEdit({ project: p })}><i className="ri-edit-line"></i></button></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && data.total > data.pageSize ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </div>

      {edit ? <ProyectoDialog project={edit.project || null} options={options} onClose={() => setEdit(null)} onSaved={saved} onFresh={replace} /> : null}
    </div>
  );
}

/* The window of one project (new or existing), as in Gestión financiera →
 * Proyectos. Given `projectId` instead of `project`, it loads the project and
 * the options itself (how «Generar factura» opens it). With `requireCif`, the
 * CIF del cliente is required and has the focus: the invoice needs it;
 * `cifHint` ({ nif, origen }) is one seen elsewhere, offered with «Usar».
 * onSaved(project, created) after saving; onFresh(project) when someone else
 * changed it meanwhile and it was reloaded. */
export function ProyectoDialog({ project: given = null, projectId = null, options: givenOptions = null, requireCif = false, cifHint = null, onClose, onSaved, onFresh }) {
  const [project, setProject] = useState(given);
  const [loaded, setLoaded] = useState(null);
  const options = givenOptions || loaded || { statuses: [], customers: [] };
  const [form, setForm] = useState(given ? toForm(given) : projectId ? null : { ...EMPTY });
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const [cifTouched, setCifTouched] = useState(false);

  const load = () => {
    setLoadError('');
    if (!givenOptions) api.projectOptions().then(setLoaded, (e) => setLoadError(e.message));
    if (!given && projectId) api.getProject(projectId).then(({ project: p }) => { setProject(p); setForm(toForm(p)); }, (e) => setLoadError(e.message));
  };
  useEffect(load, []);

  // Picking a registered client drops any free text typed before (the field is hidden then).
  const set = (k) => (e) => { setForm((x) => ({ ...x, [k]: e.target.value, ...(k === 'customerId' && e.target.value ? { customerName: '' } : {}) })); setError(''); };
  const cifError = form && (form.cif.trim() ? nifProblem(form.cif) : requireCif ? 'Indica el CIF del cliente: hace falta para facturar' : null);
  const check = (f) => {
    if (!f.name.trim()) return 'El nombre es obligatorio.';
    if (f.startDate && f.endDate && f.endDate < f.startDate) return 'La fecha de fin no puede ser anterior a la de inicio.';
    return '';
  };
  const save = async () => {
    // A CIF problem shows under its field; anything else at the bottom.
    if (cifError) return setCifTouched(true);
    const err = check(form);
    if (err) return setError(err);
    setSaving(true);
    setError('');
    const body = { ...form, customerId: form.customerId || null, statusId: form.statusId || null };
    try {
      if (project) onSaved((await api.updateProject(project.id, { ...body, version: project.version })).project, false);
      else onSaved((await api.createProject(body)).project, true);
    } catch (e) {
      // A stale version: show the current row so the person can redo the change on top of it.
      // By id: the code or name may be exactly what the other person changed.
      if (e.status === 409 && project && /cambiado/.test(e.message)) {
        const fresh = (await api.getProject(project.id).catch(() => null))?.project;
        if (fresh) { onFresh?.(fresh); setProject(fresh); setForm(toForm(fresh)); }
      }
      setError(e.message);
      setSaving(false);
    }
  };

  const title = project ? `Editar «${project.name}»` : projectId ? 'Proyecto' : 'Nuevo proyecto';
  if (loadError) return <Dialog title={title} onClose={onClose}><ErrorBox message={loadError} onRetry={load} /></Dialog>;
  if (!form) return <Dialog title={title} onClose={onClose}><p className="fin-muted">Cargando el proyecto…</p></Dialog>;
  const f = form;
  const showCif = cifError && (cifTouched || (f.cif.trim() && f.cif !== (project?.cif || '')));
  return (
    <Dialog wide title={title} onClose={() => !saving && onClose()}
      actions={<>
        <button type="button" className="fin-btn is-ghost" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={saving} onClick={save}>{saving ? 'Guardando…' : project ? 'Guardar cambios' : 'Crear proyecto'}</button>
      </>}>
      {requireCif ? <div className="fin-warn"><i className="ri-error-warning-line"></i>{project?.cif
        ? 'El CIF del cliente de este proyecto no es válido: corrígelo para poder facturar. Se usa en todas las facturas del proyecto.'
        : 'Para emitir la factura hace falta el CIF del cliente. Se guarda en el proyecto y se usa en todas sus facturas.'}</div> : null}
      {project?.importado ? <div className="fin-warn"><i className="ri-information-line"></i>Proyecto importado de la contabilidad: una importación posterior podría volver a cambiar estos datos.</div> : null}
      <div className="fin-grid-form">
        <label className="fin-field"><span>Nombre *</span><input type="text" maxLength={200} value={f.name} onChange={set('name')} autoFocus={!requireCif} /></label>
        <label className="fin-field" title={project ? 'El código de un proyecto no cambia.' : 'Se asigna al crear: el siguiente número del año.'}>
          <span>{project ? 'Código' : 'Código (automático)'}</span>
          <input type="text" readOnly disabled value={project ? project.code || '—' : options.nextCode || ''} placeholder="Se asigna al crear" /></label>
        <label className="fin-field"><span>Estado</span>
          <select value={f.statusId} onChange={set('statusId')}><option value="">Sin estado</option>{options.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="fin-field"><span>Cliente registrado</span>
          <select value={f.customerId} onChange={set('customerId')}><option value="">Ninguno</option>{options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {!f.customerId ? <label className="fin-field"><span>Nombre del cliente</span><input type="text" maxLength={200} value={f.customerName} onChange={set('customerName')} placeholder="Si no está registrado" /></label> : null}
        <label className="fin-field"><span>{requireCif ? 'CIF del cliente *' : 'CIF del cliente'}</span>
          <input type="text" maxLength={30} value={f.cif} onChange={set('cif')} onBlur={() => setCifTouched(true)} placeholder="CIF, NIF o NIE" autoCapitalize="characters" spellCheck={false}
            autoFocus={requireCif} aria-invalid={showCif ? 'true' : undefined} />
          {/* div, not span: `.fin-field > span` does not wrap. */}
          {showCif ? <div className="fin-error-inline fin-small">{cifError}</div> : null}
          {cifHint && f.cif.trim().toUpperCase() !== cifHint.nif ? <div className="fin-muted fin-small">{`${cifHint.origen}: ${cifHint.nif}. `}
            <button type="button" className="fin-link" onClick={() => { setForm((x) => ({ ...x, cif: cifHint.nif })); setError(''); }}>Usar</button></div> : null}</label>
        <label className="fin-field"><span>Comercial</span><input type="text" maxLength={200} value={f.salesman} onChange={set('salesman')} /></label>
        <label className="fin-field"><span>Dirección</span><input type="text" maxLength={200} value={f.address} onChange={set('address')} /></label>
        <label className="fin-field"><span>Municipio</span><input type="text" maxLength={200} value={f.municipio} onChange={set('municipio')} /></label>
        <label className="fin-field"><span>Provincia</span><input type="text" maxLength={200} value={f.provincia} onChange={set('provincia')} /></label>
        <label className="fin-field"><span>Inicio</span><input type="date" value={f.startDate} onChange={set('startDate')} /></label>
        <label className="fin-field"><span>Fin</span><input type="date" value={f.endDate} onChange={set('endDate')} /></label>
      </div>
      {error ? <div className="fin-error-inline">{error}</div> : null}
    </Dialog>
  );
}
