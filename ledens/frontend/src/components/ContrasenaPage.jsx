import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, useT } from '../i18n/I18nContext.jsx';
import { apiErrorText } from '../i18n/apiErrors.js';
import LangSwitch from '../i18n/LangSwitch.jsx';
import logo from '../assets/logo-ledens-isotype.png';

/* /contrasena — create or reset a password (backend: auth/passwordLinks.js).
 * Without a token: ask for the link by email (the answer never says whether
 * the account exists). With /contrasena#<token> (the link of the email): set
 * the new password and land in /plataforma. The token travels in the fragment,
 * which browsers never send to a server, and only in POST bodies. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const TXT = {
  es: {
    artTitle: <>Tu reforma, <em>bajo control</em>.</>,
    artBody: 'Presupuesto, avance de cada partida, fotos y documentos: todo en tu área de cliente.',
    artFoot: '© 2026 Ledens · Reformas inteligentes · Málaga',
    back: 'Volver a iniciar sesión',
    askTitle: 'Crea o restablece tu contraseña',
    askIntro: 'Escribe el email de tu cuenta y te enviaremos un enlace para crear una contraseña nueva. Sirve también si entrabas con Google o Microsoft, o si te invitó tu jefe de obra.',
    email: 'Email', emailPh: 'tu@correo.es', errEmail: 'Introduce un email válido.',
    send: 'Enviar enlace',
    sentTitle: 'Revisa tu correo',
    sent: (e) => `Si hay una cuenta con ${e}, te hemos enviado un enlace para crear la contraseña. Caduca en 2 horas. Si no lo ves en unos minutos, mira en el correo no deseado.`,
    loading: 'Comprobando el enlace…',
    setTitle: (reset) => (reset ? 'Restablece tu contraseña' : 'Crea tu contraseña'),
    forEmail: (e) => <>Para la cuenta <strong>{e}</strong>.</>,
    password: 'Contraseña nueva', pwdPh: 'Mínimo 8 caracteres', confirm: 'Repite la contraseña', showPwd: 'Mostrar contraseña',
    errShort: 'La contraseña debe tener al menos 8 caracteres.', errMatch: 'Las contraseñas no coinciden.',
    save: 'Guardar y entrar',
    invalidTitle: 'Enlace no válido',
    invalid: 'El enlace no es válido o ha caducado. Pide uno nuevo.',
    askAgain: 'Pedir un enlace nuevo',
    failed: 'No se ha podido continuar', tryAgain: 'Inténtalo de nuevo.',
    net: 'No se pudo contactar con el servidor. Inténtalo de nuevo.',
  },
  en: {
    artTitle: <>Your renovation, <em>under control</em>.</>,
    artBody: 'Quote, progress of every item, photos and documents: all in your client area.',
    artFoot: '© 2026 Ledens · Smart renovations · Málaga',
    back: 'Back to log in',
    askTitle: 'Create or reset your password',
    askIntro: 'Enter the email of your account and we’ll send you a link to create a new password. It also works if you used to sign in with Google or Microsoft, or if your site manager invited you.',
    email: 'Email', emailPh: 'you@email.com', errEmail: 'Please enter a valid email.',
    send: 'Send link',
    sentTitle: 'Check your email',
    sent: (e) => `If there is an account with ${e}, we’ve sent you a link to create the password. It expires in 2 hours. If you don’t see it in a few minutes, check your spam folder.`,
    loading: 'Checking the link…',
    setTitle: (reset) => (reset ? 'Reset your password' : 'Create your password'),
    forEmail: (e) => <>For the account <strong>{e}</strong>.</>,
    password: 'New password', pwdPh: 'At least 8 characters', confirm: 'Repeat the password', showPwd: 'Show password',
    errShort: 'The password must be at least 8 characters long.', errMatch: 'The passwords don’t match.',
    save: 'Save and continue',
    invalidTitle: 'Invalid link',
    invalid: 'The link is not valid or has expired. Ask for a new one.',
    askAgain: 'Ask for a new link',
    failed: 'Could not continue', tryAgain: 'Please try again.',
    net: 'Could not reach the server. Please try again.',
  },
};

async function call(path, body) {
  let res;
  try {
    res = await fetch(`/api/auth/contrasena/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('net'), { net: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || ''), { status: res.status, api: data.error });
  return data;
}

export default function ContrasenaPage() {
  const navigate = useNavigate();
  const { hash, state } = useLocation();
  const { refresh } = useAuth();
  const { lang } = useI18n();
  const t = useT(TXT);

  const [token, setToken] = useState(() => {
    const h = (hash || '').replace(/^#/, '');
    return TOKEN_RE.test(h) ? h : null;
  });
  const [info, setInfo] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(state?.email || '');
  const [sentTo, setSentTo] = useState(null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [fieldError, setFieldError] = useState('');

  // Nothing of this page goes out in a Referer, and the token leaves the address bar.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer'; meta.content = 'no-referrer';
    document.head.appendChild(meta);
    if (hash) navigate('/contrasena', { replace: true });
    return () => meta.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    call('consultar', { token }).then(setInfo, (e) => {
      if (e.status === 410) setInvalid(true);
      else setAlert(e.net ? { net: true } : { api: e.api });
    });
  }, [token]);

  const alertText = alert && (alert.net ? t.net : alert.api ? apiErrorText(alert.api, lang, t.tryAgain) : t.tryAgain);

  const ask = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setFieldError('errEmail');
    setFieldError(''); setBusy(true); setAlert(null);
    try { await call('solicitar', { email: value, lang }); setSentTo(value); } catch (err) { setAlert(err.net ? { net: true } : { api: err.api }); }
    setBusy(false);
  };
  const save = async (e) => {
    e.preventDefault();
    if (pwd.length < 8) return setFieldError('errShort');
    if (pwd !== pwd2) return setFieldError('errMatch');
    setFieldError(''); setBusy(true); setAlert(null);
    try {
      await call('establecer', { token, password: pwd });
      await refresh();
      navigate('/plataforma', { replace: true });
    } catch (err) {
      if (err.status === 410) setInvalid(true); else setAlert(err.net ? { net: true } : { api: err.api });
      setBusy(false);
    }
  };
  const restart = () => { setToken(null); setInfo(null); setInvalid(false); setAlert(null); };

  let body;
  if (token && invalid) {
    body = (
      <>
        <h1 className="auth-title">{t.invalidTitle}</h1>
        <p className="auth-subtitle">{t.invalid}</p>
        <button type="button" className="auth-submit" onClick={restart}>{t.askAgain}</button>
      </>
    );
  } else if (token) {
    body = !info ? <p className="auth-subtitle">{alert ? '' : t.loading}</p> : (
      <form onSubmit={save} noValidate>
        <h1 className="auth-title">{t.setTitle(info.hasPassword)}</h1>
        <p className="auth-subtitle">{t.forEmail(info.email)}</p>
        <input type="email" autoComplete="username" value={info.email} readOnly hidden />
        <div className={`auth-field${fieldError === 'errShort' ? ' invalid' : ''}`}>
          <label htmlFor="pwd-new">{t.password}</label>
          <div className="auth-field-input auth-field-input--icon">
            <input id="pwd-new" type={showPwd ? 'text' : 'password'} placeholder={t.pwdPh} autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            <button type="button" className="auth-toggle-pwd" aria-label={t.showPwd} onClick={() => setShowPwd((v) => !v)}><i className={showPwd ? 'ri-eye-off-line' : 'ri-eye-line'}></i></button>
          </div>
        </div>
        <div className={`auth-field${fieldError === 'errMatch' ? ' invalid' : ''}`}>
          <label htmlFor="pwd-new2">{t.confirm}</label>
          <div className="auth-field-input">
            <input id="pwd-new2" type={showPwd ? 'text' : 'password'} autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
          </div>
          {fieldError ? <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[fieldError]}</div> : null}
        </div>
        <button type="submit" className="auth-submit" disabled={busy}>{busy ? <span className="auth-spinner"></span> : <span>{t.save}</span>}</button>
      </form>
    );
  } else if (sentTo) {
    body = (
      <>
        <h1 className="auth-title">{t.sentTitle}</h1>
        <p className="auth-subtitle">{t.sent(sentTo)}</p>
      </>
    );
  } else {
    body = (
      <form onSubmit={ask} noValidate>
        <h1 className="auth-title">{t.askTitle}</h1>
        <p className="auth-subtitle">{t.askIntro}</p>
        <div className={`auth-field${fieldError ? ' invalid' : ''}`}>
          <label htmlFor="pwd-email">{t.email}</label>
          <div className="auth-field-input">
            <input id="pwd-email" type="email" placeholder={t.emailPh} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {fieldError ? <div className="auth-field-error"><i className="ri-error-warning-line"></i> {t[fieldError]}</div> : null}
        </div>
        <button type="submit" className="auth-submit" disabled={busy}>{busy ? <span className="auth-spinner"></span> : <span>{t.send}</span>}</button>
      </form>
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
            <Link to="/auth" className="auth-back" style={{ marginBottom: 0 }}><i className="ri-arrow-left-line"></i> {t.back}</Link>
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
