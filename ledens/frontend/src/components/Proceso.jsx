import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const TXT = {
  es: {
    eyebrow: 'CÓMO FUNCIONA',
    title: <>De "quiero reformar" a <em>"alguien ya está trabajando"</em><br />en menos de 48 horas.</>,
    sub: 'Cuatro pasos, ningún intermediario, cero sorpresas. Tú decides cómo quieres tu espacio; nosotros hacemos el resto.',
    steps: [
      ['Hora 0 · HOY', 'Cuéntanos tu proyecto',
        'Por WhatsApp, por teléfono o desde este formulario. Te escuchamos, te decimos si podemos ayudarte y agendamos visita. Sin compromiso.'],
      ['En 24 horas', 'Visita técnica y presupuesto cerrado',
        'Vamos a ver el espacio, medimos, diseñamos contigo y te entregamos un presupuesto cerrado. Lo que firmamos es lo que pagas.'],
      ['En 48 horas', 'Equipo trabajando en tu casa',
        'En cuanto firmas, el equipo está en tu reforma. Un único jefe de obra de principio a fin y fotos semanales del avance.'],
      ['Entrega', 'Tu espacio, transformado',
        'En la fecha acordada. Sin sustos en la factura final, sin perseguir a nadie, con garantía de 2 años sobre toda la obra.'],
    ],
    card: [
      ['Respondemos en menos de 1h', 'Lunes a sábado · 9:00 – 20:00'],
      ['Trabajamos en toda Málaga', 'Capital, Costa del Sol y Axarquía'],
      ['Garantía de 2 años', 'Sobre materiales y mano de obra'],
    ],
    ctaSm: 'del "quiero reformar" a la primera herramienta',
  },
  en: {
    eyebrow: 'HOW IT WORKS',
    title: <>From "I want to renovate" to <em>"someone’s already working"</em><br />in under 48 hours.</>,
    sub: 'Four steps, no middlemen, zero surprises. You decide how you want your space; we do the rest.',
    steps: [
      ['Hour 0 · TODAY', 'Tell us about your project',
        'By WhatsApp, by phone or through this form. We listen, tell you whether we can help and book a visit. No commitment.'],
      ['Within 24 hours', 'Technical visit and fixed-price quote',
        'We come to see the space, take measurements, design it with you and give you a fixed-price quote. What we sign is what you pay.'],
      ['Within 48 hours', 'A team working at your home',
        'As soon as you sign, the team is on your renovation. A single site manager from start to finish and weekly progress photos.'],
      ['Handover', 'Your space, transformed',
        'On the agreed date. No nasty surprises on the final invoice, no chasing anyone, with a 2-year guarantee on all the work.'],
    ],
    card: [
      ['We reply in under 1h', 'Monday to Saturday · 9:00 – 20:00'],
      ['We work all over Málaga', 'The city, Costa del Sol and Axarquía'],
      ['2-year guarantee', 'On materials and labour'],
    ],
    ctaSm: 'from "I want to renovate" to the first tool',
  },
};

const CARD_ICONS = ['ri-whatsapp-line', 'ri-map-pin-line', 'ri-shield-check-line'];

export default function Proceso() {
  const t = useT(TXT);
  return (
    <section className="band proc-band" id="proceso">
      <div className="band-inner">
        <div className="eyebrow-row">{t.eyebrow}</div>
        <h2 className="section-title">{t.title}</h2>
        <p className="section-sub">{t.sub}</p>

        <div className="proc-grid">
          <div className="steps">
            {t.steps.map(([tag, title, body], i) => (
              <div key={i} className="step">
                <div className={`step-dot d${i + 1}`}>{i + 1}</div>
                <div className="step-body">
                  <div className="tag">{tag}</div>
                  <h4>{title}</h4>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>

          <aside className="proc-card">
            {t.card.map(([title, sub], i) => (
              <div key={i} className="proc-card-row">
                <i className={CARD_ICONS[i]}></i>
                <div>
                  <div className="t">{title}</div>
                  <div className="s">{sub}</div>
                </div>
              </div>
            ))}
            <div className="proc-card-cta">
              <div>
                <div className="big">24h → 48h</div>
                <div className="sm">{t.ctaSm}</div>
              </div>
              <i className="ri-arrow-right-line" style={{ fontSize: 28 }}></i>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
