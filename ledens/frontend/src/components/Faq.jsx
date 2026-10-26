import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const TXT = {
  es: {
    eyebrow: 'PREGUNTAS FRECUENTES',
    title: <>Lo que <em>siempre</em> nos preguntan.</>,
    sub: 'Si no encuentras tu respuesta aquí, escríbenos por WhatsApp. Respondemos en menos de una hora.',
    faqs: [
      ['¿De verdad tengo un presupuesto cerrado en 24 horas?',
        'Sí. Si nos escribes hoy antes de las 18h, mañana tienes la visita y el presupuesto cerrado en tu email. Lo que firmas es lo que pagas — sin letra pequeña.'],
      ['¿Qué entra exactamente en "trabajando en 48h"?',
        'Desde el momento en que firmas el presupuesto, en 48 horas tenemos al equipo en tu casa empezando la obra: retirada, protección de suelos, primeros derribos y preparación de instalaciones.'],
      ['¿Qué pasa si aparecen imprevistos durante la obra?',
        'En Ledens los imprevistos los asumimos nosotros. Visitamos el espacio, hacemos catas si hace falta y cerramos un precio con holgura técnica. Si aparece algo nuevo, lo resolvemos sin tocar tu factura.'],
      ['¿En qué zonas de Málaga trabajáis?',
        'Málaga capital, Costa del Sol (Marbella, Fuengirola, Benalmádena, Torremolinos) y toda la Axarquía. Si tu piso está en otra zona, pregúntanos: normalmente podemos llegar.'],
      ['¿Qué garantía tengo sobre la reforma?',
        '2 años de garantía por escrito sobre materiales y mano de obra. Y 1 interlocutor único durante toda la vida de la obra — no nos desaparecemos al entregar las llaves.'],
      ['¿Cuánto cuesta reformar una cocina o un baño en Málaga?',
        'Una cocina integral parte de 9.500€ y un baño desde 4.800€, siempre con presupuesto cerrado. La cifra exacta depende de superficie, calidades e instalaciones — por eso la visita es gratis.'],
    ],
  },
  en: {
    eyebrow: 'FREQUENTLY ASKED QUESTIONS',
    title: <>What people <em>always</em> ask us.</>,
    sub: 'If you can’t find your answer here, message us on WhatsApp. We reply in under an hour.',
    faqs: [
      ['Do I really get a fixed-price quote in 24 hours?',
        'Yes. If you write to us today before 6 pm, tomorrow you’ll have the visit and the fixed-price quote in your inbox. What you sign is what you pay — no small print.'],
      ['What exactly does "working in 48h" include?',
        'From the moment you sign the quote, within 48 hours our team is at your home starting the works: clearing out, protecting floors, first demolition and preparing the installations.'],
      ['What happens if something unexpected comes up during the works?',
        'At Ledens, we absorb the unexpected. We visit the space, run test openings if needed and fix a price with technical margin. If something new comes up, we solve it without touching your invoice.'],
      ['Which areas of Málaga do you cover?',
        'Málaga city, the Costa del Sol (Marbella, Fuengirola, Benalmádena, Torremolinos) and the whole Axarquía. If your home is elsewhere, just ask: we can usually get there.'],
      ['What guarantee do I get on the renovation?',
        'A 2-year written guarantee on materials and labour. And a single point of contact for the whole life of the works — we don’t disappear when we hand over the keys.'],
      ['How much does it cost to renovate a kitchen or bathroom in Málaga?',
        'A full kitchen starts at €9,500 and a bathroom at €4,800, always with a fixed-price quote. The exact figure depends on size, finishes and installations — that’s why the visit is free.'],
    ],
  },
};

export default function Faq() {
  const t = useT(TXT);
  return (
    <section className="band faq-band" id="faq">
      <div className="band-inner">
        <div className="faq-grid">
          <div>
            <div className="eyebrow-row">{t.eyebrow}</div>
            <h2 className="section-title">{t.title}</h2>
            <p className="section-sub">{t.sub}</p>
          </div>
          <div className="faq-list">
            {t.faqs.map(([q, a], i) => (
              <details key={i} className="q" open={i === 0 || undefined}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
