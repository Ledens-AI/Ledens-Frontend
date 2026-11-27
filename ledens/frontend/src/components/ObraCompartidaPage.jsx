import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, useT } from '../i18n/I18nContext.jsx';
import { apiErrorText } from '../i18n/apiErrors.js';
import LangSwitch from '../i18n/LangSwitch.jsx';
import logo from '../assets/logo-ledens-isotype.png';

/* /obra-compartida#<token> — a link to share an obra, made with «Compartir»
 * in «Usuarios con acceso» (backend: invitaciones/acceso.js). Whoever opens
 * it creates an account here, logs in (password, Google or Microsoft) or uses
 * the session they have, and joins the obra as a read-only client; then lands
 * on /plataforma. Like /invitacion, the token travels in the fragment (never
 * sent to a server), is kept in sessionStorage for the Google/Microsoft round
 * trip (?destino=obra brings the person back here, which then joins), taken
 * out of the address bar and only ever sent in POST bodies. */
const TOKEN_KEY = 'ledens.obraCompartida.v1';
const JOIN_KEY = 'ledens.obraCompartida.unirse';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const kept = (key) => ({
  get: () => { try { return sessionStorage.getItem(key); } catch { return null; } },
  set: (v) => { try { sessionStorage.setItem(key, v); } catch { /* not kept: the link still works once */ } },
  clear: () => { try { sessionStorage.removeItem(key); } catch { /* nothing kept */ } },
});
const store = kept(TOKEN_KEY), joinAfterLogin = kept(JOIN_KEY);

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
    loading: 'Comprobando el enlace…',
    artTitle: <>Sigue la obra <em>en tiempo real</em>.</>,
    artBody: 'Presupuesto, avance de cada partida, lo cobrado, fotos y documentos: todo en tu área de cliente.',
    artFoot: '© 2026 Ledens · Reformas inteligentes · Málaga',
    home: 'Ir a la web',
    title: 'Te han compartido una obra',
    intro: (by, obra) => <>{by ? <><strong>{by}</strong>, de Ledens, te ha compartido</> : 'Te han compartido'} la obra <strong>«{obra}»</strong>.</>,
    readOnly: 'Podrás seguirla desde tu área de cliente en modo de solo lectura: el presupuesto, el avance de cada partida, lo cobrado, las fotos y los documentos.',
    expires: (d) => `El enlace caduca el ${d}.`,
    member: 'Ya tienes acceso a esta obra.',
    goPlatform: 'Ir a mi área de cliente',
    asSession: (email) => <>Has iniciado sesión como <strong>{email}</strong>.</>,
    join: 'Seguir esta obra',
    otherAccount: 'Usar otra cuenta',
    staff: (email) => `Has iniciado sesión como ${email}, una cuenta del equipo de Ledens. Este enlace es para clientes: cierra sesión para entrar con la cuenta del cliente.`,
    logout: 'Cerrar sesión',
    google: 'Continuar con Google', microsoft: 'Continuar con Microsoft',
    or: 'o',
    tabNew: 'Crear cuenta', tabLogin: 'Ya tengo cuenta',
    name: 'Nombre y apellidos', namePh: 'Tu nombre',
    email: 'Email', emailPh: 'tu@correo.es',
    password: 'Contraseña', pwdPh: 'Mínimo 8 caracteres', confirm: 'Repite la contraseña', showPwd: 'Mostrar contraseña',
    errName: 'Escribe tu nombre.', errEmail: 'Introduce un email válido.', errShort: 'La contraseña debe tener al menos 8 caracteres.', errMatch: 'Las contraseñas no coinciden.',
    create: 'Crear cuenta y seguir la obra',
    login: 'Entrar y seguir la obra',
    forgot: '¿No tienes contraseña o la has olvidado?',
    exists: 'Ese email ya tiene cuenta. Entra con ella en «Ya tengo cuenta».',
    terms: <>Al continuar aceptas los <Link to="/terminos">Términos</Link> y la <Link to="/privacidad">Política de privacidad</Link> de Ledens.</>,
    failed: 'No se ha podido continuar', tryAgain: 'Inténtalo de nuevo.',
    net: 'No se pudo contactar con el servidor. Inténtalo de nuevo.',
    invalidTitle: 'Enlace no válido',
    invalid: 'El enlace para compartir la obra no es válido, ha caducado o se ha revocado. Pide uno nuevo a quien te lo envió.',
    noToken: 'Abre el enlace completo que te enviaron. Si ya lo usaste, inicia sesión para ver la obra.',
    goLogin: 'Iniciar sesión',
    heldTitle: 'Confirma tu email para ver la obra',
    held: (email) => `Ya sigues la obra, pero antes de mostrártela tenemos que confirmar que ${email} es tuyo: entra con Google o Microsoft con ese email, o pide un enlace para crear tu contraseña y ábrelo desde tu correo.`,
    heldLink: 'Recibir el enlace por email',
    errors: {
      cuenta_equipo: 'Has entrado con una cuenta del equipo de Ledens: este enlace es para clientes.',
      google_cancelled: 'Has cancelado el inicio de sesión con Google.',
      google_failed: 'No se pudo iniciar sesión con Google. Inténtalo de nuevo.',
      microsoft_cancelled: 'Has cancelado el inicio de sesión con Microsoft.',
      microsoft_failed: 'No se pudo iniciar sesión con Microsoft. Inténtalo de nuevo.',
      google_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso.',
      microsoft_email_in_use: 'Ese email ya tiene una cuenta con otro método de acceso.',
    },
  },
  en: {
    loading: 'Checking the link…',
    artTitle: <>Follow the project <em>as it happens</em>.</>,
    artBody: 'Quote, progress of every item, payments, photos and documents: all in your client area.',
    artFoot: '© 2026 Ledens · Smart renovations · Málaga',
    home: 'Go to the website',
    title: 'A project has been shared with you',
    intro: (by, obra) => <>{by ? <><strong>{by}</strong> from Ledens has shared</> : 'Someone has shared'} the project <strong>“{obra}”</strong> with you.</>,
    readOnly: 'You can follow it from your client area in read-only mode: the quote, the progress of every item, what has been paid, the photos and the documents.',
    expires: (d) => `The link expires on ${d}.`,
    member: 'You already have access to this project.',
    goPlatform: 'Open my client area',
    asSession: (email) => <>You are logged in as <strong>{email}</strong>.</>,
    join: 'Follow this project',
    otherAccount: 'Use another account',
    staff: (email) => `You are logged in as ${email}, a Ledens team account. This link is for clients: log out to continue with the client’s account.`,
    logout: 'Log out',
    google: 'Continue with Google', microsoft: 'Continue with Microsoft',
    or: 'or',
    tabNew: 'Create account', tabLogin: 'I have an account',
    name: 'Full name', namePh: 'Your name',
    email: 'Email', emailPh: 'you@email.com',
    password: 'Password', pwdPh: 'At least 8 characters', confirm: 'Repeat the password', showPwd: 'Show password',
    errName: 'Please enter your name.', errEmail: 'Please enter a valid email.', errShort: 'The password must be at least 8 characters long.', errMatch: 'The passwords don’t match.',
    create: 'Create account and follow the project',
    login: 'Log in and follow the project',
    forgot: 'No password, or forgot it?',
    exists: 'That email already has an account. Log in with it under “I have an account”.',
    terms: <>By continuing you accept Ledens’ <Link to="/terminos">Terms</Link> and <Link to="/privacidad">Privacy policy</Link>.</>,
    failed: 'Could not continue', tryAgain: 'Please try again.',
    net: 'Could not reach the server. Please try again.',
    invalidTitle: 'Invalid link',
    invalid: 'The link to share this project is not valid, has expired or has been revoked. Ask whoever sent it for a new one.',
    noToken: 'Open the full link you were sent. If you have already used it, log in to see the project.',
    goLogin: 'Log in',
    heldTitle: 'Confirm your email to see the project',
    held: (email) => `You now follow the project, but before we show it we need to confirm that ${email} is yours: sign in with Google or Microsoft with that email, or ask for a link to create your password and open it from your inbox.`,
    heldLink: 'Get the link by email',
    errors: {
      cuenta_equipo: 'You are signed in with a Ledens team account: this link is for clients.',
      google_cancelled: 'You cancelled signing in with Google.',
      google_failed: 'Could not sign in with Google. Please try again.',
      microsoft_cancelled: 'You cancelled signing in with Microsoft.',
      microsoft_failed: 'Could not sign in with Microsoft. Please try again.',
      google_email_in_use: 'That email already has an account with a different sign-in method.',
      microsoft_email_in_use: 'That email already has an account with a different sign-in method.',
    },
  },
};

