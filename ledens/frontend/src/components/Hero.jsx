import React from 'react';
import Carousel from './Carousel.jsx';
import { useT } from '../i18n/I18nContext.jsx';

const TXT = {
  es: {
    eyebrow: 'Reformas en Málaga · Presupuesto cerrado',
    h1a: 'Tu última reforma fue ', h1b: 'un desastre.', h1c: 'La siguiente no tiene por qué serlo.',
    sub: 'En Ledens reformamos con presupuesto cerrado, plazos firmados y un único interlocutor de principio a fin. Cuéntanos tu proyecto hoy y mañana tenemos equipo en tu casa.',
    cta: 'Pide tu presupuesto', how: 'Cómo funciona',
    trust: ['Presupuesto cerrado', 'Plazos por contrato', 'Un único interlocutor'],
  },
  en: {
    eyebrow: 'Renovations in Málaga · Fixed-price quote',
    h1a: 'Your last renovation was ', h1b: 'a disaster.', h1c: 'The next one doesn’t have to be.',
    sub: 'At Ledens we renovate with a fixed-price quote, deadlines in writing and a single point of contact from start to finish. Tell us about your project today and we’ll have a team at your home tomorrow.',
    cta: 'Get your quote', how: 'How it works',
    trust: ['Fixed-price quote', 'Deadlines by contract', 'A single point of contact'],
  },
};

export default function Hero({ onOpenLead }) {
  const t = useT(TXT);
  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            <span className="dot"></span>{t.eyebrow}
          </span>
          <h1>
            {t.h1a}<em className="hl-pink">{t.h1b}</em><br />
            <span className="hl-teal">{t.h1c}</span>
          </h1>
          <p className="hero-sub">{t.sub}</p>
          <div className="hero-cta-row">
            <button className="btn btn-lg btn-pink" onClick={onOpenLead}>
              <i className="ri-whatsapp-fill"></i> {t.cta}
            </button>
            <a href="#proceso" className="btn btn-lg btn-outline-light">
              {t.how} <i className="ri-arrow-down-line"></i>
            </a>
          </div>
          <div className="hero-trust">
            <span className="hero-trust-item"><i className="ri-shield-check-line"></i> {t.trust[0]}</span>
            <span className="hero-trust-item"><i className="ri-calendar-check-line"></i> {t.trust[1]}</span>
            <span className="hero-trust-item"><i className="ri-user-star-line"></i> {t.trust[2]}</span>
          </div>
        </div>
        <Carousel />
      </div>
    </section>
  );
}
