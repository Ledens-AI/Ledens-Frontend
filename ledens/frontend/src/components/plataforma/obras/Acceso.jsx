import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, invitaciones } from './api.js';
import { Badge, Dialog, ErrorBox } from '../finanzas/ui.jsx';
import { fecha } from '../finanzas/format.js';

/* «Usuarios con acceso» of an obra (root presupuesto), on the project page and
 * in the «Clientes» tab (backend: invitaciones/acceso.js). Three roles:
 *  - Jefe de obra (an admin changes it);
 *  - Cliente principal: the only one who approves, asks for changes and
 *    comments — always exactly one;
 *  - Clientes (solo lectura): see the obra and decide nothing.
 * The jefe of the obra or an admin changes who is the principal (the previous
 * one stays as read-only), withdraws a read-only access and creates links to
 * share the obra («Compartir»): whoever opens one creates an account (or logs
 * in) and follows the obra as read-only. Team only, so Spanish only; readOnly
 * is «Ver como». */
const ROLES = { principal: 'Cliente principal', lectura: 'Cliente (solo lectura)' };
const STATE = {
  pendiente_registro: { label: 'Pendiente de registro', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-time-line', title: 'Aún no ha entrado en Ledens' },
  invitacion: { label: 'Invitación enviada', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-mail-send-line', title: 'Todavía no ha aceptado la invitación' },
  sin_verificar: { label: 'Email sin confirmar', bg: '#FBE0EA', fg: '#B84371', icon: 'ri-error-warning-line', title: 'No verá la obra hasta que confirme su email (Google, Microsoft o el enlace para crear su contraseña)' },
};
const VIA = { enlace: 'Entró con un enlace para compartir', invitacion: 'Invitado por email', equipo: 'Añadido por el equipo' };
const label = (m) => m.name || m.email;

// Every obra of the project (each root presupuesto), one card each.
export default function UsuariosProyecto({ rows, readOnly, toast, onOpenClientes, onChanged }) {
  const obras = rows.filter((r) => !r.parent);
  if (!obras.length) return null;
  return (
    <>
      <h3 className="obr-h3">{obras.length > 1 ? `Usuarios con acceso · ${obras.length} obras` : 'Usuarios con acceso'}</h3>
      {obras.map((o) => <AccesoObra key={o.id} obra={o} titled={obras.length > 1} readOnly={readOnly} toast={toast} onChanged={onChanged}
        onOpenClientes={onOpenClientes ? () => onOpenClientes(o) : null} />)}
    </>
  );
}

export function AccesoObra({ obra, titled, readOnly, toast, onOpenClientes, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'principal', candidate } | { kind: 'remove', member } | { kind: 'share' }
  const [jefeEdit, setJefeEdit] = useState(null); // { options, value } while an admin changes the jefe

  const load = useCallback(() => invitaciones.acceso(obra.id).then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), [obra.id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, message, { project } = {}) => {
    setBusy(true); setActionError('');
    try {
      const d = await fn();
      if (d?.miembros) setData(d); else await load();
      setDialog(null);
      toast?.(message);
      if (project) onChanged?.();
    } catch (e) { setActionError(e.message); }
    setBusy(false);
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <div className="fin-card fin-muted">Cargando quién tiene acceso…</div>;

  const principal = data.miembros.find((m) => m.rol === 'principal');
  const readers = data.miembros.filter((m) => m.rol === 'lectura');
  const activeLinks = data.enlaces.filter((e) => e.status === 'activo');
  const ended = data.enlaces.length - activeLinks.length;
  const canEdit = !readOnly && data.can.roles;
  const onRole = (m, rol) => {
    setActionError('');
    if (rol === m.rol) return;
    // Either way someone becomes the principal: choose (or confirm) who.
    setDialog({ kind: 'principal', candidate: rol === 'principal' ? m.userId : readers.length === 1 ? readers[0].userId : null });
  };
  const startJefe = () => {
    setActionError('');
    setJefeEdit({ options: null, value: data.jefe?.userId || '' });
    api.options().then((o) => setJefeEdit((s) => (s ? { ...s, options: o.jefes } : s)), (e) => { setJefeEdit(null); setActionError(e.message); });
  };

  return (
    <div className="fin-card obr-access">
      <div className="obr-access-head">
        <div>
          <h2>{titled ? `${obra.ref} · ${obra.title}` : 'Quién ve esta obra'}</h2>
          <p className="fin-muted fin-small">El cliente principal aprueba los presupuestos y ampliaciones, pide cambios y escribe en la conversación. Los clientes de solo lectura ven el presupuesto, el avance de cada partida, lo cobrado, las fotos y los documentos, sin decidir nada.</p>
        </div>
        {!readOnly ? (
          <div className="obr-actions">
            {onOpenClientes ? <button type="button" className="fin-btn is-small" onClick={onOpenClientes}><i className="ri-mail-add-line"></i>Invitar por email</button> : null}
            <button type="button" className="fin-btn is-primary is-small" onClick={() => { setActionError(''); setDialog({ kind: 'share' }); }}><i className="ri-share-forward-line"></i>Compartir</button>
          </div>
        ) : null}
      </div>
      {obra.phase === 'borrador' ? <p className="fin-warn"><i className="ri-draft-line"></i><span>El presupuesto está en borrador: los clientes no lo ven hasta que se envíe.</span></p> : null}

      <ul className="obr-access-list">
        <li className="obr-access-row">
          <span className="obr-access-who">
            {data.jefe ? <><strong>{data.jefe.name}</strong><span className="fin-muted fin-small">{data.jefe.email}</span></> : <span className="fin-muted">Sin jefe de obra asignado</span>}
          </span>
          <span className="obr-access-role">
            {jefeEdit ? (
              <>
                <select aria-label="Jefe de obra" value={jefeEdit.value} disabled={!jefeEdit.options || busy} onChange={(e) => setJefeEdit({ ...jefeEdit, value: e.target.value })}>
                  <option value="">{jefeEdit.options ? 'Sin asignar' : 'Cargando…'}</option>
                  {(jefeEdit.options || []).map((j) => <option key={j.id} value={j.id}>{`${j.name} · ${j.email}`}</option>)}
                </select>
                <button type="button" className="fin-btn is-small" disabled={busy} onClick={() => setJefeEdit(null)}>Cancelar</button>
                <button type="button" className="fin-btn is-primary is-small" disabled={busy || !jefeEdit.options}
                  onClick={() => act(async () => { await api.assignJefe(obra.id, { jefeId: jefeEdit.value || null }); setJefeEdit(null); }, 'Jefe de obra actualizado', { project: true })}>Guardar</button>
              </>
            ) : (
              <>
                <Badge bg="#E3E7F3" fg="#3E4D85" icon="ri-hard-hat-line">Jefe de obra</Badge>
                {canEdit && data.can.jefe ? <button type="button" className="fin-btn is-ghost is-small" onClick={startJefe}><i className="ri-user-settings-line"></i>{data.jefe ? 'Cambiar' : 'Asignar'}</button> : null}
              </>
            )}
          </span>
        </li>
        {data.miembros.map((m) => {
          const st = STATE[m.estado];
          return (
            <li key={m.userId} className="obr-access-row">
              <span className="obr-access-who">
                <strong>{label(m)}</strong>
                {m.name ? <span className="fin-muted fin-small">{m.email}</span> : null}
                {m.via ? <span className="fin-muted fin-small">{[VIA[m.via], m.since ? fecha(m.since) : null].filter(Boolean).join(' · ')}</span> : null}
              </span>
              <span className="obr-access-role">
                {st ? <span title={st.title}><Badge bg={st.bg} fg={st.fg} icon={st.icon}>{st.label}</Badge></span> : null}
                {canEdit ? (
                  <select aria-label={`Rol de ${label(m)}`} value={m.rol} disabled={busy} onChange={(e) => onRole(m, e.target.value)}>
                    {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                ) : <Badge bg={m.rol === 'principal' ? '#DEF3F0' : '#EDEDEA'} fg={m.rol === 'principal' ? '#2F6B63' : '#3A3A38'}>{ROLES[m.rol]}</Badge>}
                {canEdit && m.rol === 'lectura' ? (
                  <button type="button" className="fin-btn is-ghost is-small" aria-label={`Quitar acceso a ${label(m)}`} title="Quitar acceso" disabled={busy}
                    onClick={() => { setActionError(''); setDialog({ kind: 'remove', member: m }); }}><i className="ri-user-unfollow-line"></i></button>
                ) : null}
              </span>
            </li>
          );
        })}
        {data.invitaciones.map((i) => (
          <li key={`inv-${i.id}`} className="obr-access-row is-pending">
            <span className="obr-access-who">
              <strong>{i.name || i.email}</strong>
              {i.name ? <span className="fin-muted fin-small">{i.email}</span> : null}
              <span className="fin-muted fin-small">{`Invitado por email · el acceso empieza al aceptar · caduca el ${fecha(i.expiresAt)}`}</span>
            </span>
            <span className="obr-access-role">
              <Badge bg="#FBF1DE" fg="#7A4E0E" icon="ri-mail-send-line">Invitación pendiente</Badge>
              <Badge bg="#EDEDEA" fg="#3A3A38">{ROLES.lectura}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {actionError && !dialog ? <p className="fin-error-inline" role="alert">{actionError}</p> : null}

      {activeLinks.length || ended ? (
        <div className="obr-access-links">
          <h3 className="obr-h3">{`Enlaces para compartir · ${activeLinks.length} ${activeLinks.length === 1 ? 'activo' : 'activos'}`}</h3>
          {activeLinks.length ? (
            <ul className="obr-access-list">
              {activeLinks.map((e) => (
                <li key={e.id} className="obr-access-row">
                  <span className="obr-access-who">
                    <span><i className="ri-link" aria-hidden="true"></i>{` Creado ${e.createdBy ? `por ${e.createdBy} ` : ''}el ${fecha(e.createdAt)}`}</span>
                    <span className="fin-muted fin-small">{`Caduca el ${fecha(e.expiresAt)} · ${e.uses === 1 ? 'ha entrado 1 persona' : `han entrado ${e.uses} personas`}`}</span>
                  </span>
                  {!readOnly ? (
                    <span className="obr-access-role">
                      <button type="button" className="fin-btn is-small is-danger" disabled={busy} onClick={() => act(() => invitaciones.revokeLink(obra.id, e.id), 'Enlace revocado: ya no sirve para entrar')}><i className="ri-forbid-line"></i>Revocar</button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {ended ? <p className="fin-muted fin-small">{`${ended} ${ended === 1 ? 'enlace caducado o revocado' : 'enlaces caducados o revocados'}: ya no sirven para entrar, pero quien entró con ellos conserva el acceso hasta que se lo quites.`}</p> : null}
        </div>
      ) : null}
      <p className="fin-muted fin-small">Los administradores de Ledens ven todas las obras.</p>

      {dialog?.kind === 'principal' ? (
        <PrincipalDialog principal={principal} readers={readers} candidate={dialog.candidate} busy={busy} error={actionError} onClose={() => setDialog(null)}
          onConfirm={(userId) => act(() => invitaciones.setRole(obra.id, userId, 'principal'), 'Cliente principal cambiado', { project: true })} />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <Dialog title="Quitar acceso a la obra" onClose={() => setDialog(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setDialog(null)}>Cancelar</button>
          <button type="button" className="fin-btn is-danger" disabled={busy} onClick={() => act(() => invitaciones.removeAccess(obra.id, dialog.member.userId), `${label(dialog.member)} ya no tiene acceso a la obra`)}>Quitar acceso</button></>}>
          <p>{`${label(dialog.member)} dejará de ver ${obra.ref} · ${obra.title}. Su cuenta no cambia, y si tenía una invitación abierta a esta obra, se anula.`}</p>
          {activeLinks.length ? <p className="fin-warn"><i className="ri-link"></i><span>Hay enlaces para compartir activos: con uno de ellos podría volver a entrar. Revócalos si hace falta.</span></p> : null}
          {actionError ? <span className="fin-error-inline" role="alert">{actionError}</span> : null}
        </Dialog>
      ) : null}
      {dialog?.kind === 'share' ? (
        <ShareDialog obra={obra} days={data.linkDays} defaultDays={data.defaultLinkDays} onClose={() => { setDialog(null); load(); }} />
      ) : null}
    </div>
  );
}

// Who becomes the cliente principal; the current one stays as read-only.
function PrincipalDialog({ principal, readers, candidate, busy, error, onClose, onConfirm }) {
  const [value, setValue] = useState(candidate || '');
  const chosen = readers.find((r) => r.userId === value);
  return (
    <Dialog title="Cambiar el cliente principal" onClose={onClose} actions={<>
      <button type="button" className="fin-btn" onClick={onClose}>Cancelar</button>
      {readers.length ? <button type="button" className="fin-btn is-primary" disabled={busy || !chosen} onClick={() => onConfirm(value)}>{busy ? 'Guardando…' : 'Hacer cliente principal'}</button> : null}</>}>
      {readers.length ? (
        <>
          <p>Solo puede haber un cliente principal: es quien aprueba los presupuestos y ampliaciones, pide cambios y escribe en la conversación. Los presupuestos que esperan respuesta pasan a esperar la suya.</p>
          {readers.length > 1 || !candidate ? (
            <label className="fin-field"><span>Nuevo cliente principal</span>
              <select value={value} onChange={(e) => setValue(e.target.value)} autoFocus>
                <option value="">Elige quién</option>
                {readers.map((r) => <option key={r.userId} value={r.userId}>{r.name ? `${r.name} · ${r.email}` : r.email}</option>)}
              </select>
            </label>
          ) : null}
          {chosen ? <p><strong>{label(chosen)}</strong>{' pasará a ser el cliente principal'}{principal ? <>{' y '}<strong>{label(principal)}</strong>{' pasará a solo lectura.'}</> : '.'}</p> : null}
        </>
      ) : <p>{`Para cambiar el cliente principal, antes tiene que tener acceso a la obra la persona que lo será: compártela o invítala por email. ${principal ? `${label(principal)} seguirá siendo el principal hasta entonces.` : ''}`}</p>}
      {error ? <span className="fin-error-inline" role="alert">{error}</span> : null}
    </Dialog>
  );
}

// «Compartir»: a new link, shown once (only its hash is kept), to copy or send.
function ShareDialog({ obra, days, defaultDays, onClose }) {
  const [dias, setDias] = useState(defaultDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState(null); // { url, enlace }
  const [copied, setCopied] = useState(false);
  const input = useRef(null);
  const create = async () => {
    setBusy(true); setError('');
    try { setLink(await invitaciones.createLink(obra.id, dias)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); } catch {
      input.current?.select();
      try { document.execCommand('copy'); } catch { /* the person copies it by hand */ }
    }
    setCopied(true);
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = () => navigator.share({ title: obra.title, text: `Sigue la obra «${obra.title}» en Ledens`, url: link.url }).catch(() => {});
  return (
    <Dialog title="Compartir la obra" onClose={onClose} actions={link
      ? <button type="button" className="fin-btn is-primary" onClick={onClose}>Hecho</button>
      : <><button type="button" className="fin-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="fin-btn is-primary" disabled={busy} onClick={create}><i className="ri-link"></i>{busy ? 'Creando…' : 'Crear enlace'}</button></>}>
      {!link ? (
        <>
          <p>{`Quien abra el enlace podrá crear su cuenta en Ledens (o entrar con la suya, también con Google o Microsoft) y seguirá ${obra.ref} · ${obra.title} como cliente de solo lectura: verá el presupuesto, el avance de cada partida, lo cobrado, las fotos y los documentos, sin aprobar ni comentar.`}</p>
          <p className="fin-muted fin-small">Cualquiera que tenga el enlace puede usarlo: envíalo solo a quien deba ver la obra. Puedes revocarlo cuando quieras y quitar el acceso a cada persona desde esta lista.</p>
          <label className="fin-field"><span>El enlace caduca en</span>
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              {days.map((d) => <option key={d} value={d}>{`${d} días`}</option>)}
            </select>
          </label>
        </>
      ) : (
        <>
          <p>{`Enlace listo. Caduca el ${fecha(link.enlace.expiresAt)}.`}</p>
          <div className="obr-share-url">
            <input ref={input} readOnly value={link.url} aria-label="Enlace para compartir" onFocus={(e) => e.target.select()} />
            <button type="button" className="fin-btn is-primary" onClick={copy}><i className={copied ? 'ri-check-line' : 'ri-file-copy-line'}></i>{copied ? 'Copiado' : 'Copiar'}</button>
            {canShare ? <button type="button" className="fin-btn" onClick={share}><i className="ri-share-line"></i>Enviar…</button> : null}
          </div>
          <p className="fin-warn"><i className="ri-lock-line"></i><span>Por seguridad, el enlace solo se muestra ahora. Si lo pierdes, crea otro y revoca este.</span></p>
        </>
      )}
      {error ? <span className="fin-error-inline" role="alert">{error}</span> : null}
    </Dialog>
  );
}
