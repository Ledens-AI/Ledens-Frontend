import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/logo-ledens-isotype.png';

/* ─── Icons ─────────────────────────────────────────────────────────────── */
const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" style={{ flexShrink: 0 }}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.3-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 43.5c5.5 0 10.4-2 14.1-5.4l-6.5-5.5c-2 1.4-4.6 2.4-7.6 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39 16.2 43.5 24 43.5z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5c-.5.4 6.7-4.9 6.7-15 0-1.2-.1-2.4-.3-3.5z"/>
  </svg>
);
const MicrosoftIcon = () => (
  <svg viewBox="0 0 23 23" width="20" height="20" style={{ flexShrink: 0 }}>
    <path fill="#F25022" d="M1 1h10v10H1z"/>
    <path fill="#7FBA00" d="M12 1h10v10H12z"/>
    <path fill="#00A4EF" d="M1 12h10v10H1z"/>
    <path fill="#FFB900" d="M12 12h10v10H12z"/>
  </svg>
);
const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" style={{ flexShrink: 0 }} fill="currentColor">
    <path d="M16.365 1.43c0 1.14-.46 2.1-1.17 2.84-.78.83-2.05 1.46-3.07 1.38-.13-1.1.47-2.22 1.15-2.95.78-.84 2.14-1.46 3.09-1.27zM20.6 17.1c-.56 1.3-.83 1.88-1.56 3.03-1.02 1.6-2.46 3.6-4.24 3.62-1.58.02-1.99-1.03-4.13-1.02-2.14.01-2.6 1.04-4.18 1.02-1.78-.02-3.15-1.82-4.17-3.42C-.15 16.8-.56 11.8 1.49 9.2c1.14-1.44 2.86-2.33 4.5-2.33 1.72 0 2.8 1.02 4.22 1.02 1.38 0 2.22-1.02 4.22-1.02 1.45 0 3 .84 4.1 2.28-3.6 2-3.01 7.2 2.07 7.95z"/>
  </svg>
);

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
// Only same-site paths ("/plataforma"), never "//evil.com" or absolute URLs.
function safeRedirect(v) { return v && v.startsWith('/') && !v.startsWith('//') ? v : '/'; }

