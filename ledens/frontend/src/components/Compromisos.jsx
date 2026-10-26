import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const PILARES = [
  { color: 'blue', icon: 'ri-file-list-3-line', tagIcon: 'ri-check-line' },
  { color: 'pink', icon: 'ri-tools-line',       tagIcon: 'ri-flashlight-line' },
  { color: 'teal', icon: 'ri-smartphone-line',  tagIcon: 'ri-eye-line' },
];

const TXT = {
  es: {
    eyebrow: 'NUESTROS COMPROMISOS',
    title: <>Tres promesas que <em>firmamos contigo</em><br />antes de tocar una sola pared.</>,
    sub: 'Sin letra pequeña, sin "esto no estaba incluido". Si lo firmamos, lo cumplimos — o corre de nuestra cuenta.',
    items: [
      ['Presupuesto cerrado en 24h', 'El precio que acordamos es el que pagas. Lo cerramos en menos de 24 horas desde tu primera llamada y lo firmamos antes de empezar.', 'Por contrato'],
      ['Alguien trabajando en 48h', 'En cuanto firmas, nuestro equipo empieza. Sin semanas de espera, sin "la próxima". 48 horas desde la firma hasta la primera herramienta.', 'Inicio garantizado'],
      ['Control en tiempo real', 'Fotos semanales de la obra, estado del proyecto y presupuesto actualizado. Sabes qué pasa en tu casa sin tener que llamar a nadie.', 'App Ledens'],
    ],
  },
  en: {
    eyebrow: 'OUR COMMITMENTS',
    title: <>Three promises we <em>sign with you</em><br />before touching a single wall.</>,
    sub: 'No small print, no "that wasn’t included". If we sign it, we deliver it — or it’s on us.',
    items: [
      ['Fixed-price quote in 24h', 'The price we agree is the price you pay. We fix it within 24 hours of your first call and sign it before we start.', 'By contract'],
      ['Someone working in 48h', 'As soon as you sign, our team starts. No weeks of waiting, no "next week". 48 hours from signature to the first tool.', 'Guaranteed start'],
      ['Real-time control', 'Weekly photos of the works, project status and an up-to-date budget. You know what’s happening at home without calling anyone.', 'Ledens app'],
    ],
  },
};

export default function Compromisos() {
  const t = useT(TXT);
  return (
    <section className="band pilares-band" id="compromisos">
      <div className="band-inner">
        <div className="eyebrow-row">{t.eyebrow}</div>
        <h2 className="section-title">{t.title}</h2>
        <p className="section-sub">{t.sub}</p>
        <div className="pilares">
          {PILARES.map((p, i) => {
            const [title, body, tag] = t.items[i];
            return (
              <article key={i} className="pilar">
                <div className={`pilar-ico ${p.color}`}><i className={p.icon}></i></div>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className={`pilar-tag ${p.color}`}><i className={p.tagIcon}></i> {tag}</span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
