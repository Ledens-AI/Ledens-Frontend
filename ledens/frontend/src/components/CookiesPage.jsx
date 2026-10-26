import React from 'react';
import { Link } from 'react-router-dom';
import Footer from './Footer.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import useTocHighlight from './legal/useTocHighlight.js';
import CookiesEn from './legal/CookiesEn.jsx';


const TOC = [
  { id: 'que-son',        label: '¿Qué son las cookies?' },
  { id: 'quien',          label: 'Quién las utiliza' },
  { id: 'categorias',     label: 'Categorías de cookies' },
  { id: 'listado',        label: 'Listado de cookies que usamos' },
  { id: 'terceros',       label: 'Cookies de terceros' },
  { id: 'conservacion',   label: 'Plazos de conservación' },
  { id: 'consentimiento', label: 'Cómo gestionar tu consentimiento' },
  { id: 'navegador',      label: 'Configuración en tu navegador' },
  { id: 'transferencias', label: 'Transferencias internacionales' },
  { id: 'cambios',        label: 'Cambios en esta política' },
];

/* The English text lives in legal/CookiesEn.jsx — keep both in step. */
export default function CookiesPage() {
  const { lang } = useI18n();
  return lang === 'en' ? <CookiesEn /> : <CookiesPageEs />;
}

