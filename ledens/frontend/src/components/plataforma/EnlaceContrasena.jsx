import React, { useState } from 'react';

/* User page (admin): email the user a link to create — or reset — their
 * password (POST /api/admin/users/:id/enlace-contrasena). Useful for accounts
 * with no password yet: invited clients, people who only used Google or
 * Microsoft, accounts created from the console. Admin panel: Spanish only. */
export default function EnlaceContrasena({ user, onDone }) {
  const [lang, setLang] = useState('es');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  if (!user?.id) return null;
  // A password nobody proved (unverified email) doesn't count: same wording as the email.
  const reset = user.has_password && user.email_verified;
  const send = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/enlace-contrasena`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) onDone?.(d.error || 'No se pudo enviar el enlace.');
      else { setSent(true); onDone?.(`Enlace enviado a ${d.email}. Caduca en 3 días.`); }
    } catch { onDone?.('Error de conexión. Inténtalo de nuevo.'); }
    setBusy(false);
  };
  return (
    <div style={{ background: '#fff', border: '1px solid #EDEDEA', borderRadius: '16px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h2 style={{ fontSize: '17px', fontWeight: '700' }}>{reset ? 'Restablecer contraseña' : 'Crear contraseña'}</h2>
      <span style={{ fontSize: '14px', color: '#6B6B68' }}>
        {reset
          ? 'Envía al usuario un enlace por email para elegir una contraseña nueva. La actual deja de valer cuando la cambie.'
          : 'Esta cuenta no tiene contraseña. Envía al usuario un enlace por email para que la cree; así podrá entrar con su email aunque no use Google ni Microsoft.'}
      </span>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Idioma del correo"
          style={{ border: '1px solid #DCDCD8', borderRadius: '8px', padding: '8px 10px', fontSize: '14px', background: '#fff' }}>
          <option value="es">Correo en español</option>
          <option value="en">Correo en inglés</option>
        </select>
        <button type="button" onClick={send} disabled={busy}
          style={{ border: 'none', background: busy ? '#D9D9D9' : '#5567AE', color: busy ? '#6B6B68' : '#fff', borderRadius: '8px', padding: '9px 16px', fontWeight: '700', fontSize: '14px', cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Enviando…' : sent ? 'Enviar otro enlace' : 'Enviar enlace por email'}
        </button>
      </div>
    </div>
  );
}
