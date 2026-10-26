import React from 'react';
import { useT } from '../i18n/I18nContext.jsx';

const TXT = {
  es: [
    { num: <em>24h</em>, label: <>Presupuesto cerrado<br />desde tu primera llamada</> },
    { num: <em>48h</em>, label: <>Equipo trabajando<br />en tu reforma</> },
    { num: '0€',         label: <>Extras no pactados<br />en ningún proyecto</> },
    { num: '1',          label: <>Interlocutor único<br />de principio a fin</> },
  ],
  en: [
    { num: <em>24h</em>, label: <>Fixed-price quote<br />from your first call</> },
    { num: <em>48h</em>, label: <>Team working<br />on your renovation</> },
    { num: '€0',         label: <>Unagreed extras<br />on any project</> },
    { num: '1',          label: <>Single point of contact<br />from start to finish</> },
  ],
};

export default function PromiseStrip() {
  const items = useT(TXT);
  return (
    <div className="promise">
      <div className="promise-inner">
        {items.map((it, i) => (
          <div key={i} className="promise-item">
            <div>
              <div className="promise-num">{it.num}</div>
              <div className="promise-label">{it.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
