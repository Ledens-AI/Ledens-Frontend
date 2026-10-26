import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { apiErrorText } from '../i18n/apiErrors.js';
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

const TXT = {
  es: {
    // The backend redirects a failed Google/Microsoft login back here with one
    // of these codes in ?error=... (see routes/oauth.js) — translate for the UI.
    oauthErrors: {
      google_cancelled: 'Has cancelado el inicio de sesión con Google.',
      google_failed: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
      google_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso. Inicia sesión con tu contraseña, o con el método que usaste la primera vez.',
      microsoft_cancelled: 'Has cancelado el inicio de sesión con Microsoft.',
      microsoft_failed: 'No se pudo iniciar sesión con Microsoft. Inténtalo de nuevo.',
      microsoft_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso. Inicia sesión con tu contraseña, o con el método que usaste la primera vez.',
    },
    loginFailed: 'No se pudo iniciar sesión', genericError: 'Ha ocurrido un error. Inténtalo de nuevo.',
    errName: 'Introduce tu nombre.', errEmail: 'Introduce un email válido.',
    errPwdShort: 'La contraseña debe tener al menos 8 caracteres.', errPwd: 'Introduce tu contraseña.',
    unavailable: 'No disponible', badCredentials: 'Credenciales incorrectas', emailTaken: 'Email ya registrado',
    tryAgain: 'Inténtalo de nuevo.',
    netTitle: 'Error de conexión', netMsg: 'No se pudo contactar con el servidor. Inténtalo de nuevo.',
    artTitle: <>Tu reforma, <em>bajo control</em><br />desde tu móvil.</>,
    artBody: 'Accede a tu panel de cliente para ver el estado de obra, fotos semanales, presupuesto actualizado y tu interlocutor único directo en chat.',
    stats: ['presupuesto cerrado', 'obra empezada', 'extras'], zero: '0€',
    artFoot: '© 2026 Ledens · Reformas inteligentes · Málaga',
    back: 'Volver', tabLogin: 'Iniciar sesión', tabSignup: 'Crear cuenta',
    titleLogin: 'Bienvenido de vuelta', titleSignup: 'Crea tu cuenta Ledens',
    subLogin: 'Accede para ver el estado de tu reforma y hablar con tu equipo.',
    subSignup: 'En 30 segundos tienes acceso al panel de tu reforma.',
    google: 'Continuar con Google', microsoft: 'Continuar con Microsoft', apple: 'Continuar con Apple', soon: 'Próximamente',
    or: 'o', fullName: 'Nombre completo', namePh: 'Tu nombre', email: 'Email', emailPh: 'tu@correo.es',
    password: 'Contraseña', pwdPh: 'Mínimo 8 caracteres', showPwd: 'Mostrar contraseña',
    remember: 'Recuérdame', forgot: '¿Olvidaste tu contraseña?',
    noAccount: '¿Aún no tienes cuenta?', signupFree: 'Regístrate gratis',
    haveAccount: '¿Ya tienes cuenta?', login: 'Inicia sesión',
    terms: <>Al crear cuenta aceptas los <Link to="/terminos">Términos</Link> y la{' '}<Link to="/privacidad">Política de privacidad</Link> de Ledens.</>,
  },
  en: {
    oauthErrors: {
      google_cancelled: 'You cancelled signing in with Google.',
      google_failed: 'Could not sign in with Google. Please try again.',
      google_email_in_use: 'That email already has an account with a different sign-in method. Log in with your password, or with the method you used the first time.',
      microsoft_cancelled: 'You cancelled signing in with Microsoft.',
      microsoft_failed: 'Could not sign in with Microsoft. Please try again.',
      microsoft_email_in_use: 'That email already has an account with a different sign-in method. Log in with your password, or with the method you used the first time.',
    },
    loginFailed: 'Could not log in', genericError: 'Something went wrong. Please try again.',
    errName: 'Please enter your name.', errEmail: 'Please enter a valid email.',
    errPwdShort: 'The password must be at least 8 characters long.', errPwd: 'Please enter your password.',
    unavailable: 'Not available', badCredentials: 'Incorrect credentials', emailTaken: 'Email already registered',
    tryAgain: 'Please try again.',
    netTitle: 'Connection error', netMsg: 'Could not reach the server. Please try again.',
    artTitle: <>Your renovation, <em>under control</em><br />from your phone.</>,
    artBody: 'Open your client area to see the status of the works, weekly photos, the up-to-date budget and chat directly with your single point of contact.',
    stats: ['fixed-price quote', 'works started', 'extras'], zero: '€0',
    artFoot: '© 2026 Ledens · Smart renovations · Málaga',
    back: 'Back', tabLogin: 'Log in', tabSignup: 'Create account',
    titleLogin: 'Welcome back', titleSignup: 'Create your Ledens account',
    subLogin: 'Log in to see how your renovation is going and talk to your team.',
    subSignup: 'In 30 seconds you’ll have access to your renovation dashboard.',
    google: 'Continue with Google', microsoft: 'Continue with Microsoft', apple: 'Continue with Apple', soon: 'Coming soon',
    or: 'or', fullName: 'Full name', namePh: 'Your name', email: 'Email', emailPh: 'you@email.com',
    password: 'Password', pwdPh: 'At least 8 characters', showPwd: 'Show password',
    remember: 'Remember me', forgot: 'Forgot your password?',
    noAccount: 'Don’t have an account yet?', signupFree: 'Sign up for free',
    haveAccount: 'Already have an account?', login: 'Log in',
    terms: <>By creating an account you accept Ledens’ <Link to="/terminos">Terms</Link> and{' '}<Link to="/privacidad">Privacy policy</Link>.</>,
  },
};

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, refresh } = useAuth();
  const { lang } = useI18n();
  const t = TXT[lang];
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
  // — surface it once, on arrival. Kept as a code so it follows the language.
  const oauthError = searchParams.get('error');
  useEffect(() => {
    if (oauthError) setAlert({ type: 'error', oauth: oauthError });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(m) {
    setMode(m); setErrors({}); setAlert(null);
    const q = new URLSearchParams();
    if (m === 'signup') q.set('mode', 'signup');
    if (redirectTo !== '/') q.set('redirect', redirectTo);
    navigate(`/auth${q.toString() ? `?${q}` : ''}`, { replace: true });
  }

  // Field errors are stored as dictionary keys so they switch language too.
  function validate() {
    const e = {};
    if (mode === 'signup' && !name.trim()) e.name = 'errName';
    if (!isValidEmail(email))              e.email = 'errEmail';
    if (password.length < 8)              e.password = mode === 'signup' ? 'errPwdShort' : 'errPwd';
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
          res.status === 503 ? 'unavailable' :
                                'badCredentials';
        setAlert({ type: 'error', title, apiMsg: data.error || null });
        return;
      }
      await refresh();
      navigate(redirectTo);
    } catch {
      setAlert({ type: 'error', title: 'netTitle', msgKey: 'netMsg' });
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(e) {
    e.preventDefault(); setAlert(null);
    if (!validate()) return;
    submitAuth('/api/auth/login', { email: email.trim(), password }, 'badCredentials');
  }

  function handleSignup(e) {
    e.preventDefault(); setAlert(null);
    if (!validate()) return;
    submitAuth('/api/auth/register', { name: name.trim(), email: email.trim(), password }, 'emailTaken');
  }

  const alertTitle = alert && (alert.oauth ? t.loginFailed : t[alert.title]);
  const alertMsg = alert && (
    alert.oauth ? (t.oauthErrors[alert.oauth] || t.genericError)
    : alert.msgKey ? t[alert.msgKey]
    : alert.apiMsg ? apiErrorText(alert.apiMsg, lang, t.tryAgain)
    : t.tryAgain
  );

  return (
    <div className="auth-wrap">
      {/* Art panel */}
      <aside className="auth-art">
        <Link to="/" className="auth-art-logo">
          <img src={logo} alt="Ledens" />
          <span>Ledens</span>
        </Link>
        <div className="auth-art-body">
          <h2>{t.artTitle}</h2>
          <p>{t.artBody}</p>
          <div className="auth-stats">
            <div><div className="auth-stat-num">24h</div><div className="auth-stat-lab">{t.stats[0]}</div></div>
            <div><div className="auth-stat-num">48h</div><div className="auth-stat-lab">{t.stats[1]}</div></div>
            <div><div className="auth-stat-num">{t.zero}</div><div className="auth-stat-lab">{t.stats[2]}</div></div>
          </div>
        </div>
        <div className="auth-art-foot">{t.artFoot}</div>
      </aside>

      {/* Form panel */}
      <main className="auth-form-side">
        <div className="auth-card">
          <Link to="/" className="auth-back">
            <i className="ri-arrow-left-line"></i> {t.back}
          </Link>

          <div className="auth-tabs" role="tablist">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} type="button">
              {t.tabLogin}
            </button>
            <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')} type="button">
              {t.tabSignup}
            </button>
          </div>

          <h1 className="auth-title">{mode === 'login' ? t.titleLogin : t.titleSignup}</h1>
          <p className="auth-subtitle">
            {mode === 'login' ? t.subLogin : t.subSignup}
          </p>

          {alert && (
            <div className={`auth-alert auth-alert--${alert.type}`}>
              <i className={
                alert.type === 'error'   ? 'ri-error-warning-line'   :
                alert.type === 'success' ? 'ri-checkbox-circle-line' :
                                           'ri-information-line'}></i>
              <div>
                <div className="auth-alert-title">{alertTitle}</div>
                <div>{alertMsg}</div>
              </div>
            </div>
          )}

          {/* Google/Microsoft are plain links, not JS handlers — the backend
              does the whole redirect + token exchange itself (see
              routes/oauth.js), so there's nothing for the frontend to do but
              navigate there. Apple (#13) has no backend route yet. */}
          <div className="auth-social">
            <a className="auth-btn-social" href="/api/auth/google">
              <GoogleIcon /> {t.google}
            </a>
            <a className="auth-btn-social" href="/api/auth/microsoft">
              <MicrosoftIcon /> {t.microsoft}
            </a>
            <button className="auth-btn-social" type="button" disabled>
              <AppleIcon /> {t.apple} <span className="auth-soon">{t.soon}</span>
            </button>
          </div>
          <div className="auth-divider"><span>{t.or}</span></div>

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} noValidate>
            {mode === 'signup' && (
              <div className={`auth-field${errors.name ? ' invalid' : ''}`}>
                <label htmlFor="auth-name">{t.fullName}</label>
                <div className="auth-field-input">
                  <input id="auth-name" type="text" placeholder={t.namePh}
                    autoComplete="name" value={name}
                    onChange={e => setName(e.target.value)} />
                </div>
                {errors.name && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[errors.name]}</div>}
              </div>
            )}

            <div className={`auth-field${errors.email ? ' invalid' : ''}`}>
              <label htmlFor="auth-email">{t.email}</label>
              <div className="auth-field-input">
                <input id="auth-email" type="email" placeholder={t.emailPh}
                  autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)} />
              </div>
              {errors.email && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[errors.email]}</div>}
            </div>

            <div className={`auth-field${errors.password ? ' invalid' : ''}`}>
              <label htmlFor="auth-password">{t.password}</label>
              <div className="auth-field-input auth-field-input--icon">
                <input id="auth-password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder={mode === 'signup' ? t.pwdPh : '••••••••'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="auth-toggle-pwd"
                  aria-label={t.showPwd}
                  onClick={() => setShowPwd(v => !v)}>
                  <i className={showPwd ? 'ri-eye-off-line' : 'ri-eye-line'}></i>
                </button>
              </div>
              {errors.password && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[errors.password]}</div>}
            </div>

            {mode === 'login' && (
              <div className="auth-row-between">
                <label className="auth-check">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                  {t.remember}
                </label>
                <a href="#" className="auth-forgot">{t.forgot}</a>
              </div>
            )}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading
                ? <span className="auth-spinner"></span>
                : <span>{mode === 'login' ? t.tabLogin : t.tabSignup}</span>}
            </button>

            <p className="auth-alt-link">
              {mode === 'login'
                ? <>{t.noAccount}{' '}<button type="button" onClick={() => switchMode('signup')}>{t.signupFree}</button></>
                : <>{t.haveAccount}{' '}<button type="button" onClick={() => switchMode('login')}>{t.login}</button></>}
            </p>

            {mode === 'signup' && (
              <p className="auth-terms">{t.terms}</p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
