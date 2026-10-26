import React from 'react';
import { Link } from 'react-router-dom';
import Footer from './Footer.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import useTocHighlight from './legal/useTocHighlight.js';
import PrivacidadEn from './legal/PrivacidadEn.jsx';


const TOC = [
  { id: 'responsable',    label: 'Responsable del tratamiento' },
  { id: 'datos',          label: 'Datos que recogemos' },
  { id: 'finalidades',    label: 'Para qué los usamos' },
  { id: 'base',           label: 'Base jurídica del tratamiento' },
  { id: 'conservacion',   label: 'Plazos de conservación' },
  { id: 'destinatarios',  label: 'Destinatarios y encargados' },
  { id: 'transferencias', label: 'Transferencias internacionales' },
  { id: 'decisiones',     label: 'Decisiones automatizadas' },
  { id: 'derechos',       label: 'Tus derechos' },
  { id: 'seguridad',      label: 'Seguridad de la información' },
  { id: 'menores',        label: 'Menores de edad' },
  { id: 'cambios',        label: 'Cambios en esta política' },
];

/* The English text lives in legal/PrivacidadEn.jsx — keep both in step. */
export default function PrivacidadPage() {
  const { lang } = useI18n();
  return lang === 'en' ? <PrivacidadEn /> : <PrivacidadPageEs />;
}

