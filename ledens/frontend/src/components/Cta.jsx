import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const TXT = {
  es: {
    title: <>¿Empezamos tu reforma <em>esta semana?</em></>,
    body: 'Cuéntanos tu proyecto en 2 minutos. Mañana tienes presupuesto cerrado y pasado tenemos equipo en tu casa. Sin compromiso, sin sorpresas.',
    wa: 'Escríbenos por WhatsApp', call: 'Llámanos', callTail: ' al 655 638 219',
    note: 'Respuesta en menos de 1h · Visita y presupuesto gratis · Trabajamos en toda Málaga',
  },
  en: {
    title: <>Shall we start your renovation <em>this week?</em></>,
    body: 'Tell us about your project in 2 minutes. Tomorrow you’ll have a fixed-price quote and the day after, a team at your home. No commitment, no surprises.',
    wa: 'Message us on WhatsApp', call: 'Call us', callTail: ' on +34 655 638 219',
    note: 'Reply in under 1h · Free visit and quote · We work all over Málaga',
  },
};

export default function Cta({ onOpenLead }) {
  const t = useT(TXT);
  return (
    <section className="cta-band">
      <div className="cta-inner">
        <h2>{t.title}</h2>
        <p>{t.body}</p>
        <div className="cta-row">
          <button className="btn btn-lg btn-pink" onClick={onOpenLead}>
            <i className="ri-whatsapp-fill"></i> {t.wa}
          </button>
          <a href="tel:+34655638219" className="btn btn-lg btn-outline-light">
            <i className="ri-phone-line"></i> {t.call}<span className="long-label">{t.callTail}</span>
          </a>
        </div>
        <div className="cta-note">{t.note}</div>
      </div>
    </section>
  );
}
