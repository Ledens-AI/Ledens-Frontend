import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SERVICIOS_BY_SLUG, SERVICE_IMAGES } from '../data/servicios.js';
import { SERVICIOS_EN } from '../data/servicios.en.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import Footer from './Footer.jsx';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Render a title array: plain strings and {em:'...'} objects → React nodes */
function renderTitle(parts) {
  return parts.map((part, i) =>
    typeof part === 'string' ? part : <em key={i}>{part.em}</em>
  );
}

/** Lazy-load a service image from SERVICE_IMAGES and return the resolved URL */
function useServiceImage(key) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!key) return;
    const loader = SERVICE_IMAGES[key];
    if (loader) loader().then(m => setSrc(m.default)).catch(() => {});
  }, [key]);
  return src;
}

/** The Spanish service with its texts swapped for the English ones. */
function localized(svc, lang) {
  const en = lang === 'en' && svc && SERVICIOS_EN[svc.slug];
  if (!en) return svc;
  return {
    ...svc,
    name: en.name,
    hero: { ...svc.hero, ...en.hero },
    bullets: en.bullets,
    casos: svc.casos.map((c, i) => ({ ...c, ...en.casos[i] })),
    cta: en.cta,
  };
}

const TXT = {
  es: {
    notFound: 'Servicio no encontrado', backHome: '← Volver al inicio',
    home: 'Inicio', services: 'Servicios',
    quote: 'Pide tu presupuesto', seeCases: 'Ver casos reales',
    whatEyebrow: (n) => `QUÉ HACEMOS EN ${n.toUpperCase()}`,
    whatTitle: (n) => <>Todo lo que necesitas en <em>{n.toLowerCase()}</em>,<br />con un solo equipo.</>,
    whatSub: 'Nuestro equipo propio cubre desde la pequeña reparación hasta la reforma integral. Misma persona de inicio a fin, mismo presupuesto.',
    casesEyebrow: 'CASOS REALES · MÁLAGA',
    casesTitle: (n) => <>Trabajos de {n.toLowerCase()} <em>recientes.</em></>,
    casesSub: 'Selección de proyectos de los últimos meses. Todos entregados en plazo y en presupuesto cerrado.',
    howEyebrow: 'CÓMO TRABAJAMOS',
    howTitle: <>De tu llamada al técnico en casa, <em>en 48 horas.</em></>,
    steps: [
      ['Cuéntanos qué necesitas', 'Por WhatsApp, teléfono o email. Te respondemos en menos de 1 hora en horario laboral.'],
      ['Visita técnica gratis', 'Vamos a verlo, medimos y te explicamos opciones. Sin compromiso ni presión de venta.'],
      ['Presupuesto cerrado en 24h', 'Te lo enviamos firmado por escrito. Lo que firmas es lo que pagas, sin extras escondidos.'],
      ['Equipo trabajando en 48h', 'En cuanto firmas, técnico en tu casa con uniforme Ledens y materiales en mano.'],
    ],
    note: 'Respuesta en menos de 1h · Visita gratis · Trabajamos en toda Málaga',
  },
  en: {
    notFound: 'Service not found', backHome: '← Back to home',
    home: 'Home', services: 'Services',
    quote: 'Get your quote', seeCases: 'See real projects',
    whatEyebrow: (n) => `WHAT WE DO IN ${n.toUpperCase()}`,
    whatTitle: (n) => <>Everything you need in <em>{n.toLowerCase()}</em>,<br />with a single team.</>,
    whatSub: 'Our own team covers everything from small repairs to full renovations. The same person from start to finish, the same quote.',
    casesEyebrow: 'REAL PROJECTS · MÁLAGA',
    casesTitle: (n) => <>Recent {n.toLowerCase()} <em>projects.</em></>,
    casesSub: 'A selection of projects from recent months. All delivered on time and on a fixed-price quote.',
    howEyebrow: 'HOW WE WORK',
    howTitle: <>From your call to a technician at your home, <em>in 48 hours.</em></>,
    steps: [
      ['Tell us what you need', 'By WhatsApp, phone or email. We reply in under 1 hour during working hours.'],
      ['Free technical visit', 'We come to see it, take measurements and explain the options. No commitment, no sales pressure.'],
      ['Fixed-price quote in 24h', 'We send it to you signed, in writing. What you sign is what you pay, with no hidden extras.'],
      ['Team working in 48h', 'As soon as you sign, a technician in Ledens uniform is at your home with the materials.'],
    ],
    note: 'Reply in under 1h · Free visit · We work all over Málaga',
  },
};

/* ── Sub-components ───────────────────────────────────────────────────────── */

