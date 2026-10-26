import React, { useState } from 'react';
import { useT } from '../i18n/I18nContext.jsx';

import imgTilos19 from '../images/Tilos 57-19.webp';
import imgTilos04 from '../images/Tilos 57-04.webp';
import imgTilos23 from '../images/Tilos 57-23.webp';
import img1492    from '../images/IMG_1492.webp';
import img1478    from '../images/IMG_1478.webp';

// r = room key (see TXT.rooms); l = place · size
const CELLS = [
  { cat: 'cocinas', tall: true,  img: imgTilos19, r: 'cocina',  l: 'Tilos 57 · 24 m²' },
  { cat: 'banos',   tall: false, img: imgTilos04, r: 'bano',    l: 'Tilos 57 · 9 m²' },
  { cat: 'salones', tall: false, img: img1478,    r: 'terraza', l: 'Málaga Centro · 22 m²' },
  { cat: 'cocinas', tall: false, img: img1492,    r: 'cocina',  l: 'Málaga Centro · 14 m²' },
  { cat: 'salones', tall: false, img: imgTilos23, r: 'terraza', l: 'Tilos 57 · 18 m²' },
];

const TABS = ['todos', 'cocinas', 'banos', 'salones'];

const TXT = {
  es: {
    eyebrow: 'PROYECTOS REALES · MÁLAGA',
    title: <>Cocinas, baños y salones <em>hechos para vivirse.</em></>,
    sub: 'Minimalistas, cálidos, mediterráneos. Reformas que duran y que respiran luz — todas entregadas en plazo y en presupuesto.',
    tabs: { todos: 'Todos', cocinas: 'Cocinas', banos: 'Baños', salones: 'Salones' },
    rooms: { cocina: 'Cocina', bano: 'Baño', terraza: 'Terraza' },
  },
  en: {
    eyebrow: 'REAL PROJECTS · MÁLAGA',
    title: <>Kitchens, bathrooms and living rooms <em>made to be lived in.</em></>,
    sub: 'Minimalist, warm, Mediterranean. Renovations that last and are full of light — all delivered on time and on budget.',
    tabs: { todos: 'All', cocinas: 'Kitchens', banos: 'Bathrooms', salones: 'Living rooms' },
    rooms: { cocina: 'Kitchen', bano: 'Bathroom', terraza: 'Terrace' },
  },
};

export default function Galeria() {
  const [filter, setFilter] = useState('todos');
  const t = useT(TXT);

  return (
    <section className="band gallery-band" id="galeria">
      <div className="band-inner">
        <div className="eyebrow-row">{t.eyebrow}</div>
        <h2 className="section-title">{t.title}</h2>
        <p className="section-sub">{t.sub}</p>

        <div className="gallery-tabs" role="tablist">
          {TABS.map(k => (
            <button
              key={k}
              className={filter === k ? 'active' : ''}
              onClick={() => setFilter(k)}
            >{t.tabs[k]}</button>
          ))}
        </div>

        <div className="gallery-grid">
          {CELLS.map((c, i) => {
            const visible = filter === 'todos' || c.cat === filter;
            return (
              <div
                key={i}
                className={`cell${c.tall ? ' tall' : ''}`}
                style={{
                  backgroundImage: `url('${c.img}')`,
                  display: visible ? '' : 'none',
                }}
              >
                <div className="cell-caption">
                  <div className="r">{t.rooms[c.r]}</div>
                  <div className="l">{c.l}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