function PrivacidadPageEs() {
  const activeId = useTocHighlight(TOC.map(t => t.id));

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <div className="legal-crumbs">
            <Link to="/">Inicio</Link>
            <span className="sep">/</span>
            <span>Legal</span>
            <span className="sep">/</span>
            <span className="here">Política de privacidad</span>
          </div>
          <span className="legal-eb"><i className="ri-shield-keyhole-line"></i> RGPD · LOPDGDD</span>
          <h1>Política de Privacidad de Ledens</h1>
          <p className="lead">
            Tu privacidad nos importa. Aquí te explicamos, sin letra pequeña, qué datos
            personales tratamos, por qué los tratamos, cuánto los guardamos y qué derechos
            tienes sobre ellos conforme al Reglamento (UE) 2016/679 (RGPD) y la LOPDGDD.
          </p>
          <div className="legal-meta">
            <div><i className="ri-calendar-line"></i> Última actualización: <strong>19 de mayo de 2026</strong></div>
            <div><i className="ri-file-text-line"></i> Versión <strong>2.1</strong></div>
            <div><i className="ri-time-line"></i> Lectura: <strong>~8 min</strong></div>
          </div>
        </div>
      </section>

      {/* ── Shell ─────────────────────────────────────────────────────────── */}
      <div className="legal-shell">

        {/* TOC */}
        <aside className="toc">
          <div className="toc-title">Contenidos</div>
          <ol>
            {TOC.map(item => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={activeId === item.id ? 'active' : ''}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        {/* Content */}
        <article className="legal-content">

          <section id="responsable">
            <h2><span className="num">01</span>Responsable del tratamiento</h2>
            <p>El responsable del tratamiento de tus datos personales es:</p>
            <table>
              <tbody>
                <tr><th style={{ width: '42%' }}>Denominación social</th><td>Sociedad Inversora Navarro Robinson S.L. (en adelante, "Ledens")</td></tr>
                <tr><th>NIF</th><td>B19753805</td></tr>
                <tr><th>Domicilio social</th><td>Avenida del Sor Teresa Prat 5, Polo Digital, Málaga</td></tr>
                <tr><th>Registro Mercantil</th><td>S 8, H MA182799, I/A 1 (21.06.24)</td></tr>
                <tr><th>Email de contacto</th><td><a href="mailto:alvaro.navarro@ledens.es">alvaro.navarro@ledens.es</a></td></tr>
                <tr><th>Teléfono</th><td>655 638 219</td></tr>
                <tr><th>Delegado de Protección de Datos (DPO)</th><td><a href="mailto:dpo@ledens.es">dpo@ledens.es</a></td></tr>
              </tbody>
            </table>
            <div className="callout">
              <i className="ri-information-line"></i>
              <div>
                <strong>Autoridad de control</strong>
                Tienes derecho a presentar una reclamación ante la Agencia Española de Protección de
                Datos (AEPD), C/ Jorge Juan, 6, 28001 Madrid ·{' '}
                <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>.
              </div>
            </div>
          </section>

          <section id="datos">
            <h2><span className="num">02</span>Datos personales que recogemos</h2>
            <p>Tratamos únicamente los datos personales estrictamente necesarios para prestarte el servicio. En función de tu interacción con Ledens, podemos recoger las siguientes categorías:</p>

            <h3>Datos identificativos y de contacto</h3>
            <ul>
              <li>Nombre y apellidos.</li>
              <li>Dirección de email.</li>
              <li>Teléfono de contacto.</li>
              <li>Dirección postal de la vivienda objeto de reforma.</li>
              <li>DNI/NIE (solo cuando es necesario para firmar el contrato de obra o tramitar boletines).</li>
            </ul>

            <h3>Datos de la solicitud o proyecto</h3>
            <ul>
              <li>Tipo de reforma, estancias afectadas y características del inmueble.</li>
              <li>Fotografías y planos que nos envíes voluntariamente.</li>
              <li>Comunicaciones por email, WhatsApp, chat o teléfono.</li>
            </ul>

            <h3>Datos contractuales y de facturación</h3>
            <ul>
              <li>Presupuestos firmados, contratos y certificaciones de obra.</li>
              <li>Datos bancarios (IBAN) y justificantes de pago.</li>
              <li>Facturas emitidas o recibidas.</li>
            </ul>

            <h3>Datos de navegación</h3>
            <ul>
              <li>Dirección IP, identificadores de dispositivo, navegador y sistema operativo.</li>
              <li>Páginas visitadas, tiempo de permanencia y origen del tráfico.</li>
              <li>Cookies y tecnologías similares (con tu consentimiento previo cuando proceda —
                ver nuestra <Link to="/cookies">Política de cookies</Link>).</li>
            </ul>

            <div className="callout callout-warn">
              <i className="ri-error-warning-line"></i>
              <div>
                <strong>No tratamos categorías especiales</strong>
                No solicitamos ni tratamos datos de salud, ideología, religión, orientación sexual u
                otros datos del art. 9 RGPD. Si nos los facilitas por error, los eliminaremos.
              </div>
            </div>
          </section>

          <section id="finalidades">
            <h2><span className="num">03</span>Finalidades del tratamiento</h2>
            <p>Tratamos tus datos para las siguientes finalidades concretas:</p>
            <ol className="list">
              <li><strong>Atender tu solicitud de presupuesto:</strong> contactarte, organizar la visita técnica y elaborar la propuesta económica.</li>
              <li><strong>Gestión contractual:</strong> ejecutar la reforma, emitir facturas, gestionar pagos y certificar el final de obra.</li>
              <li><strong>Servicio postventa y garantía:</strong> atender incidencias en garantía y mantener el historial de tu obra.</li>
              <li><strong>Acceso a tu panel de cliente:</strong> registrar tu cuenta, autenticarte y mostrarte el estado de tu reforma.</li>
              <li><strong>Comunicaciones de servicio:</strong> avisos operativos (visitas, cambios de planning, entregas).</li>
              <li><strong>Comunicaciones comerciales:</strong> únicamente cuando hayas dado tu consentimiento expreso o seas cliente y se trate de servicios análogos (art. 21.2 LSSI).</li>
              <li><strong>Obligaciones legales:</strong> contables, fiscales, laborales y de prevención del blanqueo de capitales cuando aplique.</li>
              <li><strong>Análisis estadístico y mejora del servicio:</strong> con datos agregados o seudonimizados.</li>
            </ol>
          </section>

          <section id="base">
            <h2><span className="num">04</span>Base jurídica del tratamiento</h2>
            <p>Conforme al artículo 6 del RGPD, las bases jurídicas que legitiman cada tratamiento son:</p>
            <table>
              <thead><tr><th>Finalidad</th><th>Base jurídica</th></tr></thead>
              <tbody>
                <tr><td>Atención de presupuesto previo al contrato</td><td>Aplicación de medidas precontractuales a petición del interesado <em>(art. 6.1.b RGPD)</em></td></tr>
                <tr><td>Ejecución de la reforma y facturación</td><td>Ejecución de contrato <em>(art. 6.1.b RGPD)</em></td></tr>
                <tr><td>Cuenta de cliente y panel online</td><td>Ejecución de contrato <em>(art. 6.1.b RGPD)</em></td></tr>
                <tr><td>Obligaciones contables y fiscales</td><td>Obligación legal <em>(art. 6.1.c RGPD)</em></td></tr>
                <tr><td>Comunicaciones comerciales no solicitadas</td><td>Consentimiento <em>(art. 6.1.a RGPD)</em></td></tr>
                <tr><td>Comunicaciones a clientes sobre servicios análogos</td><td>Interés legítimo <em>(art. 6.1.f RGPD y art. 21.2 LSSI)</em></td></tr>
                <tr><td>Cookies analíticas y de marketing</td><td>Consentimiento <em>(art. 6.1.a RGPD)</em></td></tr>
                <tr><td>Atención de tus derechos RGPD</td><td>Obligación legal <em>(art. 6.1.c RGPD)</em></td></tr>
              </tbody>
            </table>
          </section>

          <section id="conservacion">
            <h2><span className="num">05</span>Plazos de conservación</h2>
            <p>Conservamos tus datos durante el tiempo estrictamente necesario para las finalidades descritas y, posteriormente, mientras existan responsabilidades legales que cumplir.</p>
            <table>
              <thead><tr><th>Tipo de dato</th><th>Plazo</th></tr></thead>
              <tbody>
                <tr><td>Solicitud de presupuesto no contratada</td><td>12 meses desde el último contacto</td></tr>
                <tr><td>Datos contractuales y de obra</td><td>Durante la vigencia del contrato + 5 años (art. 1964 CC)</td></tr>
                <tr><td>Facturación y contabilidad</td><td>6 años (art. 30 Código de Comercio)</td></tr>
                <tr><td>Datos fiscales</td><td>4 años (Ley General Tributaria)</td></tr>
                <tr><td>Cuenta de cliente</td><td>Hasta solicitud de baja + bloqueo legal correspondiente</td></tr>
                <tr><td>Consentimientos para marketing</td><td>Hasta su revocación</td></tr>
                <tr><td>Datos de navegación / cookies</td><td>Según se indique en la <Link to="/cookies">Política de cookies</Link></td></tr>
              </tbody>
            </table>
            <p>Transcurridos los plazos, los datos quedarán bloqueados durante el tiempo en que puedan derivarse responsabilidades y, después, serán eliminados de forma segura.</p>
          </section>

          <section id="destinatarios">
            <h2><span className="num">06</span>Destinatarios y encargados del tratamiento</h2>
            <p>Tus datos no se ceden a terceros salvo obligación legal. Sí utilizamos prestadores de servicios (encargados del tratamiento) que acceden a tus datos exclusivamente para prestarnos su servicio, bajo contrato firmado conforme al art. 28 RGPD.</p>
            <table>
              <thead><tr><th>Proveedor</th><th>Servicio</th><th>Ubicación</th></tr></thead>
              <tbody>
                <tr><td>Amazon Web Services EMEA SARL</td><td>Hosting y bases de datos</td><td>Unión Europea (Irlanda / Frankfurt)</td></tr>
                <tr><td>Google Ireland Ltd.</td><td>Email corporativo (Workspace) y analítica</td><td>Unión Europea + Estados Unidos</td></tr>
                <tr><td>Microsoft Ireland Ltd.</td><td>Autenticación con cuenta Microsoft (opcional)</td><td>Unión Europea</td></tr>
                <tr><td>Stripe Payments Europe Ltd.</td><td>Procesamiento de pagos</td><td>Unión Europea</td></tr>
                <tr><td>Meta Platforms Ireland Ltd.</td><td>WhatsApp Business para comunicación con clientes</td><td>Unión Europea + Estados Unidos</td></tr>
                <tr><td>Asesoría fiscal y laboral externa</td><td>Contabilidad y nóminas</td><td>España</td></tr>
              </tbody>
            </table>
            <p>También podremos comunicar tus datos a Administraciones Públicas, Fuerzas y Cuerpos de Seguridad y órganos jurisdiccionales cuando exista obligación legal.</p>
          </section>

          <section id="transferencias">
            <h2><span className="num">07</span>Transferencias internacionales de datos</h2>
            <p>Tratamos tus datos preferentemente dentro del Espacio Económico Europeo (EEE). Cuando alguno de nuestros proveedores trate datos fuera del EEE (por ejemplo, en Estados Unidos), garantizamos un nivel adecuado de protección mediante:</p>
            <ul>
              <li>Adhesión al <strong>Data Privacy Framework UE-EE.UU.</strong> aprobado por la Decisión de Adecuación de la Comisión Europea de 10 de julio de 2023.</li>
              <li>La firma de <strong>Cláusulas Contractuales Tipo</strong> aprobadas por la Comisión Europea (Decisión 2021/914).</li>
              <li>Medidas técnicas complementarias (cifrado en tránsito y en reposo, seudonimización).</li>
            </ul>
            <p>Puedes solicitar copia de estas garantías escribiéndonos a <a href="mailto:dpo@ledens.es">dpo@ledens.es</a>.</p>
          </section>

          <section id="decisiones">
            <h2><span className="num">08</span>Decisiones automatizadas y elaboración de perfiles</h2>
            <p>Ledens <strong>no toma decisiones automatizadas con efectos jurídicos significativos</strong> sobre los interesados en el sentido del artículo 22 del RGPD. Las decisiones contractuales relevantes (aceptación de presupuesto, calendario de obra, garantías) son siempre revisadas por una persona del equipo.</p>
            <p>Sí podemos usar herramientas de análisis automatizado para sugerir oportunidades inmobiliarias en función de tus criterios declarados; estos resultados son meras propuestas que no afectan a tus derechos hasta que tú decidas actuar sobre ellos.</p>
          </section>

          <section id="derechos">
            <h2><span className="num">09</span>Tus derechos como interesado</h2>
            <p>Como titular de los datos, el RGPD te reconoce los siguientes derechos, que puedes ejercer de forma gratuita en cualquier momento:</p>
            <div className="rights-grid">
              <div className="right-card"><h4><i className="ri-eye-line"></i>Acceso</h4><p>Saber qué datos tuyos tratamos y obtener una copia de los mismos.</p></div>
              <div className="right-card"><h4><i className="ri-edit-line"></i>Rectificación</h4><p>Corregir datos inexactos o completar los que estén incompletos.</p></div>
              <div className="right-card"><h4><i className="ri-delete-bin-line"></i>Supresión</h4><p>Solicitar el borrado de tus datos cuando ya no sean necesarios.</p></div>
              <div className="right-card"><h4><i className="ri-lock-line"></i>Limitación</h4><p>Pedirnos que paralicemos el tratamiento mientras se resuelve una controversia.</p></div>
              <div className="right-card"><h4><i className="ri-close-circle-line"></i>Oposición</h4><p>Oponerte al tratamiento basado en interés legítimo, incluido el marketing directo.</p></div>
              <div className="right-card"><h4><i className="ri-download-2-line"></i>Portabilidad</h4><p>Recibir tus datos en formato estructurado y transmitirlos a otro responsable.</p></div>
              <div className="right-card"><h4><i className="ri-shield-cross-line"></i>No ser objeto de decisiones automatizadas</h4><p>Solicitar intervención humana en decisiones puramente automatizadas.</p></div>
              <div className="right-card"><h4><i className="ri-arrow-go-back-line"></i>Retirada del consentimiento</h4><p>Retirar en cualquier momento el consentimiento dado, sin efecto retroactivo.</p></div>
            </div>

            <h3>¿Cómo ejercer tus derechos?</h3>
            <ul>
              <li>Enviar un email a <a href="mailto:dpo@ledens.es">dpo@ledens.es</a> indicando el derecho que ejerces y adjuntando copia de tu DNI o documento equivalente.</li>
              <li>Escribir por correo postal a Sociedad Inversora Navarro Robinson S.L., Avenida del Sor Teresa Prat 5, Polo Digital, Málaga.</li>
              <li>Acceder a tu cuenta de cliente y usar las opciones de descarga y eliminación de datos.</li>
            </ul>
            <p>Resolveremos tu solicitud en el plazo máximo de <strong>un mes</strong>, prorrogable en dos meses adicionales en casos especialmente complejos (art. 12.3 RGPD).</p>
            <div className="callout callout-ok">
              <i className="ri-checkbox-circle-line"></i>
              <div>
                <strong>Reclamación ante la AEPD</strong>
                Si consideras que no hemos atendido correctamente tus derechos, puedes reclamar ante la
                Agencia Española de Protección de Datos en{' '}
                <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>.
              </div>
            </div>
          </section>

          <section id="seguridad">
            <h2><span className="num">10</span>Seguridad de la información</h2>
            <p>Hemos implantado las medidas técnicas y organizativas apropiadas para garantizar un nivel de seguridad adecuado al riesgo, conforme al artículo 32 del RGPD. Entre ellas:</p>
            <ul>
              <li>Cifrado de comunicaciones (TLS 1.3) y de datos en reposo.</li>
              <li>Control de accesos basado en roles y autenticación multifactor para personal.</li>
              <li>Copias de seguridad cifradas y pruebas periódicas de recuperación.</li>
              <li>Análisis de riesgos y evaluación de impacto (DPIA) cuando proceda.</li>
              <li>Formación periódica del personal en protección de datos.</li>
              <li>Procedimiento de notificación de brechas de seguridad (72 h a la AEPD).</li>
            </ul>
          </section>

          <section id="menores">
            <h2><span className="num">11</span>Menores de edad</h2>
            <p>Nuestros servicios están dirigidos exclusivamente a personas mayores de 18 años. No recogemos conscientemente datos personales de menores. Si detectamos que se han facilitado datos de un menor sin el consentimiento de los titulares de la patria potestad o tutela, los eliminaremos de forma inmediata.</p>
          </section>

          <section id="cambios">
            <h2><span className="num">12</span>Cambios en esta política</h2>
            <p>Podremos actualizar esta política para reflejar cambios normativos, técnicos o de nuestros servicios. Si los cambios son sustanciales, te lo comunicaremos por email o mediante un aviso destacado en la web con al menos <strong>30 días de antelación</strong> a su entrada en vigor.</p>
            <p>La versión vigente es siempre la publicada en esta página, indicada con su fecha de actualización.</p>
          </section>

          <div className="legal-contact">
            <div>
              <h3>¿Dudas sobre tus datos?</h3>
              <p>Nuestro Delegado de Protección de Datos te responde en menos de 72 horas laborables.</p>
            </div>
            <div className="actions">
              <a href="mailto:dpo@ledens.es"><i className="ri-mail-line"></i> dpo@ledens.es</a>
              <a href="tel:+34655638219"><i className="ri-phone-line"></i> 655 638 219</a>
            </div>
          </div>

        </article>
      </div>

      <Footer />

      <a
        className="wa-float"
        href="https://wa.me/34655638219"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp"
      >
        <i className="ri-whatsapp-fill"></i>
      </a>
    </>
  );
}
