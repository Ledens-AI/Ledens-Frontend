import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { apiErrorText } from '../i18n/apiErrors.js';
import LangSwitch from '../i18n/LangSwitch.jsx';
import logo from '../assets/logo-ledens-isotype.png';
import '../styles/registro.css';

/* ─── Icons ─────────────────────────────────────────────────────────────── */
const GoogleIcon = () => (
  <svg viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.3-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 43.5c5.5 0 10.4-2 14.1-5.4l-6.5-5.5c-2 1.4-4.6 2.4-7.6 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39 16.2 43.5 24 43.5z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.5 5.5c-.5.4 6.7-4.9 6.7-15 0-1.2-.1-2.4-.3-3.5z"/>
  </svg>
);
const MicrosoftIcon = () => (
  <svg viewBox="0 0 23 23">
    <path fill="#F25022" d="M1 1h10v10H1z"/>
    <path fill="#7FBA00" d="M12 1h10v10H12z"/>
    <path fill="#00A4EF" d="M1 12h10v10H1z"/>
    <path fill="#FFB900" d="M12 12h10v10H12z"/>
  </svg>
);

/* ─── Validation ─────────────────────────────────────────────────────────── */
const PWD_RULES = {
  len: v => v.length >= 8,
  up:  v => /[A-ZÁÉÍÓÚÑ]/.test(v),
  num: v => /\d/.test(v),
  sym: v => /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(v),
};

function pwdScore(v) {
  if (!v) return 0;
  return Object.values(PWD_RULES).reduce((s, rule) => s + (rule(v) ? 1 : 0), 0);
}

// Field order = focus order when the form is submitted with errors.
const CHECKS = {
  name:    (v)    => v.name.trim().length > 1,
  last:    (v)    => v.last.trim().length > 1,
  company: (v, t) => t !== 'empresa' || v.company.trim().length > 1,
  cif:     (v, t) => t !== 'empresa' || /^[A-Z]\d{7}[A-Z0-9]$|^\d{8}[A-Z]$/i.test(v.cif.trim()),
  email:   (v)    => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim()),
  phone:   (v)    => /^[6789]\d{8}$/.test(v.phone.replace(/\s/g, '')),
  pwd:     (v)    => pwdScore(v.pwd) === 4,
  pwd2:    (v)    => v.pwd2.length > 0 && v.pwd2 === v.pwd,
};

function formatPhone(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 9);
  return d.replace(/(\d{3})(\d{0,3})(\d{0,3})/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
}

