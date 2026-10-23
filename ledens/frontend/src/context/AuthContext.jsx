import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

// Replaces Clerk: the backend is the source of truth for who's logged in
// (via the httpOnly session cookie — see CLAUDE.md "Authentication"), so
// this just asks /api/auth/me and holds the answer for the rest of the app.
// Same-origin requests send cookies automatically; no credentials option
// needed, same as the fetch calls in LeadModal.jsx.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      setUser(res.ok ? (await res.json()).user : null);
    } catch {
      // Network error, or the backend's auth routes are 503 (no database
      // configured yet) — either way, treat as logged out rather than crash.
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
