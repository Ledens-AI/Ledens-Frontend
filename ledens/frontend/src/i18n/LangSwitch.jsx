import React from 'react';
import { LANGS, useI18n } from './I18nContext.jsx';

const LABEL = { es: 'Español', en: 'English' };

/** ES / EN pill for the top bars (site Header and /plataforma). */
export default function LangSwitch({ className = '', style }) {
  const { lang, setLang } = useI18n();
  return (
    <div
      className={`lang-switch ${className}`}
      style={style}
      role="group"
      aria-label={lang === 'en' ? 'Language' : 'Idioma'}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          title={LABEL[l]}
          aria-pressed={lang === l}
          className={lang === l ? 'active' : ''}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
