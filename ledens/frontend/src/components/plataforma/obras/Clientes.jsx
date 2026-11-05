import React, { useCallback, useEffect, useState } from 'react';
import { invitaciones } from './api.js';
import { Badge, Dialog, Empty, ErrorBox } from '../finanzas/ui.jsx';
import { fecha, fechaHora } from '../finanzas/format.js';

/* «Clientes» of an obra (root presupuesto): the jefe de obra assigned or an
 * admin invites clients by email and chooses the cliente principal among those
 * who already see the obra. The cliente principal (titular) approves and comments;
 * whoever else is invited sees the obra without deciding on it. The email goes
 * out through the notification queue with a one-time link (/invitacion).
 * Team only, so Spanish only; readOnly is «Ver como». */
const STATUS = {
  pendiente: { label: 'Pendiente', bg: '#FBF1DE', fg: '#7A4E0E', icon: 'ri-time-line' },
  aceptada: { label: 'Aceptada', bg: '#DEF3F0', fg: '#2F6B63', icon: 'ri-checkbox-circle-line' },
  caducada: { label: 'Caducada', bg: '#EDEDEA', fg: '#3A3A38', icon: 'ri-hourglass-line' },
  revocada: { label: 'Revocada', bg: '#F8E1E1', fg: '#9E2F2F', icon: 'ri-close-circle-line' },
};

