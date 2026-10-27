import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, useT } from '../i18n/I18nContext.jsx';
import { apiErrorText } from '../i18n/apiErrors.js';
import LangSwitch from '../i18n/LangSwitch.jsx';
import logo from '../assets/logo-ledens-isotype.png';

/* /invitacion#<token> — the link of a client invitation (backend:
 * routes/invitaciones.js). The token travels in the fragment, which browsers
 * never send to a server; the page keeps it in sessionStorage (so a Google /
 * Microsoft round trip or a detour through /auth can come back to it), takes
 * it out of the address bar and sends it only in POST bodies. The person gets
 * in with Google or Microsoft on the invited email, by creating a password, or
 * with the session they already have; then lands on /plataforma. */
const TOKEN_KEY = 'ledens.invitacion.v1';
const LANG_KEY = 'ledens.lang.v1';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v) => { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* not kept: the link still works once */ } },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nothing kept */ } },
};

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" style={{ flexShrink: 0 }} aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.3-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 43.5c5.5 0 10.4-2 14.1-5.4l-6.5-5.5c-2 1.4-4.6 2.4-7.6 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39 16.2 43.5 24 43.5z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5c-.5.4 6.7-4.9 6.7-15 0-1.2-.1-2.4-.3-3.5z"/>
  </svg>
);
const MicrosoftIcon = () => (
  <svg viewBox="0 0 23 23" width="20" height="20" style={{ flexShrink: 0 }} aria-hidden="true">
    <path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M12 1h10v10H12z"/>
    <path fill="#00A4EF" d="M1 12h10v10H1z"/><path fill="#FFB900" d="M12 12h10v10H12z"/>
  </svg>
);

