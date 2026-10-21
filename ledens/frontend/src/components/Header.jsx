import React from 'react';
import { Link } from 'react-router-dom';
import {
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/clerk-react';
import logo from '../assets/logo-ledens-isotype.png';

// Clerk components must only be rendered inside <ClerkProvider>.
// When the publishable key is missing (build without env var), we fall back to
// plain static buttons so the site stays fully visible.
const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

const SERVICES = [
  { icon: 'ri-hammer-line',     slug: 'albanileria',   label: 'Albañilería',   desc: 'Obra, alicatado y solados' },
  { icon: 'ri-flashlight-line', slug: 'electricidad',  label: 'Electricidad',  desc: 'Instalación, cuadro y domótica' },
  { icon: 'ri-drop-line',       slug: 'fontaneria',    label: 'Fontanería',    desc: 'Tuberías, sanitarios, fugas' },
  { icon: 'ri-temp-cold-line',  slug: 'climatizacion', label: 'Climatización', desc: 'Aire acondicionado y aerotermia' },
  { icon: 'ri-layout-2-line',   slug: 'pladur',        label: 'Pladur',        desc: 'Tabiques, techos y armarios' },
  { icon: 'ri-door-open-line',  slug: 'carpinteria',   label: 'Carpintería',   desc: 'Madera, puertas y a medida' },
];

const SUCCESS_CASES = [
  { label: 'Santa Marta',           desc: 'Piso completo · 90 m²' },
  { label: 'Pasaje Pezuela',        desc: 'Cocina + baño · Centro histórico' },
  { label: 'Martínez de la Rosa',   desc: 'Reforma integral · Málaga capital' },
  { label: 'Paseo de Los Tilos',    desc: 'Cocina con isla · 24 m²' },
  { label: 'Avenida de la Paloma',  desc: 'Baño principal · Microcemento' },
];

export default function Header() {
  return (
    <header className="hdr">
      <div className="hdr-inner">
        <div className="hdr-left">
          <a className="logo" href="/">
            <img src={logo} alt="Ledens" />
            <span className="logo-word">Ledens</span>
          </a>
          <div className="logo-sep"></div>
          <span className="logo-tag">Reformas inteligentes</span>
        </div>

        <nav className="nav">
          {/* Servicios dropdown */}
          <div className="nav-item nav-item-dropdown">
            <a href="#compromisos">SERVICIOS <i className="ri-arrow-down-s-line chev"></i></a>
            <div className="nav-menu nav-menu-services" aria-label="Servicios">
              {SERVICES.map((s) => (
                <Link key={s.slug} to={`/servicios/${s.slug}`} className="nav-menu-link">
                  <span className="nm-ico"><i className={s.icon}></i></span>
                  <span className="nm-text">
                    <span className="nm-t">{s.label}</span>
                    <span className="nm-s">{s.desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <a href="#galeria">PROYECTOS</a>
          <a href="#proceso">CÓMO FUNCIONA</a>

          {/* Casos de éxito dropdown */}
          <div className="nav-item nav-item-dropdown">
            <a href="#testimonios">CASOS DE ÉXITO <i className="ri-arrow-down-s-line chev"></i></a>
            <div className="nav-menu nav-menu-cases" aria-label="Casos de éxito">
              {SUCCESS_CASES.map((c) => (
                <a key={c.label} href="#testimonios" className="nav-menu-link">
                  <span className="nm-ico"><i className="ri-home-smile-line"></i></span>
                  <span className="nm-text">
                    <span className="nm-t">{c.label}</span>
                    <span className="nm-s">{c.desc}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>

          <a href="#faq">QUIÉNES SOMOS</a>
        </nav>

        <div className="hdr-ctas">
          {CLERK_ENABLED ? (
            <>
              <SignedOut>
                <Link to="/auth" className="btn btn-sm btn-outline">INICIA SESIÓN</Link>
                <Link to="/registro" className="btn btn-sm btn-blue">REGÍSTRATE</Link>
              </SignedOut>
              <SignedIn>
                <Link to="/plataforma" className="btn btn-sm btn-blue">MI ÁREA</Link>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </>
          ) : (
            <>
              <Link to="/auth" className="btn btn-sm btn-outline">INICIA SESIÓN</Link>
              <Link to="/registro" className="btn btn-sm btn-blue">REGÍSTRATE</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
