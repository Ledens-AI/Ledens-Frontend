import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Client-facing language (ES / EN). No library: each component keeps its own
// `{ es: {...}, en: {...} }` dictionary next to its JSX and reads it with
// useT(DICT); dates and amounts go through fmtDate / fmtMoney so they follow
// the language too. The admin panel and Gestión financiera stay in Spanish.
export const LANGS = ['es', 'en'];
const STORAGE_KEY = 'ledens.lang.v1';
const LOCALES = { es: 'es-ES', en: 'en-GB' };

function initialLang() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* storage blocked — fall through to the browser language */ }
  try {
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    if (nav.toLowerCase().startsWith('en')) return 'en';
  } catch { /* no navigator */ }
  return 'es';
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!LANGS.includes(next)) return;
    setLangState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted */ }
  }, []);

  const value = useMemo(() => {
    const locale = LOCALES[lang];
    return {
      lang,
      locale,
      setLang,
      fmtDate: (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
        if (!d) return '';
        const date = d instanceof Date ? d : new Date(d);
        return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString(locale, opts);
      },
      fmtMoney: (n, opts = {}) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', ...opts }).format(Number(n) || 0),
      fmtNumber: (n, opts = {}) => new Intl.NumberFormat(locale, opts).format(Number(n) || 0),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n() must be used inside <I18nProvider>');
  return ctx;
}

/** The current language's half of a `{ es, en }` dictionary. */
export function useT(dict) {
  return dict[useI18n().lang];
}