const TXT = {
  es: {
    loading: 'Comprobando tu invitación…',
    artTitle: <>Sigue tu obra <em>en tiempo real</em>.</>,
    artBody: 'Presupuesto, avance de cada partida, fotos y documentos: todo en tu área de cliente.',
    artFoot: '© 2026 Ledens · Reformas inteligentes · Málaga',
    home: 'Ir a la web',
    title: 'Tu invitación a Ledens',
    intro: (by, obra) => <>{by ? <><strong>{by}</strong> te invita</> : 'Te invitan'} a seguir la obra <strong>«{obra}»</strong> en tu área de cliente.</>,
    forEmail: (email) => <>Invitación para <strong>{email}</strong>.</>,
    expires: (d) => `El enlace caduca el ${d}.`,
    sessionMatch: (email) => `Ya has iniciado sesión como ${email}.`,
    acceptSession: 'Aceptar e ir a mi obra',
    sessionOther: (email) => `Has iniciado sesión como ${email}, que no es el email de la invitación. Cierra sesión para continuar.`,
    logout: 'Cerrar sesión',
    google: 'Continuar con Google', microsoft: 'Continuar con Microsoft',
    socialHint: (email) => `Usa la cuenta de Google o Microsoft de ${email}.`,
    or: 'o',
    hasPassword: 'Esta cuenta ya tiene contraseña.',
    loginWith: 'Iniciar sesión con mi contraseña',
    createTitle: 'Crea tu contraseña',
    password: 'Contraseña', pwdPh: 'Mínimo 8 caracteres', confirm: 'Repite la contraseña', showPwd: 'Mostrar contraseña',
    errShort: 'La contraseña debe tener al menos 8 caracteres.', errMatch: 'Las contraseñas no coinciden.',
    create: 'Crear contraseña y entrar',
    terms: <>Al entrar aceptas los <Link to="/terminos">Términos</Link> y la <Link to="/privacidad">Política de privacidad</Link> de Ledens.</>,
    failed: 'No se ha podido continuar', tryAgain: 'Inténtalo de nuevo.',
    net: 'No se pudo contactar con el servidor. Inténtalo de nuevo.',
    invalidTitle: 'Enlace no válido',
    invalid: 'El enlace de invitación no es válido o ha caducado. Pide a tu contacto en Ledens que te envíe uno nuevo.',
    noToken: 'Abre el enlace completo del correo de invitación. Si ya lo usaste, inicia sesión.',
    goLogin: 'Iniciar sesión',
    errors: {
      otro_email: 'Has entrado con una cuenta de otro email. Usa la cuenta del email al que se envió la invitación.',
      google_cancelled: 'Has cancelado el inicio de sesión con Google.',
      google_failed: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
      microsoft_cancelled: 'Has cancelado el inicio de sesión con Microsoft.',
      microsoft_failed: 'No se pudo iniciar sesión con Microsoft. Inténtalo de nuevo.',
      google_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso.',
      microsoft_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso.',
    },
  },
  en: {
    loading: 'Checking your invitation…',
    artTitle: <>Follow your project <em>as it happens</em>.</>,
    artBody: 'Quote, progress of every item, photos and documents: all in your client area.',
    artFoot: '© 2026 Ledens · Smart renovations · Málaga',
    home: 'Go to the website',
    title: 'Your invitation to Ledens',
    intro: (by, obra) => <>{by ? <><strong>{by}</strong> invites you</> : 'You are invited'} to follow the project <strong>“{obra}”</strong> in your client area.</>,
    forEmail: (email) => <>Invitation for <strong>{email}</strong>.</>,
    expires: (d) => `The link expires on ${d}.`,
    sessionMatch: (email) => `You are already logged in as ${email}.`,
    acceptSession: 'Accept and open my project',
    sessionOther: (email) => `You are logged in as ${email}, which is not the invited email. Log out to continue.`,
    logout: 'Log out',
    google: 'Continue with Google', microsoft: 'Continue with Microsoft',
    socialHint: (email) => `Use the Google or Microsoft account of ${email}.`,
    or: 'or',
    hasPassword: 'This account already has a password.',
    loginWith: 'Log in with my password',
    createTitle: 'Create your password',
    password: 'Password', pwdPh: 'At least 8 characters', confirm: 'Repeat the password', showPwd: 'Show password',
    errShort: 'The password must be at least 8 characters long.', errMatch: 'The passwords don’t match.',
    create: 'Create password and continue',
    terms: <>By continuing you accept Ledens’ <Link to="/terminos">Terms</Link> and <Link to="/privacidad">Privacy policy</Link>.</>,
    failed: 'Could not continue', tryAgain: 'Please try again.',
    net: 'Could not reach the server. Please try again.',
    invalidTitle: 'Invalid link',
    invalid: 'The invitation link is not valid or has expired. Ask your contact at Ledens to send you a new one.',
    noToken: 'Open the full link in the invitation email. If you have already used it, log in.',
    goLogin: 'Log in',
    errors: {
      otro_email: 'You signed in with an account of a different email. Use the account of the email the invitation was sent to.',
      google_cancelled: 'You cancelled signing in with Google.',
      google_failed: 'Could not sign in with Google. Please try again.',
      microsoft_cancelled: 'You cancelled signing in with Microsoft.',
      microsoft_failed: 'Could not sign in with Microsoft. Please try again.',
      google_email_in_use: 'That email already has an account with a different sign-in method.',
      microsoft_email_in_use: 'That email already has an account with a different sign-in method.',
    },
  },
};

