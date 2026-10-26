import React, { useState } from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const TXT = {
  es: {
    title: 'Pide tu presupuesto',
    intro: 'Te contactamos en menos de 1 hora (lunes a sábado, 9:00 – 20:00).',
    success: '¡Gracias! Tu solicitud ha sido recibida. Te llamamos pronto.',
    close: 'Cerrar', name: 'Nombre', phone: 'Teléfono', email: 'Email',
    message: 'Cuéntanos tu reforma', placeholder: 'Cocina, baño, salón… Superficie aproximada y zona.',
    cancel: 'Cancelar', send: 'Enviar', sending: 'Enviando…',
    error: 'No se pudo enviar el mensaje',
  },
  en: {
    title: 'Get your quote',
    intro: 'We’ll get in touch in under 1 hour (Monday to Saturday, 9:00 – 20:00).',
    success: 'Thank you! We’ve received your request. We’ll call you soon.',
    close: 'Close', name: 'Name', phone: 'Phone', email: 'Email',
    message: 'Tell us about your renovation', placeholder: 'Kitchen, bathroom, living room… Approximate size and area.',
    cancel: 'Cancel', send: 'Send', sending: 'Sending…',
    error: 'The message could not be sent. Please try again or call us.',
  },
};

export default function LeadModal({ onClose }) {
  const t = useT(TXT);
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' });
  const [status, setStatus] = useState('idle'); // idle | sending | success | error

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('contact failed');
      setStatus('success');
    } catch {
      // The backend's own error text is in Spanish, so show ours in the
      // visitor's language instead.
      setStatus('error');
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t.title}</h3>
        <p>{t.intro}</p>
        {status === 'success' ? (
          <>
            <div className="modal-success">{t.success}</div>
            <div className="modal-actions">
              <button className="btn btn-md btn-blue" onClick={onClose}>{t.close}</button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            {status === 'error' && <div className="modal-error">{t.error}</div>}
            <label htmlFor="lm-name">{t.name}</label>
            <input id="lm-name" name="name" required value={form.name} onChange={onChange} />
            <label htmlFor="lm-phone">{t.phone}</label>
            <input id="lm-phone" name="phone" type="tel" required value={form.phone} onChange={onChange} />
            <label htmlFor="lm-email">{t.email}</label>
            <input id="lm-email" name="email" type="email" value={form.email} onChange={onChange} />
            <label htmlFor="lm-msg">{t.message}</label>
            <textarea id="lm-msg" name="message" value={form.message} onChange={onChange} placeholder={t.placeholder} />
            <div className="modal-actions">
              <button type="button" className="btn btn-md btn-outline" onClick={onClose}>{t.cancel}</button>
              <button type="submit" className="btn btn-md btn-pink" disabled={status === 'sending'}>
                {status === 'sending' ? t.sending : t.send}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