function CaseCard({ caso }) {
  const imgSrc = useServiceImage(caso.imgKey);
  return (
    <article className="case">
      <div
        className="case-img"
        style={imgSrc ? { backgroundImage: `url(${imgSrc})` } : {}}
      />
      <div className="case-body">
        <div className="case-tag">{caso.tag}</div>
        <h3>{caso.title}</h3>
        <p>{caso.body}</p>
      </div>
    </article>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

export default function ServicioPage({ onOpenLead }) {
  const { slug } = useParams();
  const { lang } = useI18n();
  const t = TXT[lang];
  const svc = localized(SERVICIOS_BY_SLUG[slug], lang);

  const heroImg  = useServiceImage(svc?.hero?.imgKey);

  if (!svc) {
    return (
      <div style={{ padding: '120px 40px', textAlign: 'center' }}>
        <h2>{t.notFound}</h2>
        <Link to="/" style={{ color: 'var(--ledens-blue)' }}>{t.backHome}</Link>
      </div>
    );
  }

  const { hero, bullets, casos, cta, name, icon } = svc;

  return (
    <>
      {/* ── 01 · Hero ─────────────────────────────────────────────────────── */}
      <section
        className="svc-hero"
        style={heroImg ? { '--bg-img': `url(${heroImg})` } : {}}
      >
        <div className="svc-hero-inner">
          <div className="svc-crumbs">
            <Link to="/">{t.home}</Link>
            <span>/</span>
            {t.services}
            <span>/</span>
            {name}
          </div>

          <span className="svc-eyebrow">
            <i className={icon}></i> {hero.eyebrow}
          </span>

          <h1>{renderTitle(hero.title)}</h1>

          <p className="svc-lead">{hero.lead}</p>

          <div className="svc-hero-ctas">
            <button className="btn btn-lg btn-pink" onClick={onOpenLead}>
              <i className="ri-whatsapp-fill"></i> {t.quote}
            </button>
            <a className="btn btn-lg btn-outline-light" href="#casos">
              {t.seeCases}
            </a>
          </div>
        </div>
      </section>

      {/* ── 02 · Qué hacemos ──────────────────────────────────────────────── */}
      <section className="band svc-band-white">
        <div className="band-inner">
          <div className="split">
            <div>
              <div className="eyebrow-row">{t.whatEyebrow(name)}</div>
              <h2 className="section-title">{t.whatTitle(name)}</h2>
              <p className="section-sub">{t.whatSub}</p>
              <div className="svc-bullets">
                {bullets.map((b, i) => (
                  <div key={i} className="svc-bullet">
                    <i className="ri-checkbox-circle-line"></i>
                    <div>
                      <div className="svc-bullet-t">{b.t}</div>
                      <div className="svc-bullet-s">{b.s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="split-img"
              style={heroImg ? { backgroundImage: `url(${heroImg})` } : {}}
            />
          </div>
        </div>
      </section>

      {/* ── 03 · Casos reales ─────────────────────────────────────────────── */}
      <section className="band svc-band-muted" id="casos">
        <div className="band-inner">
          <div className="eyebrow-row">{t.casesEyebrow}</div>
          <h2 className="section-title">{t.casesTitle(name)}</h2>
          <p className="section-sub">{t.casesSub}</p>
          <div className="cases">
            {casos.map((c, i) => <CaseCard key={i} caso={c} />)}
          </div>
        </div>
      </section>

      {/* ── 04 · Cómo trabajamos ──────────────────────────────────────────── */}
      <section className="band svc-band-white">
        <div className="band-inner">
          <div className="eyebrow-row">{t.howEyebrow}</div>
          <h2 className="section-title">{t.howTitle}</h2>
          <div className="mini-steps">
            {t.steps.map(([title, body], i) => (
              <div key={i} className="mini-step">
                <div className="mini-step-n">{String(i + 1).padStart(2, '0')}</div>
                <h4>{title}</h4>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 05 · CTA band ─────────────────────────────────────────────────── */}
      <section className="svc-cta-band">
        <div className="band-inner">
          <h2>{renderTitle(cta.title)}</h2>
          <p>{cta.subtitle}</p>
          <div className="cta-row">
            <button className="btn btn-lg btn-pink" onClick={onOpenLead}>
              <i className="ri-whatsapp-fill"></i> {t.quote}
            </button>
            <a className="btn btn-lg btn-outline-light" href="tel:+34655638219">
              <i className="ri-phone-line"></i> 655 638 219
            </a>
          </div>
          <div className="cta-note">{t.note}</div>
        </div>
      </section>

      <Footer />

      <a
        className="wa-float"
        href="https://wa.me/34655638219"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp"
      >
        <i className="ri-whatsapp-fill"></i>
      </a>
    </>
  );
}
