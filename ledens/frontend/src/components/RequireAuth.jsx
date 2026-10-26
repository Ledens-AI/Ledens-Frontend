import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

/**
 * Renders its children only for logged-in users; everyone else goes to /auth,
 * which brings them back here (?redirect=) after an email/password login.
 */
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const { lang } = useI18n();
  const { pathname, search } = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#F7F7F5',
        fontFamily: 'var(--font-sans)', color: 'var(--ink-500)',
      }}>
        {lang === 'en' ? 'Loading…' : 'Cargando…'}
      </div>
    );
  }
  if (!user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(pathname + search)}`} replace />;
  }
  return children;
}