// The backend redirects a failed Google/Microsoft login back here with one
// of these codes in ?error=... (see routes/oauth.js) — translate for the UI.
const OAUTH_ERRORS = {
  google_cancelled: 'Has cancelado el inicio de sesión con Google.',
  google_failed: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
  google_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso. Inicia sesión con tu contraseña, o con el método que usaste la primera vez.',
  microsoft_cancelled: 'Has cancelado el inicio de sesión con Microsoft.',
  microsoft_failed: 'No se pudo iniciar sesión con Microsoft. Inténtalo de nuevo.',
  microsoft_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso. Inicia sesión con tu contraseña, o con el método que usaste la primera vez.',
};

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, refresh } = useAuth();
  const redirectTo = safeRedirect(searchParams.get('redirect'));

  const [mode, setMode]         = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login');
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [errors, setErrors]     = useState({});
  const [alert, setAlert]       = useState(null);

  // Already logged in (e.g. came back here by mistake) — nothing to do.
  useEffect(() => {
    if (user) navigate(redirectTo);
  }, [user, navigate, redirectTo]);

  // A failed Google/Microsoft redirect lands back on /auth with ?error=...
  // — surface it once, on arrival.
  useEffect(() => {
    const code = searchParams.get('error');
    if (code) {
      setAlert({
        type: 'error',
        title: 'No se pudo iniciar sesión',
        msg: OAUTH_ERRORS[code] || 'Ha ocurrido un error. Inténtalo de nuevo.',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(m) {
    setMode(m); setErrors({}); setAlert(null);
    const q = new URLSearchParams();
    if (m === 'signup') q.set('mode', 'signup');
    if (redirectTo !== '/') q.set('redirect', redirectTo);
    navigate(`/auth${q.toString() ? `?${q}` : ''}`, { replace: true });
  }

  function validate() {
    const e = {};
    if (mode === 'signup' && !name.trim()) e.name = 'Introduce tu nombre.';
    if (!isValidEmail(email))              e.email = 'Introduce un email válido.';
    if (password.length < 8)              e.password = mode === 'signup'
      ? 'La contraseña debe tener al menos 8 caracteres.'
      : 'Introduce tu contraseña.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submitAuth(path, body, duplicateTitle) {
    setLoading(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const title =
          res.status === 409 ? duplicateTitle :
          res.status === 503 ? 'No disponible' :
                                'Credenciales incorrectas';
        setAlert({ type: 'error', title, msg: data.error || 'Inténtalo de nuevo.' });
        return;
      }
      await refresh();
      navigate(redirectTo);
    } catch {
      setAlert({ type: 'error', title: 'Error de conexión', msg: 'No se pudo contactar con el servidor. Inténtalo de nuevo.' });
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(e) {
    e.preventDefault(); setAlert(null);
    if (!validate()) return;
    submitAuth('/api/auth/login', { email: email.trim(), password }, 'Credenciales incorrectas');
  }

  function handleSignup(e) {
    e.preventDefault(); setAlert(null);
    if (!validate()) return;
    submitAuth('/api/auth/register', { name: name.trim(), email: email.trim(), password }, 'Email ya registrado');
  }

  return (
    <div className="auth-wrap">
      {/* Art panel */}
      <aside className="auth-art">
        <Link to="/" className="auth-art-logo">
          <img src={logo} alt="Ledens" />
          <span>Ledens</span>
        </Link>
        <div className="auth-art-body">
          <h2>Tu reforma, <em>bajo control</em><br />desde tu móvil.</h2>
          <p>Accede a tu panel de cliente para ver el estado de obra, fotos semanales, presupuesto actualizado y tu interlocutor único directo en chat.</p>
          <div className="auth-stats">
            <div><div className="auth-stat-num">24h</div><div className="auth-stat-lab">presupuesto cerrado</div></div>
            <div><div className="auth-stat-num">48h</div><div className="auth-stat-lab">obra empezada</div></div>
            <div><div className="auth-stat-num">0€</div><div className="auth-stat-lab">extras</div></div>
          </div>
        </div>
        <div className="auth-art-foot">© 2026 Ledens · Reformas inteligentes · Málaga</div>
      </aside>

      {/* Form panel */}
      <main className="auth-form-side">
        <div className="auth-card">
          <Link to="/" className="auth-back">
            <i className="ri-arrow-left-line"></i> Volver
          </Link>

          <div className="auth-tabs" role="tablist">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} type="button">
              Iniciar sesión
            </button>
            <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')} type="button">
              Crear cuenta
            </button>
          </div>

          <h1 className="auth-title">{mode === 'login' ? 'Bienvenido de vuelta' : 'Crea tu cuenta Ledens'}</h1>
          <p className="auth-subtitle">
            {mode === 'login'
              ? 'Accede para ver el estado de tu reforma y hablar con tu equipo.'
              : 'En 30 segundos tienes acceso al panel de tu reforma.'}
          </p>

          {alert && (
            <div className={`auth-alert auth-alert--${alert.type}`}>
              <i className={
                alert.type === 'error'   ? 'ri-error-warning-line'   :
                alert.type === 'success' ? 'ri-checkbox-circle-line' :
                                           'ri-information-line'}></i>
              <div>
                <div className="auth-alert-title">{alert.title}</div>
                <div>{alert.msg}</div>
              </div>
            </div>
          )}

          {/* Google/Microsoft are plain links, not JS handlers — the backend
              does the whole redirect + token exchange itself (see
              routes/oauth.js), so there's nothing for the frontend to do but
              navigate there. Apple (#13) has no backend route yet. */}
          <div className="auth-social">
            <a className="auth-btn-social" href="/api/auth/google">
              <GoogleIcon /> Continuar con Google
            </a>
            <a className="auth-btn-social" href="/api/auth/microsoft">
              <MicrosoftIcon /> Continuar con Microsoft
            </a>
            <button className="auth-btn-social" type="button" disabled>
              <AppleIcon /> Continuar con Apple <span className="auth-soon">Próximamente</span>
            </button>
          </div>
          <div className="auth-divider"><span>o</span></div>

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} noValidate>
            {mode === 'signup' && (
              <div className={`auth-field${errors.name ? ' invalid' : ''}`}>
                <label htmlFor="auth-name">Nombre completo</label>
                <div className="auth-field-input">
                  <input id="auth-name" type="text" placeholder="Tu nombre"
                    autoComplete="name" value={name}
                    onChange={e => setName(e.target.value)} />
                </div>
                {errors.name && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {errors.name}</div>}
              </div>
            )}

            <div className={`auth-field${errors.email ? ' invalid' : ''}`}>
              <label htmlFor="auth-email">Email</label>
              <div className="auth-field-input">
                <input id="auth-email" type="email" placeholder="tu@correo.es"
                  autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)} />
              </div>
              {errors.email && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {errors.email}</div>}
            </div>

            <div className={`auth-field${errors.password ? ' invalid' : ''}`}>
              <label htmlFor="auth-password">Contraseña</label>
              <div className="auth-field-input auth-field-input--icon">
                <input id="auth-password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder={mode === 'signup' ? 'Mínimo 8 caracteres' : '••••••••'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="auth-toggle-pwd"
                  aria-label="Mostrar contraseña"
                  onClick={() => setShowPwd(v => !v)}>
                  <i className={showPwd ? 'ri-eye-off-line' : 'ri-eye-line'}></i>
                </button>
              </div>
              {errors.password && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {errors.password}</div>}
            </div>

            {mode === 'login' && (
              <div className="auth-row-between">
                <label className="auth-check">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                  Recuérdame
                </label>
                <a href="#" className="auth-forgot">¿Olvidaste tu contraseña?</a>
              </div>
            )}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading
                ? <span className="auth-spinner"></span>
                : <span>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</span>}
            </button>

            <p className="auth-alt-link">
              {mode === 'login'
                ? <>¿Aún no tienes cuenta?{' '}<button type="button" onClick={() => switchMode('signup')}>Regístrate gratis</button></>
                : <>¿Ya tienes cuenta?{' '}<button type="button" onClick={() => switchMode('login')}>Inicia sesión</button></>}
            </p>

            {mode === 'signup' && (
              <p className="auth-terms">
                Al crear cuenta aceptas los <a href="#">Términos</a> y la{' '}
                <a href="#">Política de privacidad</a> de Ledens.
              </p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
