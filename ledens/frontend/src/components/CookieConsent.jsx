import React, { useState, useEffect, useCallback, useRef } from 'react';
import logo from '../assets/logo-ledens-isotype.png';
import { useT } from '../i18n/I18nContext.jsx';

/* ── Constants ───────────────────────────────────────────────────────────── */
const STORAGE_KEY = 'ledens.cookieConsent.v1';

const CATEGORIES = [
  { id: 'necessary',   locked: true,  count: 5 },
  { id: 'preferences', locked: false, count: 2 },
  { id: 'analytics',   locked: false, count: 5 },
  { id: 'marketing',   locked: false, count: 6 },
];

const TXT = {
  es: {
    cats: {
      necessary: ['Técnicas', 'Imprescindibles para que la web funcione: sesión, seguridad, balanceo de carga y el idioma que eliges. No identifican a una persona concreta.'],
      preferences: ['Preferencias', 'Recuerdan tus elecciones (ciudad de búsqueda, último presupuesto consultado) para no volver a preguntártelo.'],
      analytics: ['Analíticas', 'Nos ayudan a entender qué páginas funcionan y dónde se atascan los visitantes. Siempre con datos agregados.'],
      marketing: ['Marketing', 'Permiten medir la eficacia de nuestras campañas y mostrarte anuncios relevantes en otras webs y redes sociales.'],
    },
    titleDetails: 'Elige tus preferencias', titleUpdate: 'Actualiza tus preferencias', titleFirst: 'Tú decides qué cookies usamos',
    eyebrow: 'Privacidad & cookies', back: 'Volver',
    p1: <>Usamos <strong>cookies propias y de terceros</strong> para que la web funcione, recordar tus preferencias, medir cómo la usas y, si tú lo aceptas, mostrarte campañas más relevantes.</>,
    p2: <>Puedes <strong>aceptar todas</strong>, <strong>rechazarlas todas</strong> (salvo las imprescindibles) o <strong>elegir tú</strong> qué categorías activar. Cambiarás de opinión cuando quieras desde el icono inferior izquierdo o desde la</>,
    policy: 'Política de cookies',
    reject: 'Rechazar todas', customize: 'Personalizar', accept: 'Aceptar todas',
    always: 'Siempre activas',
    footNote: 'Tus preferencias se guardan durante 12 meses. Detalles en la',
    onlyNecessary: 'Solo imprescindibles', save: 'Guardar mis preferencias',
    reopen: 'Configuración de cookies',
  },
  en: {
    cats: {
      necessary: ['Technical', 'Essential for the website to work: session, security, load balancing and the language you choose. They don’t identify any particular person.'],
      preferences: ['Preferences', 'They remember your choices (search city, last quote viewed) so we don’t have to ask again.'],
      analytics: ['Analytics', 'They help us understand which pages work and where visitors get stuck. Always with aggregated data.'],
      marketing: ['Marketing', 'They let us measure how well our campaigns work and show you relevant ads on other websites and social networks.'],
    },
    titleDetails: 'Choose your preferences', titleUpdate: 'Update your preferences', titleFirst: 'You decide which cookies we use',
    eyebrow: 'Privacy & cookies', back: 'Back',
    p1: <>We use <strong>our own and third-party cookies</strong> to make the website work, remember your preferences, measure how you use it and, if you agree, show you more relevant campaigns.</>,
    p2: <>You can <strong>accept all</strong>, <strong>reject all</strong> (except the essential ones) or <strong>choose</strong> which categories to turn on. You can change your mind at any time from the icon at the bottom left or from the</>,
    policy: 'Cookie policy',
    reject: 'Reject all', customize: 'Customise', accept: 'Accept all',
    always: 'Always on',
    footNote: 'Your preferences are kept for 12 months. Details in the',
    onlyNecessary: 'Essential only', save: 'Save my preferences',
    reopen: 'Cookie settings',
  },
};

/* ── Storage helpers ─────────────────────────────────────────────────────── */
function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function savePrefs(prefs) {
  const payload = { ...prefs, savedAt: new Date().toISOString() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* noop */ }
  document.dispatchEvent(new CustomEvent('ledens:cookieconsent', { detail: payload }));
  return payload;
}

function allTrue() {
  return Object.fromEntries(CATEGORIES.map(c => [c.id, true]));
}

function allFalseExceptNecessary() {
  return Object.fromEntries(CATEGORIES.map(c => [c.id, !!c.locked]));
}