// POST with a JSON body; errors keep the backend's text and code.
async function post(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('net'), { net: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || ''), { status: res.status, code: data.code, api: data.error });
  return data;
}
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default function ObraCompartidaPage() {
  const navigate = useNavigate();
  const { hash, pathname } = useLocation();
  const [params] = useSearchParams();
  const { refresh, logout } = useAuth();
  const { lang, fmtDate } = useI18n();
  const t = useT(TXT);

  // The fragment wins (a newer link); otherwise the one kept in this tab.
  const [token] = useState(() => {
    const h = (hash || '').replace(/^#/, '');
    return TOKEN_RE.test(h) ? h : store.get();
  });
  const [info, setInfo] = useState(null);
  const [fatal, setFatal] = useState(null); // 'invalid' | 'noToken' | 'net' | 'other'
  const [alert, setAlert] = useState(() => (params.get('error') ? { code: params.get('error') } : null));
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(null); // the email to confirm, after joining with an unproven one
  const [mode, setMode] = useState('new');
  const [form, setForm] = useState({ name: '', email: '', pwd: '', pwd2: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [fieldError, setFieldError] = useState(null); // { field, key }
  const autoJoined = useRef(false);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer'; meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    if (token) store.set(token);
    if (hash || params.get('error')) navigate(pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const consult = useCallback(async () => {
    if (!token) { setFatal('noToken'); return null; }
    try {
      const d = await post('/api/invitaciones/enlace/consultar', { token });
      setInfo(d); setFatal(null);
      return d;
    } catch (e) {
      if (e.status === 410) { store.clear(); joinAfterLogin.clear(); setFatal('invalid'); } else {
        setFatal(e.net ? 'net' : 'other');
        if (!e.net) setAlert({ api: e.api });
      }
      return null;
    }
  }, [token]);

  const finish = async (r, email) => {
    store.clear(); joinAfterLogin.clear();
    await refresh();
    if (r.held) setHeld(email || info?.session?.email || '');
    else navigate('/plataforma', { replace: true });
  };
  const run = async (fn) => {
    setBusy(true); setAlert(null);
    try { await fn(); } catch (e) {
      if (e.status === 410) { store.clear(); joinAfterLogin.clear(); setFatal('invalid'); } else setAlert(e.net ? { net: true } : { code: e.code, api: e.api });
    }
    setBusy(false);
  };
  const join = (email) => run(async () => finish(await post('/api/invitaciones/enlace/unirse', { token }), email));

  // Back from Google/Microsoft (?destino=obra): join with the account just opened.
  useEffect(() => {
    consult().then((d) => {
      if (!d || autoJoined.current || joinAfterLogin.get() !== '1') return;
      autoJoined.current = true;
      joinAfterLogin.clear();
      if (d.session?.client && !d.session.member) join(d.session.email);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consult]);

  const withProvider = (provider) => {
    joinAfterLogin.set('1');
    window.location.assign(`/api/auth/${provider}?destino=obra`);
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (mode === 'new' && !form.name.trim()) return setFieldError({ field: 'name', key: 'errName' });
    if (!isEmail(email)) return setFieldError({ field: 'email', key: 'errEmail' });
    if (form.pwd.length < 8) return setFieldError({ field: 'pwd', key: 'errShort' });
    if (mode === 'new' && form.pwd !== form.pwd2) return setFieldError({ field: 'pwd2', key: 'errMatch' });
    setFieldError(null);
    run(async () => {
      try {
        await post(mode === 'new' ? '/api/auth/register' : '/api/auth/login', mode === 'new' ? { name: form.name.trim(), email, password: form.pwd } : { email, password: form.pwd });
      } catch (err) {
        if (mode === 'new' && err.status === 409) { setMode('login'); throw Object.assign(new Error(''), { code: 'exists' }); }
        throw err;
      }
      await finish(await post('/api/invitaciones/enlace/unirse', { token }), email);
    });
  };
  const signOut = () => run(async () => { await logout(); await consult(); });

  const alertText = alert && (
    alert.net ? t.net
    : alert.code === 'exists' ? t.exists
    : alert.code && t.errors[alert.code] ? t.errors[alert.code]
    : alert.api ? apiErrorText(alert.api, lang, t.tryAgain)
    : t.tryAgain
  );
  const field = (k, labelText, input) => (
    <div className={`auth-field${fieldError?.field === k ? ' invalid' : ''}`}>
      <label htmlFor={`oc-${k}`}>{labelText}</label>
      {input}
      {fieldError?.field === k ? <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[fieldError.key]}</div> : null}
    </div>
  );
  const primaryLink = (to, text) => <Link className="auth-submit" to={to} style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}>{text}</Link>;

  let body;
  if (held !== null) {
    body = (
      <>
        <h1 className="auth-title">{t.heldTitle}</h1>
        <p className="auth-subtitle">{t.held(held)}</p>
        <Link className="auth-submit" to="/contrasena" state={{ email: held }} style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}>{t.heldLink}</Link>
      </>
    );
  } else if (fatal === 'invalid' || fatal === 'noToken') {
    body = (
      <>
        <h1 className="auth-title">{t.invalidTitle}</h1>
        <p className="auth-subtitle">{fatal === 'invalid' ? t.invalid : t.noToken}</p>
        {primaryLink('/auth?redirect=/plataforma', t.goLogin)}
      </>
    );
  } else if (!info) {
    body = fatal ? (
      <>
        <h1 className="auth-title">{t.failed}</h1>
        {fatal === 'net' ? <p className="auth-subtitle">{t.net}</p> : null}
        <button type="button" className="auth-submit" onClick={() => { setFatal(null); setAlert(null); consult(); }}>{t.tryAgain}</button>
      </>
    ) : <p className="auth-subtitle">{t.loading}</p>;
  } else {
    const s = info.session;
    const social = info.providers?.google || info.providers?.microsoft;
    body = (
      <>
        <h1 className="auth-title">{t.title}</h1>
        <p className="auth-subtitle">{t.intro(info.sharedBy, info.obra)}</p>
        <p className="auth-subtitle" style={{ marginTop: -8 }}>{t.readOnly} {t.expires(fmtDate(info.expiresAt, { day: 'numeric', month: 'long', year: 'numeric' }))}</p>

        {s?.member ? (
          <>
            <div className="auth-alert auth-alert--info"><i className="ri-checkbox-circle-line"></i><div>{t.member}</div></div>
            <button type="button" className="auth-submit" onClick={() => { store.clear(); navigate('/plataforma', { replace: true }); }}>{t.goPlatform}</button>
          </>
        ) : s?.client ? (
          <>
            <p className="auth-subtitle">{t.asSession(s.email)}</p>
            <button type="button" className="auth-submit" disabled={busy} onClick={() => join(s.email)}>
              {busy ? <span className="auth-spinner"></span> : <span>{t.join}</span>}
            </button>
            <button type="button" className="auth-btn-social" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} disabled={busy} onClick={signOut}>{t.otherAccount}</button>
          </>
        ) : s ? (
          <>
            <div className="auth-alert auth-alert--info"><i className="ri-information-line"></i><div>{t.staff(s.email)}</div></div>
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
                <div className="auth-divider"><span>{t.or}</span></div>
              </>
            ) : null}
            <div className="auth-tabs" role="tablist">
              {[['new', t.tabNew], ['login', t.tabLogin]].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k} className={`auth-tab${mode === k ? ' active' : ''}`}
                  onClick={() => { setMode(k); setFieldError(null); setAlert(null); }}>{l}</button>
              ))}
            </div>
            <form onSubmit={submit} noValidate>
              {mode === 'new' ? field('name', t.name, <div className="auth-field-input"><input id="oc-name" autoComplete="name" placeholder={t.namePh} value={form.name} onChange={set('name')} /></div>) : null}
              {field('email', t.email, <div className="auth-field-input"><input id="oc-email" type="email" autoComplete={mode === 'new' ? 'email' : 'username'} placeholder={t.emailPh} value={form.email} onChange={set('email')} /></div>)}
              {field('pwd', t.password, (
                <div className="auth-field-input auth-field-input--icon">
                  <input id="oc-pwd" type={showPwd ? 'text' : 'password'} placeholder={t.pwdPh} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={form.pwd} onChange={set('pwd')} />
                  <button type="button" className="auth-toggle-pwd" aria-label={t.showPwd} onClick={() => setShowPwd((v) => !v)}><i className={showPwd ? 'ri-eye-off-line' : 'ri-eye-line'}></i></button>
                </div>
              ))}
              {mode === 'new' ? field('pwd2', t.confirm, <div className="auth-field-input"><input id="oc-pwd2" type={showPwd ? 'text' : 'password'} autoComplete="new-password" value={form.pwd2} onChange={set('pwd2')} /></div>) : null}
              <button type="submit" className="auth-submit" disabled={busy}>
                {busy ? <span className="auth-spinner"></span> : <span>{mode === 'new' ? t.create : t.login}</span>}
              </button>
              {mode === 'login' ? <p className="auth-terms" style={{ marginTop: 12 }}><Link to="/contrasena" state={{ email: form.email.trim() }}>{t.forgot}</Link></p> : null}
            </form>
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
