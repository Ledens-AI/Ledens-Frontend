import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
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
const PWD_LABELS = ['—', 'Débil', 'Aceptable', 'Buena', 'Excelente'];

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

/* ─────────────────────────────────────────────────────────────────────────
 * RegistroPage — creates the account through our own backend
 * (POST /api/auth/register, see CLAUDE.md "Authentication"). The backend
 * logs the new user straight in, so success goes to /plataforma.
 * ───────────────────────────────────────────────────────────────────────── */
export default function RegistroPage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [type, setType]       = useState('particular');
  const [values, setValues]   = useState({ name: '', last: '', company: '', cif: '', email: '', phone: '', pwd: '', pwd2: '' });
  const [touched, setTouched] = useState(() => new Set());
  const [show, setShow]       = useState({ pwd: false, pwd2: false });
  const [terms, setTerms]     = useState(false);
  const [termsBad, setTermsBad] = useState(false);
  const [news, setNews]       = useState(false);
  const [alert, setAlert]     = useState(null);
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
        title: 'Revisa el formulario',
        msg: bad.length === 1 && bad[0] === 'pwd2'
          ? 'Las dos contraseñas deben ser idénticas.'
          : !bad.length
            ? 'Debes aceptar los Términos y la Política de privacidad.'
            : 'Corrige los campos marcados en rojo para continuar.',
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
          title: res.status === 409 ? 'Este email ya está registrado'
            : res.status === 503 ? 'Registro no disponible'
            : 'No hemos podido crear tu cuenta',
          msg: res.status === 409
            ? 'Inicia sesión con tu contraseña, o con Google o Microsoft si te registraste así.'
            : data.error || 'Inténtalo de nuevo.',
        });
        return;
      }
      await refresh();
      navigate('/plataforma');
    } catch {
      setAlert({ title: 'Error de conexión', msg: 'No se pudo contactar con el servidor. Inténtalo de nuevo.' });
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
          <button type="button" className="reg-eye" aria-label={show[n] ? 'Ocultar contraseña' : 'Mostrar contraseña'}
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
          <h2>Empieza tu reforma <em>con todo claro</em> desde el primer día.</h2>
          <p className="reg-lead">Tu cuenta te da acceso al panel de cliente: presupuesto, calendario, fotos de obra y chat directo con tu jefe de obra.</p>
          <ul className="reg-benefits">
            <li><span className="reg-ic"><i className="ri-file-list-3-line"></i></span><div><strong>Presupuesto cerrado en 24 h</strong><span className="reg-d">Sin sorpresas: lo que firmas es lo que pagas.</span></div></li>
            <li><span className="reg-ic"><i className="ri-camera-line"></i></span><div><strong>Seguimiento semanal</strong><span className="reg-d">Fotos y avance de obra en tu móvil.</span></div></li>
            <li><span className="reg-ic"><i className="ri-chat-3-line"></i></span><div><strong>Un interlocutor único</strong><span className="reg-d">Hablas siempre con la misma persona.</span></div></li>
          </ul>
        </div>
        <div className="reg-art-foot"><i className="ri-shield-check-line"></i> Datos protegidos conforme al RGPD · © 2026 Ledens</div>
      </aside>

      <main className="reg-side">
        <div className="reg-card">
          <div className="reg-topbar">
            <Link to="/" className="reg-back"><i className="ri-arrow-left-line"></i> Volver</Link>
            <span>¿Ya tienes cuenta? <Link to="/auth" className="reg-strong">Inicia sesión</Link></span>
          </div>

            <>
              <h1>Crea tu cuenta</h1>
              <p className="reg-sub">Solo te pediremos lo necesario para preparar tu presupuesto y darte acceso al panel.</p>
              <div className="reg-social">
                {/* Plain links: the backend runs the whole OAuth redirect (routes/oauth.js). */}
                <a className="reg-btn-social" href="/api/auth/google"><GoogleIcon />Google</a>
                <a className="reg-btn-social" href="/api/auth/microsoft"><MicrosoftIcon />Microsoft</a>
              </div>
              <div className="reg-divider">o regístrate con tu email</div>

              {alert && (
                <div className="reg-alert" role="alert">
                  <i className="ri-error-warning-line"></i>
                  <div><b>{alert.title}</b><span>{alert.msg}</span></div>
                </div>
              )}

              <form onSubmit={onSubmit} noValidate>
                <fieldset>
                  <div className="reg-legend"><span className="reg-n">1</span> Tipo de cuenta</div>
                  <div className="reg-seg">
                    <label>
                      <input type="radio" name="type" value="particular" checked={type === 'particular'} onChange={() => setType('particular')} />
                      <span className="reg-ic"><i className="ri-home-4-line"></i></span>
                      <div><div className="reg-t">Particular</div><div className="reg-s">Reformo mi vivienda</div></div>
                    </label>
                    <label>
                      <input type="radio" name="type" value="empresa" checked={type === 'empresa'} onChange={() => setType('empresa')} />
                      <span className="reg-ic"><i className="ri-building-line"></i></span>
                      <div><div className="reg-t">Empresa</div><div className="reg-s">Locales, oficinas, inversión</div></div>
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <div className="reg-legend"><span className="reg-n">2</span> Datos personales</div>
                  <div className="reg-grid2">
                    {field('name', 'Nombre', { autoComplete: 'given-name', placeholder: 'Laura' }, { err: 'Introduce tu nombre.' })}
                    {field('last', 'Apellidos', { autoComplete: 'family-name', placeholder: 'García Ruiz' }, { err: 'Introduce tus apellidos.' })}
                  </div>
                  {type === 'empresa' && (
                    <div className="reg-grid2">
                      {field('company', 'Razón social', { autoComplete: 'organization', placeholder: 'Empresa, S.L.' }, { err: 'Introduce la razón social.' })}
                      {field('cif', 'CIF / NIF', { placeholder: 'B12345678', maxLength: 9 }, { err: 'Formato no válido (ej. B12345678).' })}
                    </div>
                  )}
                  {field('email', 'Email', { type: 'email', autoComplete: 'email', placeholder: 'tu@correo.es' }, { err: 'Introduce un email válido.' })}
                  {field('phone', 'Teléfono',
                    { type: 'tel', autoComplete: 'tel-national', inputMode: 'numeric', placeholder: '600 000 000', maxLength: 11 },
                    { opt: 'Para coordinar la visita técnica', pre: '🇪🇸 +34', err: 'Introduce un teléfono de 9 dígitos.' })}
                </fieldset>

                <fieldset>
                  <div className="reg-legend"><span className="reg-n">3</span> Seguridad</div>
                  {field('pwd', 'Contraseña', { autoComplete: 'new-password', placeholder: 'Crea una contraseña segura' }, {
                    err: 'La contraseña no cumple los requisitos.',
                    pwd: {
                      extra: <>
                        <div className="reg-strength" data-s={score}>
                          <div className="reg-bars"><span></span><span></span><span></span><span></span></div>
                          <div className="reg-strength-lbl"><span>Seguridad: <b>{PWD_LABELS[score]}</b></span></div>
                        </div>
                        <ul className="reg-reqs">
                          {[['len', 'Mínimo 8 caracteres'], ['up', 'Una mayúscula'], ['num', 'Un número'], ['sym', 'Un símbolo (!@#…)']].map(([k, txt]) => (
                            <li key={k} className={PWD_RULES[k](values.pwd) ? 'met' : ''}><i className="ri-checkbox-circle-fill"></i> {txt}</li>
                          ))}
                        </ul>
                      </>,
                    },
                  })}
                  {field('pwd2', 'Repite la contraseña', { autoComplete: 'new-password', placeholder: 'Escríbela de nuevo' }, {
                    err: 'Las contraseñas no coinciden.',
                    pwd: { extra: <div className="reg-match"><i className="ri-checkbox-circle-line"></i> Las contraseñas coinciden</div> },
                  })}
                </fieldset>

                <div className="reg-checks">
                  <label className={`reg-check${termsBad ? ' invalid' : ''}`}>
                    <input type="checkbox" ref={el => { refs.current.terms = el; }} checked={terms}
                      onChange={e => { setTerms(e.target.checked); setTermsBad(!e.target.checked && touched.size > 0); }} />
                    <span>He leído y acepto los <Link to="/terminos" target="_blank">Términos y Condiciones</Link> y la <Link to="/privacidad" target="_blank">Política de privacidad</Link>.</span>
                  </label>
                  <label className="reg-check">
                    <input type="checkbox" checked={news} onChange={e => setNews(e.target.checked)} />
                    <span>Quiero recibir ideas de reforma y ofertas de Ledens por email (opcional, puedes darte de baja cuando quieras).</span>
                  </label>
                </div>

                <button type="submit" className="reg-submit" disabled={loading}>
                  {loading ? <span className="reg-spinner"></span> : <span>Crear cuenta</span>}
                </button>
                <div className="reg-secure"><i className="ri-lock-2-line"></i> Conexión cifrada · Nunca compartimos tus datos</div>
              </form>
            </>
        </div>
      </main>
    </div>
  );
}

