import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

/* Where to send someone who isn't signed in: /auth, remembering the page so
 * AuthPage can bring them back after login. */
function LoginRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={`/auth?redirect=${encodeURIComponent(pathname + search)}`} replace />;
}

function ClerkGuard({ children }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#F7F7F5',
        fontFamily: 'var(--font-sans)', color: 'var(--ink-500)',
      }}>
        Cargando…
      </div>
    );
  }
  return isSignedIn ? children : <LoginRedirect />;
}

/**
 * Renders its children only for signed-in users.
 * Without a Clerk key nobody can sign in, so the route always redirects.
 */
export default function RequireAuth({ children }) {
  return CLERK_ENABLED ? <ClerkGuard>{children}</ClerkGuard> : <LoginRedirect />;
}
