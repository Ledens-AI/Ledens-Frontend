import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const EMOJIS = ['💸', '📅', '🤷', '⏳'];

const TXT = {
  es: {
    eyebrow: 'EL PROBLEMA',
    title: <>Lo que todos hemos vivido<br />con las <em>reformas.</em></>,
    sub: 'Estos son los 4 miedos que más escuchamos antes de contratar una reforma. Si te suenan, estás en el sitio correcto.',
    closingA: 'Si esto te suena, ', closingB: 'Ledens existe exactamente para resolverlo.',
    problems: [
      ['Presupuestos que se disparan', '"Me dijeron 20.000€ y acabé pagando 35.000€. Cada semana había un extra que no estaba previsto."'],
      ['Plazos que nadie cumple', '"Iban a ser 2 meses. Fueron 5. Estuve viviendo en casa de mis padres con mis hijos."'],
      ['Nadie se responsabiliza', '"El fontanero culpaba al albañil, el albañil al electricista. Y yo en medio llamando a todos sin resultado."'],
      ['Te dan largas para empezar', '"O te dicen que en 3 meses pueden hacerlo, o te mandan presupuesto y desaparecen. Imposible arrancar."'],
    ],
  },
  en: {
    eyebrow: 'THE PROBLEM',
    title: <>What we’ve all been through<br />with <em>renovations.</em></>,
    sub: 'These are the 4 fears we hear most before someone hires a renovation. If they sound familiar, you’re in the right place.',
    closingA: 'If this sounds familiar, ', closingB: 'Ledens exists precisely to fix it.',
    problems: [
      ['Quotes that skyrocket', '"They told me €20,000 and I ended up paying €35,000. Every week there was another extra nobody had planned for."'],
      ['Deadlines nobody meets', '"It was going to be 2 months. It took 5. I was living at my parents’ with my kids."'],
      ['Nobody takes responsibility', '"The plumber blamed the builder, the builder blamed the electrician. And I was stuck in the middle calling everyone, getting nowhere."'],
      ['Endless delays to get started', '"Either they say they can do it in 3 months, or they send a quote and vanish. Impossible to get going."'],
    ],
  },
};

export default function Problema() {
  const t = useT(TXT);
  return (
    <section className="band problema-band" id="problema">
      <div className="band-inner">
        <div className="eyebrow-row">{t.eyebrow}</div>
        <h2 className="section-title">{t.title}</h2>
        <p className="section-sub">{t.sub}</p>

        <div className="problema-grid">
          {t.problems.map(([title, quote], i) => (
            <article key={i} className="problema-card">
              <div className="problema-emoji" aria-hidden="true">{EMOJIS[i]}</div>
              <h3>{title}</h3>
              <blockquote>{quote}</blockquote>
              <div className="problema-num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </div>
            </article>
          ))}
        </div>

        <div className="problema-closing">
          {t.closingA}<strong>{t.closingB}</strong>
        </div>
      </div>
    </section>
  );
}
