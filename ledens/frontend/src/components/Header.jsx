import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/I18nContext.jsx';
import LangSwitch from '../i18n/LangSwitch.jsx';
import logo from '../assets/logo-ledens-isotype.png';

const SERVICE_ICONS = {
  albanileria: 'ri-hammer-line', electricidad: 'ri-flashlight-line', fontaneria: 'ri-drop-line',
  climatizacion: 'ri-temp-cold-line', pladur: 'ri-layout-2-line', carpinteria: 'ri-door-open-line',
};

// Street names are proper nouns and stay as they are in both languages.
const CASES = ['Santa Marta', 'Pasaje Pezuela', 'Martínez de la Rosa', 'Paseo de Los Tilos', 'Avenida de la Paloma'];

const TXT = {
  es: {
    tag: 'Reformas inteligentes',
    services: 'SERVICIOS', servicesAria: 'Servicios',
    projects: 'PROYECTOS', how: 'CÓMO FUNCIONA',
    cases: 'CASOS DE ÉXITO', casesAria: 'Casos de éxito',
    about: 'QUIÉNES SOMOS',
    myArea: 'MI ÁREA', logout: 'CERRAR SESIÓN', logoutAria: 'Cerrar sesión', login: 'INICIA SESIÓN', loginShort: 'ENTRAR', register: 'REGÍSTRATE',
    serviceList: [
      ['albanileria', 'Albañilería', 'Obra, alicatado y solados'],
      ['electricidad', 'Electricidad', 'Instalación, cuadro y domótica'],
      ['fontaneria', 'Fontanería', 'Tuberías, sanitarios, fugas'],
      ['climatizacion', 'Climatización', 'Aire acondicionado y aerotermia'],
      ['pladur', 'Pladur', 'Tabiques, techos y armarios'],
      ['carpinteria', 'Carpintería', 'Madera, puertas y a medida'],
    ],
    caseDescs: [
      'Piso completo · 90 m²', 'Cocina + baño · Centro histórico', 'Reforma integral · Málaga capital',
      'Cocina con isla · 24 m²', 'Baño principal · Microcemento',
    ],
  },
  en: {
    tag: 'Smart renovations',
    services: 'SERVICES', servicesAria: 'Services',
    projects: 'PROJECTS', how: 'HOW IT WORKS',
    cases: 'SUCCESS STORIES', casesAria: 'Success stories',
    about: 'ABOUT US',
    myArea: 'MY AREA', logout: 'LOG OUT', logoutAria: 'Log out', login: 'LOG IN', loginShort: 'LOG IN', register: 'SIGN UP',
    serviceList: [
      ['albanileria', 'Masonry', 'Building work, tiling and flooring'],
      ['electricidad', 'Electrical', 'Wiring, fuse boards and home automation'],
      ['fontaneria', 'Plumbing', 'Pipes, bathroom fittings, leaks'],
      ['climatizacion', 'Heating & cooling', 'Air conditioning and heat pumps'],
      ['pladur', 'Drywall', 'Partitions, ceilings and wardrobes'],
      ['carpinteria', 'Carpentry', 'Woodwork, doors and bespoke pieces'],
    ],
    caseDescs: [
      'Whole flat · 90 m²', 'Kitchen + bathroom · Historic centre', 'Full renovation · Málaga city',
      'Kitchen with island · 24 m²', 'Main bathroom · Microcement',
    ],
  },
};

export default function Header() {
  const { user, loading, logout } = useAuth();
  const t = useT(TXT);

  return (
    <header className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <a className="logo" href="/">
            <img src={logo} alt="Ledens" />
            <span className="logo-word">Ledens</span>
          </a>
          <div className="logo-sep"></div>
          <span className="logo-tag">{t.tag}</span>
        </div>

        <nav className="nav">
          {/* Servicios dropdown */}
          <div className="nav-item nav-item-dropdown">
            <a href="#compromisos">{t.services} <i className="ri-arrow-down-s-line chev"></i></a>
            <div className="nav-menu nav-menu-services" aria-label={t.servicesAria}>
              {t.serviceList.map(([slug, label, desc]) => (
                <Link key={slug} to={`/servicios/${slug}`} className="nav-menu-link">
                  <span className="nm-ico"><i className={SERVICE_ICONS[slug]}></i></span>
                  <span className="nm-text">
                    <span className="nm-t">{label}</span>
                    <span className="nm-s">{desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <a href="#galeria">{t.projects}</a>
          <a href="#proceso">{t.how}</a>

          {/* Casos de éxito dropdown */}
          <div className="nav-item nav-item-dropdown">
            <a href="#testimonios">{t.cases} <i className="ri-arrow-down-s-line chev"></i></a>
            <div className="nav-menu nav-menu-cases" aria-label={t.casesAria}>
              {CASES.map((label, i) => (
                <a key={label} href="#testimonios" className="nav-menu-link">
                  <span className="nm-ico"><i className="ri-home-smile-line"></i></span>
                  <span className="nm-text">
                    <span className="nm-t">{label}</span>
                    <span className="nm-s">{t.caseDescs[i]}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>

          <a href="#faq">{t.about}</a>
        </nav>

        <div className="hdr-right">
          <LangSwitch />
          <div className="hdr-ctas">
            {!loading && user ? (
              <div className="hdr-user">
                <span className="hdr-user-name">{(user.name || user.email).split(' ')[0]}</span>
                <Link to="/plataforma" className="btn btn-sm btn-blue">{t.myArea}</Link>
                {/* On phones only the icon shows (see .hdr-logout in app.css). */}
                <button type="button" className="btn btn-sm btn-outline hdr-logout" onClick={logout} aria-label={t.logoutAria}>
                  <i className="ri-logout-box-r-line" aria-hidden="true"></i>
                  <span className="lbl-long">{t.logout}</span>
                </button>
              </div>
            ) : (
              <>
                <Link to="/auth" className="btn btn-sm btn-outline">
                  <span className="lbl-long">{t.login}</span><span className="lbl-short">{t.loginShort}</span>
                </Link>
                <Link to="/registro" className="btn btn-sm btn-blue">{t.register}</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