function CookiesPageEs() {
  const activeId = useTocHighlight(TOC.map(t => t.id));

  return (
    <>
      {/* Hero */}
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <div className="legal-crumbs">
            <Link to="/">Inicio</Link>
            <span className="sep">/</span>
            <span>Legal</span>
            <span className="sep">/</span>
            <span className="here">Política de cookies</span>
          </div>
          <span className="legal-eb">
            <i className="ri-cookie-line" /> Art. 22.2 LSSI · RGPD · Guía AEPD 2024
          </span>
          <h1>Política de Cookies</h1>
          <p className="lead">
            Aquí te contamos qué cookies utilizamos en{' '}
            <a href="https://www.ledens.es">ledens.es</a>, para qué sirven, cuánto duran y cómo
            puedes activarlas, rechazarlas o configurarlas a tu gusto en cualquier momento.
          </p>
          <div className="legal-meta">
            <div><i className="ri-calendar-line" /> Última actualización: <strong>19 de mayo de 2026</strong></div>
            <div><i className="ri-file-text-line" /> Versión <strong>2.1</strong></div>
            <div><i className="ri-time-line" /> Lectura: <strong>~6 min</strong></div>
          </div>
        </div>
      </section>

      {/* Shell */}
      <div className="legal-shell">

        {/* TOC */}
        <aside className="toc">
          <div className="toc-title">Contenidos</div>
          <ol>
            {TOC.map(t => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className={activeId === t.id ? 'active' : undefined}
                  onClick={e => {
                    e.preventDefault();
                    document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        {/* Content */}
        <article className="legal-content">

          {/* Live status card */}
          <div className="cookie-status">
            <span className="dot" aria-hidden="true" />
            <div className="copy">
              <strong>Tu configuración está activa.</strong>{' '}
              Cambiarás tus preferencias cuando quieras sin volver a esta página.
            </div>
            <button
              type="button"
              className="btn-manage"
              onClick={() => window.LedensCookies?.open()}
            >
              <i className="ri-equalizer-line" /> Gestionar cookies
            </button>
          </div>

          {/* 01 */}
          <section id="que-son">
            <h2><span className="num">01</span>¿Qué son las cookies?</h2>
            <p>Una <strong>cookie</strong> es un pequeño fragmento de información que un sitio web guarda en tu dispositivo (ordenador, móvil o tablet) cuando lo visitas. Sirven, entre otras cosas, para que la web te reconozca en visitas siguientes, recordar tus preferencias y medir cómo se utiliza el sitio.</p>
            <p>Junto a las cookies utilizamos otras <strong>tecnologías similares</strong> con la misma finalidad: píxeles, etiquetas de seguimiento, almacenamiento local (<em>localStorage</em>, <em>sessionStorage</em>) y huellas digitales del navegador. A efectos de esta política, todas reciben el mismo tratamiento que las cookies.</p>
            <div className="callout">
              <i className="ri-information-line" />
              <div>
                <strong>Marco legal aplicable</strong>{' '}
                Esta política cumple el artículo 22.2 de la Ley 34/2002 de Servicios de la Sociedad de la Información (LSSI-CE), el Reglamento (UE) 2016/679 (RGPD) y la <em>Guía sobre el uso de las cookies</em> publicada por la AEPD en su edición de enero de 2024.
              </div>
            </div>
          </section>

          {/* 02 */}
          <section id="quien">
            <h2><span className="num">02</span>¿Quién utiliza las cookies en esta web?</h2>
            <p>Las cookies pueden ser instaladas por:</p>
            <ul>
              <li><strong>Sociedad Inversora Navarro Robinson S.L.</strong> (en adelante, "Ledens"), responsable del tratamiento, con domicilio en Avenida del Sor Teresa Prat 5, Polo Digital, Málaga (NIF B19753805). Estas se denominan <strong>cookies propias</strong>.</li>
              <li><strong>Terceros proveedores</strong> de servicios que prestan funcionalidades complementarias (analítica, mapas, vídeo, pasarela de pago, publicidad). Estas se denominan <strong>cookies de terceros</strong>. Consulta el apartado 5.</li>
            </ul>
            <p>Para cualquier consulta puedes contactar con nuestro Delegado de Protección de Datos en <a href="mailto:dpo@ledens.es">dpo@ledens.es</a>.</p>
          </section>

          {/* 03 */}
          <section id="categorias">
            <h2><span className="num">03</span>Categorías de cookies que utilizamos</h2>
            <p>De acuerdo con la clasificación recomendada por la AEPD, agrupamos las cookies en <strong>cuatro categorías</strong>. Puedes activar o desactivar todas, salvo las imprescindibles, desde el icono inferior izquierdo o desde el botón "Gestionar cookies" en la cabecera de esta página.</p>

            <h3>
              <span className="cookie-chip chip-necessary"><i className="ri-shield-check-line" /> Técnicas</span>{' '}
              Imprescindibles
            </h3>
            <p>Permiten al usuario navegar a través del sitio web y utilizar las distintas opciones existentes (controlar el tráfico, identificar la sesión, acceder a áreas de acceso restringido, recordar elementos del carrito, almacenar el equilibrio de carga del servidor). Conforme al art. 22.2 LSSI, <strong>no requieren consentimiento</strong> porque son estrictamente necesarias para prestar el servicio que tú nos has solicitado.</p>

            <h3>
              <span className="cookie-chip chip-pref"><i className="ri-settings-3-line" /> Preferencias</span>{' '}
              Personalización
            </h3>
            <p>Permiten recordar información para que accedas al servicio con determinadas características que pueden diferenciar tu experiencia (número de resultados a mostrar, tipo de navegador, configuración regional de la zona desde la que se accede al servicio…). Requieren <strong>tu consentimiento previo</strong>.</p>

            <h3>
              <span className="cookie-chip chip-analytics"><i className="ri-line-chart-line" /> Analíticas</span>{' '}
              Medición
            </h3>
            <p>Permiten al responsable de las mismas, el seguimiento y análisis del comportamiento de los usuarios. La información recogida se utiliza en la medición de la actividad del sitio web y para la elaboración de perfiles de navegación con el fin de introducir mejoras en función del análisis de los datos de uso. Requieren <strong>tu consentimiento previo</strong>.</p>

            <h3>
              <span className="cookie-chip chip-marketing"><i className="ri-megaphone-line" /> Marketing</span>{' '}
              Publicidad y comportamentales
            </h3>
            <p>Permiten gestionar los espacios publicitarios y, mediante el análisis de tus hábitos de navegación, mostrarte anuncios relacionados con tus intereses dentro y fuera de la web de Ledens. Pueden compartirse con redes publicitarias y plataformas sociales. Requieren <strong>tu consentimiento previo</strong>.</p>
          </section>

          {/* 04 */}
          <section id="listado">
            <h2><span className="num">04</span>Listado de cookies que usamos</h2>
            <p>A continuación encontrarás el detalle de cada cookie instalada por Ledens o por sus proveedores. Revisamos esta lista trimestralmente; si encuentras alguna discrepancia, escríbenos a <a href="mailto:dpo@ledens.es">dpo@ledens.es</a>.</p>

            <h3>Cookies técnicas (imprescindibles)</h3>
            <table className="cookie-table">
              <thead>
                <tr>
                  <th className="col-name">Nombre</th>
                  <th className="col-type">Origen</th>
                  <th>Finalidad</th>
                  <th className="col-life">Duración</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code>ledens_sid</code></td><td>Propia</td><td>Identifica tu sesión de navegación.</td><td>Sesión</td></tr>
                <tr><td><code>ledens_csrf</code></td><td>Propia</td><td>Protección frente a ataques CSRF en formularios y panel de cliente.</td><td>Sesión</td></tr>
                <tr><td><code>ledens.cookieConsent.v1</code></td><td>Propia (localStorage)</td><td>Almacena tus preferencias de cookies para no volver a preguntártelo.</td><td>12 meses</td></tr>
                <tr><td><code>ledens.lang.v1</code></td><td>Propia (localStorage)</td><td>Recuerda el idioma (ES / EN) que eliges en la barra superior. Solo se guarda cuando lo eliges tú.</td><td>Hasta que lo borres</td></tr>
                <tr><td><code>__cf_bm</code></td><td>Cloudflare</td><td>Distingue tráfico humano de bots para proteger el sitio.</td><td>30 min</td></tr>
              </tbody>
            </table>

            <h3>Cookies de preferencias</h3>
            <table className="cookie-table">
              <thead>
                <tr><th className="col-name">Nombre</th><th className="col-type">Origen</th><th>Finalidad</th><th className="col-life">Duración</th></tr>
              </thead>
              <tbody>
                <tr><td><code>ledens_city</code></td><td>Propia</td><td>Guarda la ciudad seleccionada en el buscador de reformas.</td><td>6 meses</td></tr>
                <tr><td><code>ledens_last_quote</code></td><td>Propia</td><td>Conserva tu último presupuesto consultado para retomarlo.</td><td>30 días</td></tr>
              </tbody>
            </table>

            <h3>Cookies analíticas</h3>
            <table className="cookie-table">
              <thead>
                <tr><th className="col-name">Nombre</th><th className="col-type">Origen</th><th>Finalidad</th><th className="col-life">Duración</th></tr>
              </thead>
              <tbody>
                <tr><td><code>_ga</code></td><td>Google Analytics 4</td><td>Distingue a los usuarios de forma seudonimizada.</td><td>2 años</td></tr>
                <tr><td><code>_ga_&lt;ID&gt;</code></td><td>Google Analytics 4</td><td>Mantiene el estado de la sesión analítica.</td><td>2 años</td></tr>
                <tr><td><code>_gid</code></td><td>Google Analytics</td><td>Distingue a los usuarios durante 24 horas.</td><td>24 horas</td></tr>
                <tr><td><code>hjSessionUser_&lt;ID&gt;</code></td><td>Hotjar</td><td>Identifica al usuario para medir mapas de calor y grabaciones agregadas.</td><td>12 meses</td></tr>
                <tr><td><code>hjSession_&lt;ID&gt;</code></td><td>Hotjar</td><td>Mantiene la sesión de medición durante 30 minutos.</td><td>30 min</td></tr>
              </tbody>
            </table>

            <h3>Cookies de marketing</h3>
            <table className="cookie-table">
              <thead>
                <tr><th className="col-name">Nombre</th><th className="col-type">Origen</th><th>Finalidad</th><th className="col-life">Duración</th></tr>
              </thead>
              <tbody>
                <tr><td><code>_fbp</code></td><td>Meta Pixel</td><td>Identifica al navegador para mostrar anuncios en Facebook e Instagram.</td><td>3 meses</td></tr>
                <tr><td><code>fr</code></td><td>Meta</td><td>Entrega y medición de anuncios en redes sociales de Meta.</td><td>3 meses</td></tr>
                <tr><td><code>_gcl_au</code></td><td>Google Ads</td><td>Mide la eficacia de los anuncios y el rendimiento del sitio.</td><td>3 meses</td></tr>
                <tr><td><code>IDE</code></td><td>DoubleClick</td><td>Selecciona anuncios y mide su rendimiento.</td><td>13 meses</td></tr>
                <tr><td><code>_ttp</code></td><td>TikTok Pixel</td><td>Atribución de campañas en TikTok.</td><td>13 meses</td></tr>
                <tr><td><code>li_sugr</code></td><td>LinkedIn</td><td>Asocia visitas para medir campañas profesionales.</td><td>3 meses</td></tr>
              </tbody>
            </table>
          </section>

          {/* 05 */}
          <section id="terceros">
            <h2><span className="num">05</span>Cookies de terceros</h2>
            <p>Determinados servicios prestados en la web requieren la intervención de terceros que pueden instalar sus propias cookies en tu dispositivo. Estos terceros actúan como responsables del tratamiento sobre los datos recogidos a través de sus cookies, y aplican sus propias políticas que te recomendamos consultar:</p>
            <table>
              <thead><tr><th>Tercero</th><th>Servicio</th><th>Política de privacidad</th></tr></thead>
              <tbody>
                <tr><td>Google LLC</td><td>Analytics, Maps, reCAPTCHA, Ads</td><td><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">policies.google.com</a></td></tr>
                <tr><td>Meta Platforms Ireland Ltd.</td><td>Meta Pixel, WhatsApp Business</td><td><a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noopener noreferrer">facebook.com/privacy</a></td></tr>
                <tr><td>Hotjar Ltd.</td><td>Mapas de calor y grabaciones agregadas</td><td><a href="https://www.hotjar.com/legal/policies/privacy/" target="_blank" rel="noopener noreferrer">hotjar.com/legal</a></td></tr>
                <tr><td>Cloudflare Inc.</td><td>CDN y protección anti-bot</td><td><a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">cloudflare.com/privacypolicy</a></td></tr>
                <tr><td>Stripe Payments Europe Ltd.</td><td>Procesamiento de pagos</td><td><a href="https://stripe.com/es/privacy" target="_blank" rel="noopener noreferrer">stripe.com/privacy</a></td></tr>
                <tr><td>TikTok Information Technologies UK Ltd.</td><td>TikTok Pixel</td><td><a href="https://www.tiktok.com/legal/privacy-policy-eea" target="_blank" rel="noopener noreferrer">tiktok.com/legal</a></td></tr>
                <tr><td>LinkedIn Ireland Unlimited Company</td><td>Insight Tag</td><td><a href="https://www.linkedin.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">linkedin.com/legal</a></td></tr>
              </tbody>
            </table>
            <div className="callout callout-warn">
              <i className="ri-error-warning-line" />
              <div>
                <strong>Ledens no controla las cookies de terceros.</strong>{' '}
                No tenemos acceso ni control sobre las cookies instaladas por proveedores externos. Si quieres ejercer tus derechos sobre esos datos, debes dirigirte directamente al tercero o gestionar el consentimiento desde el panel de cookies de Ledens, que las bloquea en origen cuando no las has aceptado.
              </div>
            </div>
          </section>

          {/* 06 */}
          <section id="conservacion">
            <h2><span className="num">06</span>Plazos de conservación</h2>
            <p>Las cookies pueden ser de <strong>sesión</strong> (se eliminan al cerrar el navegador) o <strong>persistentes</strong> (permanecen durante un tiempo definido). Conforme a la recomendación de la AEPD, ninguna cookie persistente que utilizamos supera los <strong>24 meses</strong>. Tu registro de consentimiento se conserva durante <strong>12 meses</strong>, transcurridos los cuales volveremos a solicitártelo.</p>
          </section>

          {/* 07 */}
          <section id="consentimiento">
            <h2><span className="num">07</span>Cómo gestionar tu consentimiento</h2>
            <p>En tu primera visita te mostramos un panel donde puedes:</p>
            <ol className="list">
              <li><strong>Aceptar todas las cookies</strong>, autorizando las cuatro categorías.</li>
              <li><strong>Rechazar todas</strong>, permitiendo únicamente las cookies técnicas imprescindibles.</li>
              <li><strong>Personalizar tu elección</strong> categoría a categoría mediante interruptores individuales.</li>
            </ol>
            <p>Conforme al artículo 7 RGPD, tu consentimiento es <strong>libre, específico, informado e inequívoco</strong>. Las casillas se presentan desmarcadas por defecto (salvo las técnicas) y no se instala ninguna cookie no esencial hasta que pulses "Aceptar todas" o "Guardar mis preferencias".</p>
            <p>Puedes <strong>revocar o modificar tu consentimiento en cualquier momento</strong>, con la misma facilidad con la que lo otorgaste:</p>
            <ul>
              <li>Pulsando el icono <i className="ri-shield-user-line" style={{ color: 'var(--ledens-blue)' }} /> que aparece en la esquina inferior izquierda de cualquier página.</li>
              <li>Haciendo clic en <button type="button" className="cc-inline-link" onClick={() => window.LedensCookies?.open()}><strong>Gestionar cookies</strong></button> desde esta misma página.</li>
              <li>Eliminando las cookies de Ledens directamente desde tu navegador (apartado 8).</li>
            </ul>
            <p>La retirada del consentimiento no afectará a la licitud del tratamiento basado en el consentimiento previo a su retirada.</p>
          </section>

          {/* 08 */}
          <section id="navegador">
            <h2><span className="num">08</span>Configuración en tu navegador</h2>
            <p>Como alternativa al panel de Ledens, puedes administrar, bloquear o eliminar las cookies directamente desde la configuración de tu navegador. La ruta exacta cambia según la versión, pero estas son las páginas oficiales:</p>
            <div className="browser-grid">
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.google.com/chrome/answer/95647">
                <span className="ic"><i className="ri-chrome-line" /></span>
                <div><div className="lbl">Google Chrome</div><div className="sub">Configuración → Privacidad y seguridad</div></div>
              </a>
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.mozilla.org/es/kb/habilitar-y-deshabilitar-cookies-sitios-web-rastrear-preferencias">
                <span className="ic"><i className="ri-firefox-line" /></span>
                <div><div className="lbl">Mozilla Firefox</div><div className="sub">Ajustes → Privacidad y seguridad</div></div>
              </a>
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.apple.com/es-es/guide/safari/sfri11471/mac">
                <span className="ic"><i className="ri-safari-line" /></span>
                <div><div className="lbl">Apple Safari</div><div className="sub">Preferencias → Privacidad</div></div>
              </a>
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09">
                <span className="ic"><i className="ri-edge-line" /></span>
                <div><div className="lbl">Microsoft Edge</div><div className="sub">Configuración → Cookies y permisos del sitio</div></div>
              </a>
            </div>
            <p>Si navegas en <strong>modo incógnito o privado</strong>, recuerda que la mayoría de cookies persistentes se eliminan al cerrar la ventana, por lo que tendrás que volver a configurar tu consentimiento en la siguiente visita.</p>
            <div className="callout callout-warn">
              <i className="ri-alarm-warning-line" />
              <div>
                <strong>Si bloqueas todas las cookies:</strong>{' '}
                Algunas funciones del sitio pueden no estar disponibles: inicio de sesión, panel de cliente, recordatorio de presupuesto, asistencia por chat. Las cookies técnicas son imprescindibles para que la web responda con normalidad.
              </div>
            </div>
          </section>

          {/* 09 */}
          <section id="transferencias">
            <h2><span className="num">09</span>Transferencias internacionales asociadas a las cookies</h2>
            <p>Algunos de los terceros enumerados en el apartado 5 (Google, Meta, TikTok, LinkedIn) están establecidos en países fuera del Espacio Económico Europeo, principalmente en Estados Unidos. Las transferencias internacionales derivadas de sus cookies se realizan al amparo de:</p>
            <ul>
              <li>El <strong>Data Privacy Framework UE-EE.UU.</strong> (Decisión de Adecuación de 10 de julio de 2023), cuando el proveedor está certificado.</li>
              <li>Las <strong>Cláusulas Contractuales Tipo</strong> aprobadas por la Comisión Europea (Decisión 2021/914) con medidas técnicas complementarias.</li>
            </ul>
            <p>Más información en nuestra <Link to="/privacidad">Política de privacidad</Link>.</p>
          </section>

          {/* 10 */}
          <section id="cambios">
            <h2><span className="num">10</span>Cambios en esta política</h2>
            <p>Podemos actualizar esta Política de cookies para reflejar la incorporación de nuevos servicios, cambios normativos o recomendaciones de la AEPD. La fecha de la última revisión figura al principio del documento.</p>
            <p>Si el cambio implica una nueva finalidad o la incorporación de un tercero relevante, <strong>volveremos a solicitar tu consentimiento</strong> antes de instalar las cookies afectadas.</p>
          </section>

          {/* Contact CTA */}
          <div className="legal-contact">
            <div>
              <h3>¿Dudas sobre las cookies?</h3>
              <p>Nuestro Delegado de Protección de Datos te responde en menos de 72 horas laborables. Sin formularios eternos.</p>
            </div>
            <div className="actions">
              <a href="mailto:dpo@ledens.es"><i className="ri-mail-line" /> dpo@ledens.es</a>
              <button type="button" className="cc-inline-link" onClick={() => window.LedensCookies?.open()}>
                <i className="ri-equalizer-line" /> Gestionar mis cookies
              </button>
            </div>
          </div>

        </article>
      </div>

      <Footer />
    </>
  );
}
