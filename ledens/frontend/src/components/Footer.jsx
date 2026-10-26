import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/I18nContext.jsx';
import logo from '../assets/logo-ledens-isotype.png';

const TXT = {
  es: {
    about: 'Proptech malagueña que identifica buenas oportunidades de inversión inmobiliaria y ejecuta reformas con presupuesto cerrado y plazos por contrato.',
    services: 'Servicios',
    serviceList: [
      ['albanileria', 'Albañilería'], ['electricidad', 'Electricidad'], ['fontaneria', 'Fontanería'],
      ['climatizacion', 'Climatización'], ['pladur', 'Pladur'], ['carpinteria', 'Carpintería'],
    ],
    company: 'Empresa', companyLinks: ['Quiénes somos', 'Casos de éxito', 'Inversión', 'Contacto'],
    legal: 'Legal', terms: 'Términos y condiciones', privacy: 'Política de privacidad',
    cookies: 'Política de cookies', notice: 'Aviso legal',
    bottom: 'Reformas inteligentes · Málaga, España',
  },
  en: {
    about: 'Málaga-based proptech that spots good property investment opportunities and carries out renovations with fixed-price quotes and deadlines by contract.',
    services: 'Services',
    serviceList: [
      ['albanileria', 'Masonry'], ['electricidad', 'Electrical'], ['fontaneria', 'Plumbing'],
      ['climatizacion', 'Heating & cooling'], ['pladur', 'Drywall'], ['carpinteria', 'Carpentry'],
    ],
    company: 'Company', companyLinks: ['About us', 'Success stories', 'Investment', 'Contact'],
    legal: 'Legal', terms: 'Terms and conditions', privacy: 'Privacy policy',
    cookies: 'Cookie policy', notice: 'Legal notice',
    bottom: 'Smart renovations · Málaga, Spain',
  },
};

export default function Footer() {
  const t = useT(TXT);
  return (
    <footer>
      <div className="foot-inner">
        <div>
          <div className="foot-logo">
            <img src={logo} alt="Ledens" />
            <span className="w">Ledens</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', maxWidth: 360, margin: 0 }}>
            {t.about}
          </p>
        </div>
        <div className="foot-col">
          <h5>{t.services}</h5>
          {t.serviceList.map(([slug, label]) => (
            <Link key={slug} to={`/servicios/${slug}`}>{label}</Link>
          ))}
        </div>
        <div className="foot-col">
          <h5>{t.company}</h5>
          {t.companyLinks.map((label) => <a key={label} href="#">{label}</a>)}
        </div>
        <div className="foot-col">
          <h5>{t.legal}</h5>
          <Link to="/terminos">{t.terms}</Link>
          <Link to="/privacidad">{t.privacy}</Link>
          <Link to="/cookies">{t.cookies}</Link>
          <a href="#">{t.notice}</a>
        </div>
      </div>
      <div className="foot-bottom">
        <div>© {new Date().getFullYear()} Ledens · {t.bottom}</div>
        <div>655 638 219 · hola@ledens.es</div>
      </div>
    </footer>
  );
}