const TXT = {
  es: {
    pwdLabels: ['—', 'Débil', 'Aceptable', 'Buena', 'Excelente'],
    checkForm: 'Revisa el formulario', pwdMismatchMsg: 'Las dos contraseñas deben ser idénticas.',
    mustAccept: 'Debes aceptar los Términos y la Política de privacidad.', fixRed: 'Corrige los campos marcados en rojo para continuar.',
    emailTaken: 'Este email ya está registrado', unavailable: 'Registro no disponible', couldNotCreate: 'No hemos podido crear tu cuenta',
    emailTakenMsg: 'Inicia sesión con tu contraseña, o con Google o Microsoft si te registraste así.', tryAgain: 'Inténtalo de nuevo.',
    netTitle: 'Error de conexión', netMsg: 'No se pudo contactar con el servidor. Inténtalo de nuevo.',
    hidePwd: 'Ocultar contraseña', showPwd: 'Mostrar contraseña',
    artTitle: <>Empieza tu reforma <em>con todo claro</em> desde el primer día.</>,
    artLead: 'Tu cuenta te da acceso al panel de cliente: presupuesto, calendario, fotos de obra y chat directo con tu jefe de obra.',
    benefits: [
      ['Presupuesto cerrado en 24 h', 'Sin sorpresas: lo que firmas es lo que pagas.'],
      ['Seguimiento semanal', 'Fotos y avance de obra en tu móvil.'],
      ['Un interlocutor único', 'Hablas siempre con la misma persona.'],
    ],
    artFoot: 'Datos protegidos conforme al RGPD · © 2026 Ledens',
    back: 'Volver', haveAccount: '¿Ya tienes cuenta?', login: 'Inicia sesión',
    title: 'Crea tu cuenta', sub: 'Solo te pediremos lo necesario para preparar tu presupuesto y darte acceso al panel.',
    orEmail: 'o regístrate con tu email',
    accountType: 'Tipo de cuenta', particular: 'Particular', particularS: 'Reformo mi vivienda',
    company: 'Empresa', companyS: 'Locales, oficinas, inversión',
    personal: 'Datos personales',
    name: 'Nombre', namePh: 'Laura', nameErr: 'Introduce tu nombre.',
    last: 'Apellidos', lastPh: 'García Ruiz', lastErr: 'Introduce tus apellidos.',
    companyName: 'Razón social', companyPh: 'Empresa, S.L.', companyErr: 'Introduce la razón social.',
    cif: 'CIF / NIF', cifErr: 'Formato no válido (ej. B12345678).',
    email: 'Email', emailPh: 'tu@correo.es', emailErr: 'Introduce un email válido.',
    phone: 'Teléfono', phoneOpt: 'Para coordinar la visita técnica', phoneErr: 'Introduce un teléfono de 9 dígitos.',
    security: 'Seguridad', pwd: 'Contraseña', pwdPh: 'Crea una contraseña segura', pwdErr: 'La contraseña no cumple los requisitos.',
    strength: 'Seguridad:',
    reqs: { len: 'Mínimo 8 caracteres', up: 'Una mayúscula', num: 'Un número', sym: 'Un símbolo (!@#…)' },
    pwd2: 'Repite la contraseña', pwd2Ph: 'Escríbela de nuevo', pwd2Err: 'Las contraseñas no coinciden.', pwdMatch: 'Las contraseñas coinciden',
    terms: <>He leído y acepto los <Link to="/terminos" target="_blank">Términos y Condiciones</Link> y la <Link to="/privacidad" target="_blank">Política de privacidad</Link>.</>,
    news: 'Quiero recibir ideas de reforma y ofertas de Ledens por email (opcional, puedes darte de baja cuando quieras).',
    submit: 'Crear cuenta', secure: 'Conexión cifrada · Nunca compartimos tus datos',
  },
  en: {
    pwdLabels: ['—', 'Weak', 'Fair', 'Good', 'Excellent'],
    checkForm: 'Please check the form', pwdMismatchMsg: 'Both passwords must be identical.',
    mustAccept: 'You must accept the Terms and the Privacy policy.', fixRed: 'Fix the fields marked in red to continue.',
    emailTaken: 'This email is already registered', unavailable: 'Sign-up not available', couldNotCreate: 'We couldn’t create your account',
    emailTakenMsg: 'Log in with your password, or with Google or Microsoft if you signed up that way.', tryAgain: 'Please try again.',
    netTitle: 'Connection error', netMsg: 'Could not reach the server. Please try again.',
    hidePwd: 'Hide password', showPwd: 'Show password',
    artTitle: <>Start your renovation <em>with everything clear</em> from day one.</>,
    artLead: 'Your account gives you access to the client area: quote, schedule, photos of the works and direct chat with your site manager.',
    benefits: [
      ['Fixed-price quote in 24 h', 'No surprises: what you sign is what you pay.'],
      ['Weekly updates', 'Photos and progress of the works on your phone.'],
      ['A single point of contact', 'You always talk to the same person.'],
    ],
    artFoot: 'Data protected under the GDPR · © 2026 Ledens',
    back: 'Back', haveAccount: 'Already have an account?', login: 'Log in',
    title: 'Create your account', sub: 'We’ll only ask for what we need to prepare your quote and give you access to your dashboard.',
    orEmail: 'or sign up with your email',
    accountType: 'Account type', particular: 'Individual', particularS: 'I’m renovating my home',
    company: 'Company', companyS: 'Shops, offices, investment',
    personal: 'Personal details',
    name: 'First name', namePh: 'Laura', nameErr: 'Please enter your first name.',
    last: 'Surname(s)', lastPh: 'García Ruiz', lastErr: 'Please enter your surname.',
    companyName: 'Company name', companyPh: 'Company, S.L.', companyErr: 'Please enter the company name.',
    cif: 'Tax ID (CIF / NIF)', cifErr: 'Invalid format (e.g. B12345678).',
    email: 'Email', emailPh: 'you@email.com', emailErr: 'Please enter a valid email.',
    phone: 'Phone', phoneOpt: 'To arrange the technical visit', phoneErr: 'Please enter a 9-digit phone number.',
    security: 'Security', pwd: 'Password', pwdPh: 'Create a strong password', pwdErr: 'The password doesn’t meet the requirements.',
    strength: 'Strength:',
    reqs: { len: 'At least 8 characters', up: 'One capital letter', num: 'One number', sym: 'One symbol (!@#…)' },
    pwd2: 'Repeat the password', pwd2Ph: 'Type it again', pwd2Err: 'The passwords don’t match.', pwdMatch: 'The passwords match',
    terms: <>I have read and accept the <Link to="/terminos" target="_blank">Terms and Conditions</Link> and the <Link to="/privacidad" target="_blank">Privacy policy</Link>.</>,
    news: 'I’d like to receive renovation ideas and offers from Ledens by email (optional, you can unsubscribe at any time).',
    submit: 'Create account', secure: 'Encrypted connection · We never share your data',
  },
};