// POST to /api/invitaciones/aceptacion/*; errors keep the backend's code.
async function call(path, body) {
  let res;
  try {
    res = await fetch(`/api/invitaciones/aceptacion/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('net'), { net: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || ''), { status: res.status, code: data.code, api: data.error });
  return data;
}

export default function InvitacionPage() {
  const navigate = useNavigate();
  const { hash, pathname } = useLocation();
  const [params] = useSearchParams();
  const { refresh, logout } = useAuth();
  const { lang, setLang, fmtDate } = useI18n();
  const t = useT(TXT);

  // The fragment wins (a newer link); otherwise the one kept in this tab.
  const [token] = useState(() => {
    const h = (hash || '').replace(/^#/, '');
    return TOKEN_RE.test(h) ? h : store.get();
  });
  const [info, setInfo] = useState(null);
  const [fatal, setFatal] = useState(null); // 'invalid' | 'noToken' | 'net'
  const [alert, setAlert] = useState(() => (params.get('error') ? { code: params.get('error') } : null));
  const [busy, setBusy] = useState(false);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [fieldError, setFieldError] = useState('');

  // Nothing of this page goes out in a Referer (the token is in the fragment
  // anyway, but links on the page should not tell where they came from).
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer'; meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  // Keep the token for this tab and take it (and ?error=) out of the address bar.
  useEffect(() => {
    if (token) store.set(token);
    if (hash || params.get('error')) navigate(pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const consult = useCallback(async () => {
    if (!token) { setFatal('noToken'); return; }
    try {
      const d = await call('consultar', { token });
      setInfo(d); setFatal(null);
      // The language of the email, unless the person already chose one.
      let saved = null;
      try { saved = localStorage.getItem(LANG_KEY); } catch { /* no storage */ }
      if (!saved && d.lang && d.lang !== lang) setLang(d.lang);
    } catch (e) {
      if (e.status === 410) { store.clear(); setFatal('invalid'); } else setFatal(e.net ? 'net' : 'other');
      if (!e.net && e.status !== 410) setAlert({ api: e.api });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { consult(); }, [consult]);

  const done = async () => {
    store.clear();
    await refresh();
    navigate('/plataforma', { replace: true });
  };
  const run = async (fn) => {
    setBusy(true); setAlert(null);
    try { await fn(); } catch (e) {
      if (e.status === 410) { store.clear(); setFatal('invalid'); } else setAlert(e.net ? { net: true } : { code: e.code, api: e.api });
    }
    setBusy(false);
  };

  const withSession = () => run(async () => { await call('sesion', { token }); await done(); });
  const withProvider = (provider) => run(async () => {
    const { url } = await call('proveedor', { token, provider });
    window.location.assign(url);
  });
  const withPassword = (e) => {
    e.preventDefault();
    if (pwd.length < 8) return setFieldError('errShort');
    if (pwd !== pwd2) return setFieldError('errMatch');
    setFieldError('');
    run(async () => { await call('contrasena', { token, password: pwd }); await done(); });
  };
  const signOut = () => run(async () => { await logout(); await consult(); });

  const alertText = alert && (
    alert.net ? t.net
    : alert.code && t.errors[alert.code] ? t.errors[alert.code]
    : alert.api ? apiErrorText(alert.api, lang, t.tryAgain)
    : t.tryAgain
  );

  let body;
  if (fatal === 'invalid' || fatal === 'noToken') {
    body = (
      <>
        <h1 className="auth-title">{t.invalidTitle}</h1>
        <p className="auth-subtitle">{fatal === 'invalid' ? t.invalid : t.noToken}</p>
        <Link className="auth-submit" to="/auth?redirect=/plataforma" style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}>{t.goLogin}</Link>
      </>
    );
  } else if (!info) {
    body = fatal ? (
      <>
        <h1 className="auth-title">{t.failed}</h1>
        <p className="auth-subtitle">{t.net}</p>
        <button type="button" className="auth-submit" onClick={() => { setFatal(null); setAlert(null); consult(); }}>{t.tryAgain}</button>
      </>
    ) : <p className="auth-subtitle">{t.loading}</p>;
  } else {
    const s = info.session;
    const social = info.providers?.google || info.providers?.microsoft;
    body = (
      <>
        <h1 className="auth-title">{t.title}</h1>
        <p className="auth-subtitle">{t.intro(info.invitedBy, info.obra)}</p>
        <p className="auth-subtitle" style={{ marginTop: -8 }}>{t.forEmail(info.email)} {t.expires(fmtDate(info.expiresAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</p>

        {s?.matches ? (
          <>
            <p className="auth-subtitle">{t.sessionMatch(s.email)}</p>
            <button type="button" className="auth-submit" disabled={busy} onClick={withSession}>
              {busy ? <span className="auth-spinner"></span> : <span>{t.acceptSession}</span>}
            </button>
          </>
        ) : s ? (
          <>
            <div className="auth-alert auth-alert--info"><i className="ri-information-line"></i><div>{t.sessionOther(s.email)}</div></div>
            <button type="button" className="auth-submit" disabled={busy} onClick={signOut}>{t.logout}</button>
          </>
        ) : (
          <>
            {social ? (
              <>
                <div className="auth-social">
                  {info.providers.google ? <button type="button" className="auth-btn-social" disabled={busy} onClick={() => withProvider('google')}><GoogleIcon /> {t.google}</button> : null}
                  {info.providers.microsoft ? <button type="button" className="auth-btn-social" disabled={busy} onClick={() => withProvider('microsoft')}><MicrosoftIcon /> {t.microsoft}</button> : null}
                </div>
                <p className="auth-terms" style={{ marginTop: 8 }}>{t.socialHint(info.email)}</p>
                <div className="auth-divider"><span>{t.or}</span></div>
              </>
            ) : null}
            {info.hasPassword ? (
              <>
                <p className="auth-subtitle">{t.hasPassword}</p>
                <Link className="auth-submit" to="/auth?redirect=/invitacion" style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}>{t.loginWith}</Link>
              </>
            ) : (
              <form onSubmit={withPassword} noValidate>
                <h2 className="auth-subtitle" style={{ fontWeight: 600, color: 'inherit' }}>{t.createTitle}</h2>
                <input type="email" autoComplete="username" value={info.email} readOnly hidden />
                <div className={`auth-field${fieldError === 'errShort' ? ' invalid' : ''}`}>
                  <label htmlFor="inv-pwd">{t.password}</label>
                  <div className="auth-field-input auth-field-input--icon">
                    <input id="inv-pwd" type={showPwd ? 'text' : 'password'} placeholder={t.pwdPh} autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
                    <button type="button" className="auth-toggle-pwd" aria-label={t.showPwd} onClick={() => setShowPwd((v) => !v)}><i className={showPwd ? 'ri-eye-off-line' : 'ri-eye-line'}></i></button>
                  </div>
                </div>
                <div className={`auth-field${fieldError === 'errMatch' ? ' invalid' : ''}`}>
                  <label htmlFor="inv-pwd2">{t.confirm}</label>
                  <div className="auth-field-input">
                    <input id="inv-pwd2" type={showPwd ? 'text' : 'password'} autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
                  </div>
                  {fieldError ? <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[fieldError]}</div> : null}
                </div>
                <button type="submit" className="auth-submit" disabled={busy}>
                  {busy ? <span className="auth-spinner"></span> : <span>{t.create}</span>}
                </button>
              </form>
            )}
            <p className="auth-terms">{t.terms}</p>
          </>
        )}
      </>
    );
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-art">
        <Link to="/" className="auth-art-logo"><img src={logo} alt="Ledens" /><span>Ledens</span></Link>
        <div className="auth-art-body">
          <h2>{t.artTitle}</h2>
          <p>{t.artBody}</p>
        </div>
        <div className="auth-art-foot">{t.artFoot}</div>
      </aside>
      <main className="auth-form-side">
        <div className="auth-card">
          <div className="auth-row-between" style={{ marginBottom: 24 }}>
            <Link to="/" className="auth-back" style={{ marginBottom: 0 }}><i className="ri-arrow-left-line"></i> {t.home}</Link>
            <LangSwitch />
          </div>
          {alert ? (
            <div className="auth-alert auth-alert--error">
              <i className="ri-error-warning-line"></i>
              <div><div className="auth-alert-title">{t.failed}</div><div>{alertText}</div></div>
            </div>
          ) : null}
          {body}
        </div>
      </main>
    </div>
  );
}
