import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useSignIn, useSignUp, useAuth } from '@clerk/clerk-react';
import logo from '../assets/logo-ledens-isotype.png';

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

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

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
// Only same-site paths ("/plataforma"), never "//evil.com" or absolute URLs.
function safeRedirect(v) { return v && v.startsWith('/') && !v.startsWith('//') ? v : '/'; }

/* ─────────────────────────────────────────────────────────────────────────
 * AuthForm — uses Clerk hooks; only rendered when ClerkProvider is present
 * ───────────────────────────────────────────────────────────────────────── */
function AuthForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isSignedIn } = useAuth();
  const { signIn, setActive: setSignInActive, isLoaded: siLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: suLoaded } = useSignUp();
  const redirectTo = safeRedirect(searchParams.get('redirect'));

  const [mode, setMode]         = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login');
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [remember, setRemember] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [errors, setErrors]     = useState({});
  const [alert, setAlert]       = useState(null);

  useEffect(() => { if (isSignedIn) navigate(redirectTo); }, [isSignedIn]);

  function switchMode(m) {
    setMode(m); setErrors({}); setAlert(null);
    setVerifying(false); setCode('');
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

  async function handleOAuth(provider) {
    try {
      await signIn.authenticateWithRedirect({
        strategy: `oauth_${provider}`,
        redirectUrl: `${window.location.origin}/sso-callback`,
        redirectUrlComplete: redirectTo,
      });
    } catch (err) {
      setAlert({ type: 'error', title: 'Error OAuth', msg: err.errors?.[0]?.message ?? err.message });
    }
  }

  async function handleLogin(e) {
    e.preventDefault(); setAlert(null);
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await signIn.create({ identifier: email, password });
      if (res.status === 'complete') {
        await setSignInActive({ session: res.createdSessionId });
        navigate(redirectTo);
      }
    } catch (err) {
      const c = err.errors?.[0]?.code;
      if (c === 'form_password_incorrect' || c === 'form_identifier_not_found') {
        setAlert({ type: 'error', title: 'Credenciales incorrectas', msg: 'El email o la contraseña no coinciden.' });
      } else {
        setAlert({ type: 'error', title: 'Error', msg: err.errors?.[0]?.message ?? err.message });
      }
    } finally { setLoading(false); }
  }

  async function handleSignup(e) {
    e.preventDefault(); setAlert(null);
    if (!validate()) return;
    setLoading(true);
    try {
      const [firstName, ...rest] = name.trim().split(' ');
      await signUp.create({ emailAddress: email, password, firstName, lastName: rest.join(' ') || undefined });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setVerifying(true);
      setAlert({ type: 'success', title: 'Correo enviado', msg: `Hemos enviado un código a ${email}.` });
    } catch (err) {
      const c = err.errors?.[0]?.code;
      if (c === 'form_identifier_exists') {
        setAlert({ type: 'error', title: 'Email ya registrado', msg: 'Prueba a iniciar sesión.' });
      } else {
        setAlert({ type: 'error', title: 'Error', msg: err.errors?.[0]?.message ?? err.message });
      }
    } finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault(); setAlert(null);
    if (!code.trim()) { setErrors({ code: 'Introduce el código.' }); return; }
    setLoading(true);
    try {
      const res = await signUp.attemptEmailAddressVerification({ code });
      if (res.status === 'complete') {
        await setSignUpActive({ session: res.createdSessionId });
        navigate(redirectTo);
      }
    } catch (err) {
      setAlert({ type: 'error', title: 'Código incorrecto', msg: err.errors?.[0]?.message ?? 'Código no válido.' });
    } finally { setLoading(false); }
  }

  return (
    <AuthUI
      mode={mode} switchMode={switchMode}
      name={name} setName={setName}
      email={email} setEmail={setEmail}
      password={password} setPassword={setPassword}
      showPwd={showPwd} setShowPwd={setShowPwd}
      remember={remember} setRemember={setRemember}
      verifying={verifying} code={code} setCode={setCode}
      loading={loading} errors={errors} alert={alert}
      isReady={siLoaded && suLoaded}
      onLogin={handleLogin} onSignup={handleSignup}
      onVerify={handleVerify} onOAuth={handleOAuth}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * AuthFallback — shown when CLERK_ENABLED is false; no Clerk hooks
 * ───────────────────────────────────────────────────────────────────────── */
function AuthFallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login');

  function switchMode(m) {
    setMode(m);
    navigate(`/auth${m === 'signup' ? '?mode=signup' : ''}`, { replace: true });
  }

  return (
    <AuthUI
      mode={mode} switchMode={switchMode}
      name="" setName={() => {}} email="" setEmail={() => {}
      } password="" setPassword={() => {}}
      showPwd={false} setShowPwd={() => {}}
      remember={true} setRemember={() => {}}
      verifying={false} code="" setCode={() => {}}
      loading={false} errors={{}}
      alert={{ type: 'info', title: 'Auth no configurada', msg: 'Clerk no está activo en este entorno de despliegue.' }}
      isReady={false}
      onLogin={e => e.preventDefault()}
      onSignup={e => e.preventDefault()}
      onVerify={e => e.preventDefault()}
      onOAuth={() => {}}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * AuthUI — pure presentational; shared by both variants
 * ───────────────────────────────────────────────────────────────────────── */
function AuthUI({
  mode, switchMode,
  name, setName, email, setEmail, password, setPassword,
  showPwd, setShowPwd, remember, setRemember,
  verifying, code, setCode,
  loading, errors, alert, isReady,
  onLogin, onSignup, onVerify, onOAuth,
}) {
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

          <h1 className="auth-title">
            {verifying ? 'Verifica tu email' : mode === 'login' ? 'Bienvenido de vuelta' : 'Crea tu cuenta Ledens'}
          </h1>
          <p className="auth-subtitle">
            {verifying
              ? `Introduce el código de 6 dígitos que enviamos a ${email}.`
              : mode === 'login'
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

          {verifying ? (
            <form onSubmit={onVerify} noValidate>
              <div className={`auth-field${errors.code ? ' invalid' : ''}`}>
                <label htmlFor="verify-code">Código de verificación</label>
                <div className="auth-field-input">
                  <input id="verify-code" type="text" inputMode="numeric" maxLength={6}
                    placeholder="000000" autoComplete="one-time-code"
                    value={code} onChange={e => setCode(e.target.value)} />
                </div>
                {errors.code && <div className="auth-field-error"><i className="ri-error-warning-line"></i> {errors.code}</div>}
              </div>
              <button type="submit" className="auth-submit" disabled={loading || !isReady}>
                {loading ? <span className="auth-spinner"></span> : <span>Verificar email</span>}
              </button>
            </form>
          ) : (
            <>
              <div className="auth-social">
                <button className="auth-btn-social" type="button" onClick={() => onOAuth('google')}>
                  <GoogleIcon /> Continuar con Google
                </button>
                <button className="auth-btn-social" type="button" onClick={() => onOAuth('microsoft')}>
                  <MicrosoftIcon /> Continuar con Microsoft
                </button>
              </div>
              <div className="auth-divider"><span>o</span></div>

              <form onSubmit={mode === 'login' ? onLogin : onSignup} noValidate>
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

                <button type="submit" className="auth-submit" disabled={loading || !isReady}>
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ─── Export ─────────────────────────────────────────────────────────────── */
export default function AuthPage() {
  // AuthForm calls useSignIn / useSignUp which require ClerkProvider.
  // AuthFallback is a pure React component with no Clerk dependency.
  // We decide which to render at module level (build-time constant).
  return CLERK_ENABLED ? <AuthForm /> : <AuthFallback />;
}