export default function Clientes({ obraId, readOnly, toast, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', name: '', lang: 'es' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [revoking, setRevoking] = useState(null);
  const [rowError, setRowError] = useState({});
  const [principal, setPrincipal] = useState('');
  const [principalError, setPrincipalError] = useState('');

  const load = useCallback(() => invitaciones.list(obraId).then((d) => { setData(d); setError(''); setPrincipal(d.obra.titular?.id || ''); }, (e) => setError(e.message)), [obraId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <div className="fin-loading fin-muted">Cargando clientes…</div>;

  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setFormError('');
    try {
      await invitaciones.invite(obraId, { email: form.email.trim(), name: form.name.trim() || undefined, lang: form.lang });
      toast?.(`Invitación enviada a ${form.email.trim()}`);
      setForm({ email: '', name: '', lang: form.lang });
      await load();
    } catch (err) { setFormError(err.message); }
    setBusy(false);
  };
  const row = async (i, fn, message) => {
    setBusy(true); setRowError((r) => ({ ...r, [i.id]: '' }));
    try { await fn(); toast?.(message); setRevoking(null); await load(); } catch (err) { setRowError((r) => ({ ...r, [i.id]: err.message })); setRevoking(null); }
    setBusy(false);
  };
  const { titular } = data.obra;
  const clientes = data.clientes || [];
  const savePrincipal = async () => {
    setBusy(true); setPrincipalError('');
    try {
      const d = await invitaciones.setTitular(obraId, principal);
      setData(d); setPrincipal(d.obra.titular?.id || '');
      toast?.(`Cliente principal: ${d.obra.titular?.name || d.obra.titular?.email}`);
      onChanged?.();
    } catch (err) { setPrincipalError(err.message); }
    setBusy(false);
  };

  return (
    <div className="fin-stack">
      <div className="fin-card">
        <div className="fin-card-head"><h2>Cliente principal</h2></div>
        <p className="obr-mb">{titular ? <><strong>{titular.name || titular.email}</strong>{titular.name && titular.name !== titular.email ? <span className="fin-muted">{` · ${titular.email}`}</span> : null}</> : '—'}</p>
        <p className="fin-muted fin-small obr-mb">El cliente principal aprueba los presupuestos (también las ampliaciones), pide cambios, los rechaza y escribe en la conversación. Los demás clientes de la obra la ven (presupuesto, avance, fotos y documentos) sin decidir sobre ella.</p>
        {readOnly ? null : (
          <div className="fin-filters">
            <label className="fin-field"><span>Cambiar cliente principal</span>
              <select value={principal} onChange={(e) => { setPrincipal(e.target.value); setPrincipalError(''); }} disabled={busy || clientes.length < 2}>
                {clientes.map((c) => <option key={c.id} value={c.id}>{`${c.name}${c.email && c.email !== c.name ? ` · ${c.email}` : ''}${c.principal ? ' (actual)' : ''}`}</option>)}
              </select>
            </label>
            <button type="button" className="fin-btn is-primary" disabled={busy || !principal || principal === titular?.id} onClick={savePrincipal}><i className="ri-user-star-line"></i>Hacer cliente principal</button>
          </div>
        )}
        {principalError ? <span className="fin-error-inline">{principalError}</span> : null}
        {!readOnly ? <p className="fin-muted fin-small">{clientes.length < 2 ? 'Para elegir a otra persona, invítala abajo: aparecerá aquí en cuanto tenga acceso a la obra.' : 'Puedes elegir a cualquier cliente con acceso a la obra; el anterior la sigue viendo. Si alguien invitado no aparece, saldrá aquí en cuanto acepte su invitación.'}</p> : null}
      </div>

      <div className="fin-card">
        <div className="fin-card-head"><h2>Invitar clientes</h2></div>
        {readOnly ? <p className="fin-warn"><i className="ri-eye-line"></i>Estás en «Ver como»: solo lectura.</p> : (
          <form className="fin-form" onSubmit={send}>
            <div className="fin-filters">
              <label className="fin-field"><span>Email</span>
                <input type="email" required maxLength={200} autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="cliente@ejemplo.com" />
              </label>
              <label className="fin-field"><span>Nombre (opcional)</span>
                <input maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="fin-field"><span>Idioma del correo</span>
                <select value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </label>
              <button type="submit" className="fin-btn is-primary" disabled={busy || !form.email.trim()}><i className="ri-mail-send-line"></i>{busy ? 'Enviando…' : 'Invitar'}</button>
            </div>
            {formError ? <span className="fin-error-inline">{formError}</span> : null}
            <p className="fin-muted fin-small">{`El cliente recibe un enlace personal que caduca a los ${data.ttlDays} días. Podrá entrar con Google o Microsoft con ese email, o crear una contraseña. Si ya tiene cuenta, se usa la suya.`}</p>
          </form>
        )}
      </div>

      <div className="fin-card is-flush">
        <div className="obr-chapter-head"><h2>Invitaciones</h2></div>
        {data.invitaciones.length ? (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead><tr><th>Cliente</th><th>Estado</th><th>Enviada</th><th>Caduca</th><th>Idioma</th>{readOnly ? null : <th></th>}</tr></thead>
              <tbody>
                {data.invitaciones.map((i) => {
                  const s = STATUS[i.status] || STATUS.pendiente;
                  return (
                    <tr key={i.id}>
                      <td><strong>{i.name || i.email}</strong>{i.name ? <div className="fin-muted fin-small">{i.email}</div> : null}{i.invitedBy ? <div className="fin-muted fin-small">{`Invitado por ${i.invitedBy}`}</div> : null}</td>
                      <td><Badge bg={s.bg} fg={s.fg} icon={s.icon}>{s.label}</Badge>
                        {i.status === 'aceptada' ? <div className="fin-muted fin-small">{fechaHora(i.acceptedAt)}</div> : i.status === 'revocada' ? <div className="fin-muted fin-small">{fechaHora(i.revokedAt)}</div> : null}</td>
                      <td className="fin-nowrap">{fechaHora(i.lastSentAt)}{i.sentCount > 1 ? <div className="fin-muted fin-small">{`${i.sentCount} envíos`}</div> : null}</td>
                      <td className="fin-nowrap">{i.status === 'pendiente' || i.status === 'caducada' ? fecha(i.expiresAt) : '—'}</td>
                      <td>{i.lang === 'en' ? 'EN' : 'ES'}</td>
                      {readOnly ? null : (
                        <td>
                          <div className="obr-actions">
                            {i.can.resend ? <button type="button" className="fin-btn is-small" disabled={busy} onClick={() => row(i, () => invitaciones.resend(obraId, i.id), `Invitación reenviada a ${i.email}`)}><i className="ri-restart-line"></i>Reenviar</button> : null}
                            {i.can.revoke ? <button type="button" className="fin-btn is-small is-danger" disabled={busy} onClick={() => setRevoking(i)}><i className="ri-forbid-line"></i>Revocar</button> : null}
                          </div>
                          {rowError[i.id] ? <span className="fin-error-inline">{rowError[i.id]}</span> : null}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="ri-user-add-line" title="Sin invitaciones" text="Invita al cliente para que siga la obra desde su área de cliente." />}
      </div>

      {revoking ? (
        <Dialog title="Revocar invitación" onClose={() => setRevoking(null)} actions={<>
          <button type="button" className="fin-btn" onClick={() => setRevoking(null)}>Cancelar</button>
          <button type="button" className="fin-btn is-danger" disabled={busy} onClick={() => row(revoking, () => invitaciones.revoke(obraId, revoking.id), 'Invitación revocada')}>Revocar</button></>}>
          <p>{`El enlace enviado a ${revoking.email} dejará de funcionar y se retirará el acceso a la obra que daba esta invitación. Su cuenta, si la tiene, no cambia.`}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
