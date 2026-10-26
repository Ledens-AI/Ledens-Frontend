import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const AUTHORS = [
  { av: '',  initials: 'MC', name: 'María Contreras' },
  { av: 'p', initials: 'JM', name: 'Javier Martín' },
  { av: 't', initials: 'LR', name: 'Laura Ruiz' },
];

const TXT = {
  es: {
    eyebrow: 'LO DICEN ELLOS',
    title: <>La opinión que <em>más importa.</em></>,
    sub: 'Clientes reales, reformas reales. Sin actores, sin stock, sin "hasta aquí estaba contento".',
    testis: [
      ['"Llamé un martes, el jueves ya tenía al equipo en casa. El presupuesto no se movió ni un euro y entregaron una semana antes de lo prometido."',
        'Cocina · La Malagueta · 2026'],
      ['"Después de dos reformas horribles, ya no me fiaba de nadie. Con Ledens por primera vez sentí que había alguien al mando. Un solo interlocutor, todo muy claro."',
        'Reforma integral · Pedregalejo · 2025'],
      ['"El detalle que más agradecí: las fotos semanales. Trabajo fuera de Málaga y podía ver cómo iba mi baño sin tener que llamar a nadie. Impecable."',
        'Baño en suite · Teatinos · 2026'],
    ],
  },
  en: {
    eyebrow: 'IN THEIR WORDS',
    title: <>The opinion that <em>matters most.</em></>,
    sub: 'Real clients, real renovations. No actors, no stock photos, no "I was happy up to this point".',
    testis: [
      ['"I called on a Tuesday and by Thursday the team was at my home. The quote didn’t move a single euro and they finished a week earlier than promised."',
        'Kitchen · La Malagueta · 2026'],
      ['"After two horrible renovations I didn’t trust anyone any more. With Ledens, for the first time, I felt someone was in charge. One point of contact, everything very clear."',
        'Full renovation · Pedregalejo · 2025'],
      ['"The thing I appreciated most: the weekly photos. I work outside Málaga and could see how my bathroom was going without calling anyone. Flawless."',
        'En-suite bathroom · Teatinos · 2026'],
    ],
  },
};

export default function Testimonios() {
  const t = useT(TXT);
  return (
    <section className="band testis-band" id="testimonios">
      <div className="band-inner">
        <div className="eyebrow-row">{t.eyebrow}</div>
        <h2 className="section-title">{t.title}</h2>
        <p className="section-sub">{t.sub}</p>
        <div className="testis">
          {AUTHORS.map((a, i) => (
            <div key={i} className="testi">
              <div className="stars">★ ★ ★ ★ ★</div>
              <blockquote>{t.testis[i][0]}</blockquote>
              <div className="testi-author">
                <div className={`testi-av ${a.av}`}>{a.initials}</div>
                <div>
                  <div className="testi-name">{a.name}</div>
                  <div className="testi-meta">{t.testis[i][1]}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