/* ── Component ───────────────────────────────────────────────────────────── */
export default function CookieConsent() {
  const t = useT(TXT);
  const stored = loadPrefs();

  const [open, setOpen]     = useState(false);
  const [view, setView]     = useState('summary'); // 'summary' | 'details'
  const [reopen, setReopen] = useState(!!stored);

  // Per-category toggle state (only non-locked categories matter)
  const initialToggles = () =>
    Object.fromEntries(
      CATEGORIES.filter(c => !c.locked).map(c => [c.id, !!(stored && stored[c.id])])
    );
  const [toggles, setToggles] = useState(initialToggles);

  const titleText = open
    ? view === 'details'
      ? t.titleDetails
      : stored
        ? t.titleUpdate
        : t.titleFirst
    : '';

  /* Handlers */
  const handleOpen = useCallback(() => {
    const s = loadPrefs();
    setToggles(Object.fromEntries(
      CATEGORIES.filter(c => !c.locked).map(c => [c.id, !!(s && s[c.id])])
    ));
    setView('summary');
    setOpen(true);
    document.documentElement.style.overflow = 'hidden';
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    document.documentElement.style.overflow = '';
    setReopen(true);
  }, []);

  const handleAccept = useCallback(() => {
    savePrefs(allTrue());
    handleClose();
  }, [handleClose]);

  const handleReject = useCallback(() => {
    savePrefs(allFalseExceptNecessary());
    handleClose();
  }, [handleClose]);

  const handleSave = useCallback(() => {
    const prefs = Object.fromEntries(
      CATEGORIES.map(c => [c.id, c.locked ? true : (toggles[c.id] || false)])
    );
    savePrefs(prefs);
    handleClose();
  }, [toggles, handleClose]);

  const handleToggle = useCallback((id) => {
    setToggles(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleBackdropClick = useCallback(() => {
    if (loadPrefs()) handleClose();
  }, [handleClose]);

  /* Keyboard */
  useEffect(() => {
    function onKey(e) {
      if (!open) return;
      if (e.key === 'Escape' && loadPrefs()) handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  /* Expose window.LedensCookies API */
  useEffect(() => {
    window.LedensCookies = {
      open:  handleOpen,
      close: handleClose,
      get:   loadPrefs,
      reset: () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
        setReopen(false);
        handleOpen();
      },
    };
    return () => { /* keep the API alive; do not clear on unmount */ };
  }, [handleOpen, handleClose]);

  /* Auto-open on first visit */
  useEffect(() => {
    if (!loadPrefs()) {
      const t = setTimeout(handleOpen, 450);
      return () => clearTimeout(t);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const policyPath = '/cookies';

  return (
    <>
      {/* ── Modal ──────────────────────────────────────────────────────── */}
      <div
        className="cc-root"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-title"
        data-open={open ? 'true' : undefined}
      >
        {/* Backdrop */}
        <div className="cc-backdrop" onClick={handleBackdropClick} />

        {/* Card */}
        <div className="cc-card" data-view={view}>

          {/* Head */}
          <div className="cc-head">
            <div className="cc-mark" aria-hidden="true">
              <img src={logo} alt="" />
            </div>
            <div className="cc-titles">
              <div className="cc-eyebrow">{t.eyebrow}</div>
              <h2 id="cc-title">{titleText}</h2>
            </div>
            <button
              className="cc-back"
              type="button"
              aria-label={t.back}
              onClick={() => setView('summary')}
            >
              <i className="ri-arrow-left-line" />
            </button>
          </div>

          {/* ── Summary view ─────────────────────────────────────────── */}
          <div className="cc-summary">
            <div className="cc-body">
              <p>{t.p1}</p>
              <p>
                {t.p2}{' '}
                <a href={policyPath} className="cc-more">
                  {t.policy} <i className="ri-arrow-right-up-line" />
                </a>.
              </p>
            </div>
            <div className="cc-actions">
              <button className="cc-btn cc-btn-ghost" type="button" onClick={handleReject}>
                {t.reject}
              </button>
              <button
                className="cc-btn cc-btn-outline"
                type="button"
                onClick={() => setView('details')}
              >
                {t.customize}
              </button>
              <button className="cc-btn cc-btn-primary" type="button" onClick={handleAccept}>
                {t.accept}
              </button>
            </div>
          </div>

          {/* ── Details view ─────────────────────────────────────────── */}
          <div className="cc-details">
            {CATEGORIES.map(cat => (
              <div className="cc-row" key={cat.id}>
                <div>
                  <h3>
                    {t.cats[cat.id][0]}
                    {cat.locked && <span className="cc-locked">{t.always}</span>}
                  </h3>
                  <p>{t.cats[cat.id][1]}</p>
                  <span className="cc-count">
                    {cat.count} cookie{cat.count === 1 ? '' : 's'}
                  </span>
                </div>
                <div
                  className="cc-toggle"
                  role="switch"
                  aria-checked={cat.locked ? 'true' : String(!!toggles[cat.id])}
                  aria-label={t.cats[cat.id][0]}
                  data-cat={cat.id}
                  data-on={cat.locked ? 'true' : String(!!toggles[cat.id])}
                  data-locked={cat.locked ? 'true' : 'false'}
                  tabIndex={cat.locked ? -1 : 0}
                  onClick={() => !cat.locked && handleToggle(cat.id)}
                  onKeyDown={e => {
                    if (!cat.locked && (e.key === ' ' || e.key === 'Enter')) {
                      e.preventDefault();
                      handleToggle(cat.id);
                    }
                  }}
                />
              </div>
            ))}
          </div>

          {/* Details footer */}
          <div className="cc-details-foot">
            <span className="cc-foot-note">
              {t.footNote}{' '}
              <a href={policyPath}>{t.policy}</a>.
            </span>
            <button className="cc-btn cc-btn-outline" type="button" onClick={handleReject}>
              {t.onlyNecessary}
            </button>
            <button className="cc-btn cc-btn-primary" type="button" onClick={handleSave}>
              {t.save}
            </button>
          </div>
        </div>
      </div>

      {/* ── Reopen pill ────────────────────────────────────────────────── */}
      <button
        className="cc-reopen"
        type="button"
        aria-label={t.reopen}
        data-show={reopen ? 'true' : 'false'}
        onClick={handleOpen}
      >
        <i className="ri-shield-user-line" />
      </button>
    </>
  );
}