const BENEFIT_ICONS = ['ri-file-list-3-line', 'ri-camera-line', 'ri-chat-3-line'];

/* ─────────────────────────────────────────────────────────────────────────
 * RegistroPage — creates the account through our own backend
 * (POST /api/auth/register, see CLAUDE.md "Authentication"). The backend
 * logs the new user straight in, so success goes to /plataforma.
 * ───────────────────────────────────────────────────────────────────────── */
export default function RegistroPage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const { lang } = useI18n();
  const t = TXT[lang];
  const [type, setType]       = useState('particular');
  const [values, setValues]   = useState({ name: '', last: '', company: '', cif: '', email: '', phone: '', pwd: '', pwd2: '' });
  const [touched, setTouched] = useState(() => new Set());
  const [show, setShow]       = useState({ pwd: false, pwd2: false });
  const [terms, setTerms]     = useState(false);
  const [termsBad, setTermsBad] = useState(false);
  const [news, setNews]       = useState(false);
  const [alert, setAlert]     = useState(null); // { title, msg } dictionary keys (+ apiMsg from the backend)
  const [loading, setLoading] = useState(false);
  const refs = useRef({});

  // Already logged in (e.g. back here by mistake) — nothing to register.
  useEffect(() => { if (user) navigate('/plataforma'); }, [user, navigate]);

  const touch = (...names) => setTouched(prev => {
    const next = new Set(prev);
    names.forEach(n => next.add(n));
    return next;
  });

  function status(n) {
    if (!touched.has(n)) return '';
    if (!CHECKS[n](values, type)) return 'invalid';
    return n === 'pwd' || n === 'pwd2' ? 'ok' : '';
  }

  function onChange(n, raw) {
    const v = n === 'phone' ? formatPhone(raw) : n === 'cif' ? raw.toUpperCase() : raw;
    const next = { ...values, [n]: v };
    setValues(next);
    if (n === 'pwd') {
      const add = [];
      if (v) add.push('pwd');
      if (next.pwd2) add.push('pwd2');
      if (add.length) touch(...add);
    } else if (n === 'pwd2' && v && v.length >= next.pwd.length) {
      touch('pwd2');
    }
  }

  function onBlur(n) {
    if (values[n]) touch(n);
  }

  async function onSubmit(e) {
    e.preventDefault();
    touch(...Object.keys(CHECKS));
    const bad = Object.keys(CHECKS).filter(n => !CHECKS[n](values, type));
    setTermsBad(!terms);

    if (bad.length || !terms) {
      setAlert({
        title: 'checkForm',
        msg: bad.length === 1 && bad[0] === 'pwd2' ? 'pwdMismatchMsg' : !bad.length ? 'mustAccept' : 'fixRed',
      });
      (bad.length ? refs.current[bad[0]] : refs.current.terms)?.focus();
      return;
    }

    setAlert(null);
    setLoading(true);
    try {
      // The backend stores name, email and password; the other fields are
      // sent along for when the users table grows columns for them.
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${values.name.trim()} ${values.last.trim()}`,
          email: values.email.trim(),
          password: values.pwd,
          accountType: type,
          phone: `+34${values.phone.replace(/\s/g, '')}`,
          company: type === 'empresa' ? values.company.trim() : undefined,
          cif: type === 'empresa' ? values.cif.trim().toUpperCase() : undefined,
          marketingOptIn: news,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAlert({
          title: res.status === 409 ? 'emailTaken' : res.status === 503 ? 'unavailable' : 'couldNotCreate',
          msg: res.status === 409 ? 'emailTakenMsg' : 'tryAgain',
          apiMsg: res.status === 409 ? null : data.error,
        });
        return;
      }
      await refresh();
      navigate('/plataforma');
    } catch {
      setAlert({ title: 'netTitle', msg: 'netMsg' });
    } finally {
      setLoading(false);
    }
  }

  /* Text input with label, error and optional prefix / trailing button */
  const field = (n, label, props = {}, { opt, err, pre, pwd } = {}) => (
    <div className={`reg-field ${status(n)}`}>
      <label className="reg-l" htmlFor={`reg-${n}`}>
        {label} {opt && <span className="reg-opt">{opt}</span>}
      </label>
      <div className={`reg-inp${pre ? ' has-pre' : ''}${pwd ? ' has-btn' : ''}`}>
        {pre && <span className="reg-pre">{pre}</span>}
        <input
          id={`reg-${n}`}
          ref={el => { refs.current[n] = el; }}
          value={values[n]}
          onChange={e => onChange(n, e.target.value)}
          onBlur={() => onBlur(n)}
          {...(pwd ? { type: show[n] ? 'text' : 'password' } : {})}
          {...props}
        />
        {pwd && <>
          <i className="ri-checkbox-circle-fill reg-state"></i>
          <button type="button" className="reg-eye" aria-label={show[n] ? t.hidePwd : t.showPwd}
            onClick={() => setShow(s => ({ ...s, [n]: !s[n] }))}>
            <i className={show[n] ? 'ri-eye-off-line' : 'ri-eye-line'}></i>
          </button>
        </>}
      </div>
      {pwd?.extra}
      <div className="reg-err"><i className="ri-error-warning-line"></i> {err}</div>
    </div>
  );

  const score = pwdScore(values.pwd);

  return (
    <div className="reg">
      <aside className="reg-art">
        <Link to="/" className="reg-logo"><img src={logo} alt="Ledens" /><span>Ledens</span></Link>
        <div>
          <h2>{t.artTitle}</h2>
          <p className="reg-lead">{t.artLead}</p>
          <ul className="reg-benefits">
            {BENEFIT_ICONS.map((icon, i) => (
              <li key={icon}><span className="reg-ic"><i className={icon}></i></span><div><strong>{t.benefits[i][0]}</strong><span className="reg-d">{t.benefits[i][1]}</span></div></li>
            ))}
          </ul>
        </div>
        <div className="reg-art-foot"><i className="ri-shield-check-line"></i> {t.artFoot}</div>
      </aside>

      <main className="reg-side">
        <div className="reg-card">
          <div className="reg-topbar">
            <Link to="/" className="reg-back"><i className="ri-arrow-left-line"></i> {t.back}</Link>
            <span className="reg-topbar-right">
              <span>{t.haveAccount} <Link to="/auth" className="reg-strong">{t.login}</Link></span>
              <LangSwitch />
            </span>
          </div>

            <>
              <h1>{t.title}</h1>
              <p className="reg-sub">{t.sub}</p>
              <div className="reg-social">
                {/* Plain links: the backend runs the whole OAuth redirect (routes/oauth.js). */}
                <a className="reg-btn-social" href="/api/auth/google"><GoogleIcon />Google</a>
                <a className="reg-btn-social" href="/api/auth/microsoft"><MicrosoftIcon />Microsoft</a>
              </div>
              <div className="reg-divider">{t.orEmail}</div>

              {alert && (
                <div className="reg-alert" role="alert">
                  <i className="ri-error-warning-line"></i>
                  <div>
                    <b>{t[alert.title]}</b>
                    <span>{alert.apiMsg ? apiErrorText(alert.apiMsg, lang, t.tryAgain) : t[alert.msg]}</span>
                  </div>
                </div>
              )}

              <form onSubmit={onSubmit} noValidate>
                <fieldset>
                  <div className="reg-legend"><span className="reg-n">1</span> {t.accountType}</div>
                  <div className="reg-seg">
                    <label>
                      <input type="radio" name="type" value="particular" checked={type === 'particular'} onChange={() => setType('particular')} />
                      <span className="reg-ic"><i className="ri-home-4-line"></i></span>
                      <div><div className="reg-t">{t.particular}</div><div className="reg-s">{t.particularS}</div></div>
                    </label>
                    <label>
                      <input type="radio" name="type" value="empresa" checked={type === 'empresa'} onChange={() => setType('empresa')} />
                      <span className="reg-ic"><i className="ri-building-line"></i></span>
                      <div><div className="reg-t">{t.company}</div><div className="reg-s">{t.companyS}</div></div>
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <div className="reg-legend"><span className="reg-n">2</span> {t.personal}</div>
                  <div className="reg-grid2">
                    {field('name', t.name, { autoComplete: 'given-name', placeholder: t.namePh }, { err: t.nameErr })}
                    {field('last', t.last, { autoComplete: 'family-name', placeholder: t.lastPh }, { err: t.lastErr })}
                  </div>
                  {type === 'empresa' && (
                    <div className="reg-grid2">
                      {field('company', t.companyName, { autoComplete: 'organization', placeholder: t.companyPh }, { err: t.companyErr })}
                      {field('cif', t.cif, { placeholder: 'B12345678', maxLength: 9 }, { err: t.cifErr })}
                    </div>
                  )}
                  {field('email', t.email, { type: 'email', autoComplete: 'email', placeholder: t.emailPh }, { err: t.emailErr })}
                  {field('phone', t.phone,
                    { type: 'tel', autoComplete: 'tel-national', inputMode: 'numeric', placeholder: '600 000 000', maxLength: 11 },
                    { opt: t.phoneOpt, pre: '🇪🇸 +34', err: t.phoneErr })}
                </fieldset>

                <fieldset>
                  <div className="reg-legend"><span className="reg-n">3</span> {t.security}</div>
                  {field('pwd', t.pwd, { autoComplete: 'new-password', placeholder: t.pwdPh }, {
                    err: t.pwdErr,
                    pwd: {
                      extra: <>
                        <div className="reg-strength" data-s={score}>
                          <div className="reg-bars"><span></span><span></span><span></span><span></span></div>
                          <div className="reg-strength-lbl"><span>{t.strength} <b>{t.pwdLabels[score]}</b></span></div>
                        </div>
                        <ul className="reg-reqs">
                          {Object.entries(t.reqs).map(([k, txt]) => (
                            <li key={k} className={PWD_RULES[k](values.pwd) ? 'met' : ''}><i className="ri-checkbox-circle-fill"></i> {txt}</li>
                          ))}
                        </ul>
                      </>,
                    },
                  })}
                  {field('pwd2', t.pwd2, { autoComplete: 'new-password', placeholder: t.pwd2Ph }, {
                    err: t.pwd2Err,
                    pwd: { extra: <div className="reg-match"><i className="ri-checkbox-circle-line"></i> {t.pwdMatch}</div> },
                  })}
                </fieldset>

                <div className="reg-checks">
                  <label className={`reg-check${termsBad ? ' invalid' : ''}`}>
                    <input type="checkbox" ref={el => { refs.current.terms = el; }} checked={terms}
                      onChange={e => { setTerms(e.target.checked); setTermsBad(!e.target.checked && touched.size > 0); }} />
                    <span>{t.terms}</span>
                  </label>
                  <label className="reg-check">
                    <input type="checkbox" checked={news} onChange={e => setNews(e.target.checked)} />
                    <span>{t.news}</span>
                  </label>
                </div>

                <button type="submit" className="reg-submit" disabled={loading}>
                  {loading ? <span className="reg-spinner"></span> : <span>{t.submit}</span>}
                </button>
                <div className="reg-secure"><i className="ri-lock-2-line"></i> {t.secure}</div>
              </form>
            </>
        </div>
      </main>
    </div>
  );
}
