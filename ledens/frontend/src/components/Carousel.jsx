import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/I18nContext.jsx';

import imgTilos19 from '../images/Tilos 57-19.webp';
import imgTilos05 from '../images/Tilos 57-05.webp';
import imgTilos02 from '../images/Tilos 57-02.webp';
import imgTilos17 from '../images/Tilos 57-17.webp';
import img1478    from '../images/IMG_1478.webp';
import img1641    from '../images/IMG_1641.webp';

// Tilos 57-19 is the hero image — it goes first (idx = 0).
const SLIDES = [
  { img: imgTilos19, size: '24 m²' },
  { img: imgTilos05, size: '9 m²' },
  { img: img1478,    size: '22 m²' },
  { img: imgTilos02, size: '7 m²' },
  { img: imgTilos17, size: '22 m²' },
  { img: img1641,    size: '14 m²' },
];

// One [room, location, meta[]] per slide, in SLIDES order.
const TXT = {
  es: {
    aria: 'Galería de reformas Ledens', prev: 'Anterior', next: 'Siguiente', goTo: (n) => `Ir a slide ${n}`,
    slides: [
      ['Cocina', 'Cocina con isla · Tilos 57', ['8 semanas', 'Llave en mano']],
      ['Baño', 'Baño doble · Tilos 57', ['3 semanas', 'Ducha de obra']],
      ['Terraza', 'Terraza · Málaga Centro', ['5 semanas', 'Suelo de roble']],
      ['Baño', 'Baño principal · Tilos 57', ['3 semanas', 'Microcemento']],
      ['Cocina', 'Cocina con isla · Tilos 57', ['6 semanas', 'Mármol Calacatta']],
      ['Dormitorio', 'Dormitorio principal · Málaga Centro', ['4 semanas', 'Tarima de roble']],
    ],
  },
  en: {
    aria: 'Ledens renovation gallery', prev: 'Previous', next: 'Next', goTo: (n) => `Go to slide ${n}`,
    slides: [
      ['Kitchen', 'Kitchen with island · Tilos 57', ['8 weeks', 'Turnkey']],
      ['Bathroom', 'Double bathroom · Tilos 57', ['3 weeks', 'Walk-in shower']],
      ['Terrace', 'Terrace · Málaga Centro', ['5 weeks', 'Oak flooring']],
      ['Bathroom', 'Main bathroom · Tilos 57', ['3 weeks', 'Microcement']],
      ['Kitchen', 'Kitchen with island · Tilos 57', ['6 weeks', 'Calacatta marble']],
      ['Bedroom', 'Main bedroom · Málaga Centro', ['4 weeks', 'Oak floorboards']],
    ],
  },
};

export default function Carousel() {
  const t = useT(TXT);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);
  const total = SLIDES.length;

  const restart = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setIdx(i => (i + 1) % total), 5000);
  };

  useEffect(() => {
    restart();
    return () => timerRef.current && clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (i) => { setIdx((i + total) % total); restart(); };
  const next = () => go(idx + 1);
  const prev = () => go(idx - 1);

  const onEnter = () => timerRef.current && clearInterval(timerRef.current);
  const onLeave = () => restart();

  return (
    <div
      className="carousel"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-label={t.aria}
    >
      <div className="carousel-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {SLIDES.map((s, i) => {
          const [room, loc, meta] = t.slides[i];
          return (
            <div key={i} className="slide" style={{ backgroundImage: `url('${s.img}')` }}>
              <div className="slide-caption">
                <div>
                  <div className="room">{room}</div>
                  <div className="loc">{loc} <span>· {s.size}</span></div>
                </div>
                <div className="slide-meta">
                  {meta.map((m, j) => <span key={j}>{m}</span>)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button className="carousel-ctrl carousel-prev" aria-label={t.prev} onClick={prev}>
        <i className="ri-arrow-left-s-line"></i>
      </button>
      <button className="carousel-ctrl carousel-next" aria-label={t.next} onClick={next}>
        <i className="ri-arrow-right-s-line"></i>
      </button>
      <div className="carousel-dots">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            className={i === idx ? 'active' : ''}
            aria-label={t.goTo(i + 1)}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </div>
  );
}
