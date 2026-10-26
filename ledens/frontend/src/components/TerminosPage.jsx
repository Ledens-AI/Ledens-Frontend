import React from 'react';
import { Link } from 'react-router-dom';
import Footer from './Footer.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import useTocHighlight from './legal/useTocHighlight.js';
import TerminosEn from './legal/TerminosEn.jsx';


const TOC = [
  { id: 'identificacion',  label: 'Identificación del prestador' },
  { id: 'objeto',          label: 'Objeto y aceptación' },
  { id: 'usuarios',        label: 'Usuarios y registro' },
  { id: 'contratacion',    label: 'Proceso de contratación' },
  { id: 'precios',         label: 'Precios, pagos e impuestos' },
  { id: 'ejecucion',       label: 'Ejecución de la obra' },
  { id: 'desistimiento',   label: 'Derecho de desistimiento' },
  { id: 'garantia',        label: 'Garantías legales' },
  { id: 'responsabilidad', label: 'Limitación de responsabilidad' },
  { id: 'propiedad',       label: 'Propiedad intelectual' },
  { id: 'conducta',        label: 'Uso aceptable' },
  { id: 'suspension',      label: 'Suspensión y terminación' },
  { id: 'reclamaciones',   label: 'Reclamaciones y litigios' },
  { id: 'legislacion',     label: 'Legislación y jurisdicción' },
  { id: 'general',         label: 'Disposiciones generales' },
];

/* The English text lives in legal/TerminosEn.jsx — keep both in step. */
export default function TerminosPage() {
  const { lang } = useI18n();
  return lang === 'en' ? <TerminosEn /> : <TerminosPageEs />;
}

function TerminosPageEs() {
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
            <span className="here">Términos y Condiciones</span>
          </div>
          <span className="legal-eb"><i className="ri-scales-3-line"></i> LSSI · TRLGDCU · Reglamento (UE) 2019/771</span>
          <h1>Términos y Condiciones de Servicio</h1>
          <p className="lead">
            Estos Términos rigen el uso de la web y los servicios de Ledens, así como la
            contratación de obras de reforma. Léelos con calma: contienen tus derechos como
            consumidor europeo y nuestras obligaciones como empresa.
          </p>
          <div className="legal-meta">
            <div><i className="ri-calendar-line"></i> Última actualización: <strong>19 de mayo de 2026</strong></div>
            <div><i className="ri-file-text-line"></i> Versión <strong>2.1</strong></div>
            <div><i className="ri-time-line"></i> Lectura: <strong>~12 min</strong></div>
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

          <section id="identificacion">
            <h2><span className="num">01</span>Identificación del prestador del servicio</h2>
            <p>En cumplimiento del artículo 10 de la Ley 34/2002 de Servicios de la Sociedad de la Información y Comercio Electrónico (LSSI-CE), se informa de los siguientes datos identificativos:</p>
            <table>
              <tbody>
                <tr><th style={{ width: '42%' }}>Denominación social</th><td>Sociedad Inversora Navarro Robinson S.L.</td></tr>
                <tr><th>NIF</th><td>B19753805</td></tr>
                <tr><th>Domicilio social</th><td>Avenida del Sor Teresa Prat 5, Polo Digital, Málaga</td></tr>
                <tr><th>Datos registrales</th><td>S 8, H MA182799, I/A 1 (21.06.24)</td></tr>
                <tr><th>Email</th><td><a href="mailto:alvaro.navarro@ledens.es">alvaro.navarro@ledens.es</a></td></tr>
                <tr><th>Teléfono</th><td>655 638 219</td></tr>
                <tr><th>Sitio web</th><td><a href="https://www.ledens.es" target="_blank" rel="noopener noreferrer">www.ledens.es</a></td></tr>
              </tbody>
            </table>
          </section>

          <section id="objeto">
            <h2><span className="num">02</span>Objeto y aceptación</h2>
            <p>Los presentes <strong>Términos y Condiciones</strong> (en adelante, los "Términos") regulan:</p>
            <ol className="list">
              <li>El acceso y uso de la web <a href="https://www.ledens.es">www.ledens.es</a> y de la aplicación de cliente de Ledens.</li>
              <li>La solicitud de presupuestos de reforma y la contratación de los servicios prestados por Ledens.</li>
              <li>Cualquier servicio digital complementario (panel de cliente, comunicación por chat, fotografías de seguimiento de obra).</li>
            </ol>
            <p>La utilización de la web y/o la solicitud de cualquier servicio implica la <strong>aceptación expresa y plena</strong> de estos Términos en su versión vigente en el momento de cada uso. Si no estás de acuerdo, te rogamos que no utilices nuestros servicios.</p>
            <div className="callout">
              <i className="ri-user-3-line"></i>
              <div>
                <strong>Estos Términos se firman entre dos partes</strong>
                "Nosotros", "Ledens" o "el prestador" se refiere a Sociedad Inversora Navarro Robinson S.L. "Tú", "el usuario"
                o "el cliente" se refiere a la persona física o jurídica que utiliza la web o contrata los servicios.
              </div>
            </div>
          </section>

          <section id="usuarios">
            <h2><span className="num">03</span>Usuarios y registro</h2>
            <p>Para acceder a la web no es necesario registrarse. Para contratar servicios o acceder al panel de cliente debes:</p>
            <ul>
              <li>Ser <strong>mayor de 18 años</strong> y tener capacidad legal para contratar.</li>
              <li>Facilitar datos veraces, exactos y actualizados.</li>
              <li>Custodiar la confidencialidad de tus credenciales (email, contraseña y, en su caso, identificadores de Google o Microsoft).</li>
              <li>Notificarnos inmediatamente cualquier uso no autorizado de tu cuenta.</li>
            </ul>
            <p>Eres responsable de todas las actividades realizadas bajo tu cuenta. Ledens no será responsable de los daños derivados del uso indebido por terceros mientras no se nos comunique el incidente.</p>
          </section>

          <section id="contratacion">
            <h2><span className="num">04</span>Proceso de contratación</h2>
            <h3>4.1 Solicitud de presupuesto</h3>
            <p>La solicitud de presupuesto a través de la web, WhatsApp, teléfono o email <strong>no genera obligación contractual</strong> alguna. Es una propuesta de evaluación gratuita y sin compromiso. Tras la visita técnica te entregaremos un presupuesto cerrado por escrito.</p>

            <h3>4.2 Perfeccionamiento del contrato</h3>
            <p>El contrato de reforma se perfecciona en el momento en que firmas el presupuesto (físicamente o electrónicamente) y se cobra la señal indicada en el mismo. A partir de ese momento, el presupuesto firmado, sus anexos y los presentes Términos constituyen el <strong>acuerdo completo</strong> entre las partes.</p>

            <h3>4.3 Confirmación documental</h3>
            <p>Tras la firma recibirás por email una confirmación con:</p>
            <ul>
              <li>Una copia del presupuesto firmado y de estos Términos.</li>
              <li>Plazo previsto de inicio (en regla general, ≤ 48 h desde la firma).</li>
              <li>Calendario estimado de obra y forma de pago.</li>
              <li>Información sobre el derecho de desistimiento (ver sección 7).</li>
            </ul>
            <p>Los documentos serán archivados por Ledens y podrás acceder a ellos en tu panel de cliente.</p>
          </section>

          <section id="precios">
            <h2><span className="num">05</span>Precios, pagos e impuestos</h2>
            <h3>5.1 Precios</h3>
            <p>Todos los precios mostrados en la web o en los presupuestos están expresados <strong>en euros (€) e incluyen el IVA</strong> aplicable, salvo que expresamente se indique lo contrario. Los precios son válidos durante el plazo indicado en el presupuesto (en general, <strong>30 días</strong> desde su emisión).</p>

            <h3>5.2 Presupuesto cerrado</h3>
            <p>Salvo modificación expresa del cliente, el precio acordado tiene carácter de <strong>cerrado y a tanto alzado</strong>. No se aplicarán sobrecostes salvo cambios solicitados por escrito o por causas técnicas sobrevenidas debidamente justificadas que no pudieran detectarse en la visita técnica.</p>

            <h3>5.3 Formas de pago</h3>
            <ul>
              <li>Transferencia bancaria al IBAN indicado en la factura.</li>
              <li>Tarjeta de débito/crédito a través de Stripe (PCI-DSS Nivel 1).</li>
              <li>Domiciliación bancaria (SEPA Direct Debit) para clientes con plan recurrente.</li>
            </ul>

            <h3>5.4 Calendario de pagos habitual</h3>
            <table>
              <thead><tr><th>Hito</th><th>Importe</th></tr></thead>
              <tbody>
                <tr><td>Señal a la firma del presupuesto</td><td>30 %</td></tr>
                <tr><td>Inicio de obra (provisión de materiales)</td><td>40 %</td></tr>
                <tr><td>Hito intermedio (validación del cliente)</td><td>20 %</td></tr>
                <tr><td>Entrega final de la obra</td><td>10 %</td></tr>
              </tbody>
            </table>

            <h3>5.5 Impagos</h3>
            <p>El retraso en el pago de cualquier hito faculta a Ledens a suspender la obra previo aviso de <strong>7 días</strong> y a aplicar el interés legal del dinero incrementado en 2 puntos sobre el saldo pendiente (art. 1108 CC).</p>
          </section>

          <section id="ejecucion">
            <h2><span className="num">06</span>Ejecución de la obra</h2>
            <h3>6.1 Plazos</h3>
            <p>Los plazos indicados en el presupuesto son <strong>esenciales y de obligado cumplimiento</strong> para Ledens. Si por causa imputable a Ledens se incumple el plazo final pactado, el cliente tendrá derecho a una <strong>penalización del 0,2% del precio por cada día natural de retraso</strong>, con un tope del 5% del importe total del contrato.</p>

            <h3>6.2 Obligaciones del cliente</h3>
            <ul>
              <li>Permitir el acceso al inmueble en los horarios pactados.</li>
              <li>Gestionar las autorizaciones de la comunidad de propietarios cuando proceda.</li>
              <li>Retirar muebles y objetos personales antes del inicio.</li>
              <li>Asegurar el suministro de agua y luz en obra.</li>
            </ul>

            <h3>6.3 Subcontratación</h3>
            <p>Ledens podrá subcontratar a profesionales especializados (electricistas habilitados, instaladores RITE, etc.) manteniendo en todo momento la <strong>responsabilidad directa frente al cliente</strong>. Todos los subcontratistas están dados de alta en la Seguridad Social y cuentan con el seguro de Responsabilidad Civil exigible.</p>

            <h3>6.4 Modificaciones</h3>
            <p>Cualquier modificación del proyecto solicitada por el cliente generará una <strong>adenda firmada</strong> con su nuevo precio y plazo. No se ejecutará ningún cambio sin documento escrito.</p>

            <h3>6.5 Causas de fuerza mayor</h3>
            <p>Quedan excluidos de la responsabilidad de Ledens los retrasos derivados de causas de fuerza mayor (catástrofes naturales, huelgas generales, decisiones de la Administración, pandemias declaradas) conforme al artículo 1105 del Código Civil. En tales casos, el plazo se prorrogará por el tiempo equivalente.</p>
          </section>

          <section id="desistimiento">
            <h2><span className="num">07</span>Derecho de desistimiento</h2>
            <div className="callout callout-warn">
              <i className="ri-alarm-warning-line"></i>
              <div>
                <strong>14 días para cambiar de opinión</strong>
                Como consumidor, si has firmado el contrato fuera de nuestro establecimiento o por medios
                telemáticos, dispones de un plazo de 14 días naturales para desistir sin necesidad de
                justificación, conforme a los artículos 102 y siguientes del Real Decreto Legislativo
                1/2007 (TRLGDCU).
              </div>
            </div>

            <h3>7.1 Plazo</h3>
            <p>El plazo de <strong>14 días naturales</strong> empieza a contar desde la firma del contrato. Se considerará respetado si la comunicación de desistimiento se envía antes de que finalice dicho plazo.</p>

            <h3>7.2 Cómo desistir</h3>
            <ul>
              <li>Email a <a href="mailto:hola@ledens.es">hola@ledens.es</a> con el asunto "Desistimiento".</li>
              <li>Carta postal al domicilio social.</li>
              <li>Formulario de desistimiento disponible en tu panel de cliente.</li>
            </ul>

            <h3>7.3 Modelo oficial de desistimiento</h3>
            <p>Puedes utilizar el siguiente modelo, aunque no es obligatorio:</p>
            <div className="callout">
              <i className="ri-double-quotes-l"></i>
              <div>
                <em>
                  A la atención de Sociedad Inversora Navarro Robinson S.L. (Avenida del Sor Teresa Prat 5, Polo Digital, Málaga · alvaro.navarro@ledens.es):<br />
                  Por la presente le comunico que desisto de mi contrato de reforma firmado el [fecha].<br />
                  Nombre del consumidor: [—] · Domicilio: [—] · Fecha: [—] · Firma (solo si se envía en papel).
                </em>
              </div>
            </div>

            <h3>7.4 Efectos del desistimiento</h3>
            <p>Tras la recepción de tu comunicación, te reembolsaremos todas las cantidades abonadas en un plazo máximo de <strong>14 días naturales</strong>, utilizando el mismo medio de pago que empleaste, salvo que indiques lo contrario. No incurrirás en gasto alguno como consecuencia del reembolso.</p>

            <h3>7.5 Excepciones legales</h3>
            <p>Conforme al artículo 103 TRLGDCU, no procederá el desistimiento cuando:</p>
            <ul>
              <li>La obra se haya ejecutado <strong>en su totalidad</strong> y haya comenzado con tu consentimiento expreso previo y conocimiento de la pérdida del derecho.</li>
              <li>Se trate de bienes confeccionados conforme a tus especificaciones (mobiliario a medida, encimeras cortadas, etc.) y ya fabricados.</li>
              <li>El servicio sea de reparación urgente solicitada por ti.</li>
            </ul>
            <p>Si solicitas que la prestación comience durante el plazo de desistimiento y posteriormente desistes, deberás abonar el importe proporcional a la parte ejecutada.</p>
          </section>

          <section id="garantia">
            <h2><span className="num">08</span>Garantías legales</h2>
            <p>Las obras y servicios prestados por Ledens están cubiertos por las siguientes garantías:</p>

            <h3>8.1 Garantía de conformidad (Reglamento UE 2019/771 y arts. 114 ss TRLGDCU)</h3>
            <ul>
              <li><strong>3 años</strong> desde la entrega para los bienes muebles incorporados a la reforma.</li>
              <li><strong>2 años</strong> sobre la mano de obra y los acabados conforme al art. 1591 CC.</li>
            </ul>

            <h3>8.2 Responsabilidad decenal en obras de construcción</h3>
            <p>De acuerdo con el artículo 17 de la Ley 38/1999 de Ordenación de la Edificación, cuando proceda por la naturaleza de la intervención:</p>
            <ul>
              <li><strong>10 años</strong> por daños que afecten a elementos estructurales.</li>
              <li><strong>3 años</strong> por daños que afecten a la habitabilidad.</li>
              <li><strong>1 año</strong> por defectos de acabado.</li>
            </ul>

            <h3>8.3 Cómo reclamar</h3>
            <p>Para activar la garantía contacta con nosotros en <a href="mailto:hola@ledens.es">hola@ledens.es</a> o a través de tu panel de cliente describiendo la incidencia y, si es posible, adjuntando fotografías. Te responderemos en un plazo máximo de <strong>72 horas laborables</strong>.</p>

            <div className="callout callout-ok">
              <i className="ri-shield-check-line"></i>
              <div>
                <strong>Sin coste para el consumidor</strong>
                La reparación, sustitución o subsanación amparada por la garantía es totalmente gratuita
                para el cliente, sin afectar al cómputo del plazo de garantía durante el tiempo que dure
                la intervención.
              </div>
            </div>
          </section>

          <section id="responsabilidad">
            <h2><span className="num">09</span>Limitación de responsabilidad</h2>
            <p>Ledens responde de los daños directos derivados del incumplimiento de sus obligaciones contractuales en los términos previstos en el TRLGDCU y el Código Civil.</p>
            <p>Dentro de los límites permitidos por la legislación aplicable, Ledens <strong>no será responsable</strong> de:</p>
            <ul>
              <li>Daños indirectos, lucro cesante, pérdida de oportunidades o de datos.</li>
              <li>Daños derivados del mal uso, modificación o intervención de terceros no autorizada por Ledens sobre la obra entregada.</li>
              <li>Interrupciones temporales de la web por mantenimiento, fallos de servicios de terceros o fuerza mayor.</li>
            </ul>
            <p>Las limitaciones anteriores <strong>no se aplican</strong> en caso de dolo, culpa grave, daños personales o lesión causada al consumidor, ni respecto de los derechos imperativos reconocidos por la normativa de consumo.</p>
          </section>

          <section id="propiedad">
            <h2><span className="num">10</span>Propiedad intelectual e industrial</h2>
            <p>Todos los contenidos de la web (textos, gráficos, fotografías, vídeos, código fuente, marcas, logotipos) son titularidad de Ledens o de sus licenciantes y están protegidos por la legislación española y europea de propiedad intelectual e industrial.</p>
            <p>Queda <strong>expresamente prohibida</strong> su reproducción, distribución, comunicación pública, transformación o cualquier otra forma de explotación sin autorización previa y por escrito de Ledens.</p>
            <p>Las fotografías de proyectos realizados podrán ser utilizadas por Ledens para fines comerciales <strong>respetando siempre la intimidad del cliente</strong> y nunca mostrando datos identificativos sin consentimiento expreso.</p>
          </section>

          <section id="conducta">
            <h2><span className="num">11</span>Uso aceptable de la web y los servicios</h2>
            <p>El usuario se compromete a utilizar la web y los servicios de forma diligente, correcta y lícita, absteniéndose de:</p>
            <ul>
              <li>Acceder o intentar acceder a recursos restringidos sin autorización.</li>
              <li>Realizar acciones que puedan dañar, sobrecargar o deteriorar los sistemas.</li>
              <li>Introducir virus, troyanos u otros programas maliciosos.</li>
              <li>Recopilar datos de terceros sin su consentimiento.</li>
              <li>Suplantar la identidad de otra persona o entidad.</li>
              <li>Utilizar la web con fines contrarios a la ley, la moral o el orden público.</li>
            </ul>
          </section>

          <section id="suspension">
            <h2><span className="num">12</span>Suspensión y terminación</h2>
            <p>Ledens podrá suspender o cancelar el acceso a la web y/o el contrato en caso de incumplimiento grave de estos Términos por parte del usuario, previo aviso razonable salvo en casos de urgencia justificada.</p>
            <p>El cliente podrá resolver el contrato en cualquier momento, salvo causa pactada en contrario, abonando los servicios ya prestados y los gastos justificados incurridos por Ledens hasta la fecha de la resolución.</p>
          </section>

          <section id="reclamaciones">
            <h2><span className="num">13</span>Reclamaciones y resolución de litigios</h2>
            <h3>13.1 Hojas de reclamaciones</h3>
            <p>Ledens dispone de hojas oficiales de reclamaciones a disposición de los consumidores conforme al Decreto 72/2008 de la Junta de Andalucía. Puedes solicitarlas en cualquiera de nuestras oficinas o por email a <a href="mailto:hola@ledens.es">hola@ledens.es</a>.</p>

            <h3>13.2 Resolución amistosa</h3>
            <p>Antes de acudir a la vía judicial, te invitamos a contactar con nuestro servicio de atención al cliente. Nos comprometemos a responder a cualquier reclamación en un plazo máximo de <strong>1 mes</strong>.</p>

            <h3>13.3 Plataforma de resolución de litigios en línea</h3>
            <p>Conforme al Reglamento (UE) 524/2013, te informamos de la existencia de la plataforma europea de Resolución de Litigios en Línea, accesible en:</p>
            <p><a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr</a></p>

            <h3>13.4 Junta Arbitral de Consumo</h3>
            <p>Si lo prefieres, puedes acudir a la Junta Arbitral de Consumo de Andalucía, cuya intervención aceptamos para resolver cualquier controversia derivada de la prestación de nuestros servicios a consumidores.</p>
          </section>

          <section id="legislacion">
            <h2><span className="num">14</span>Legislación aplicable y jurisdicción</h2>
            <p>Estos Términos se rigen por la <strong>legislación española</strong> y, en lo aplicable, por el Derecho de la Unión Europea.</p>
            <p>Para cualquier controversia derivada de su interpretación o ejecución, las partes se someten:</p>
            <ul>
              <li><strong>Si el cliente es consumidor:</strong> a los tribunales del domicilio del consumidor, conforme al artículo 90.2 TRLGDCU.</li>
              <li><strong>Si el cliente es profesional o empresa:</strong> a los Juzgados y Tribunales de Málaga capital, con renuncia expresa a cualquier otro fuero que pudiera corresponderles.</li>
            </ul>
          </section>

          <section id="general">
            <h2><span className="num">15</span>Disposiciones generales</h2>
            <h3>15.1 Modificaciones</h3>
            <p>Podemos actualizar estos Términos en cualquier momento. Los cambios sustanciales se comunicarán por email a los usuarios registrados con al menos <strong>30 días</strong> de antelación a su entrada en vigor.</p>

            <h3>15.2 Nulidad parcial</h3>
            <p>Si alguna cláusula de estos Términos fuera declarada nula o inaplicable por un tribunal, las restantes mantendrán plena vigencia. La cláusula nula será sustituida por otra válida que persiga la misma finalidad.</p>

            <h3>15.3 Notificaciones</h3>
            <p>Las notificaciones entre las partes se realizarán por email a las direcciones indicadas en el contrato. Las notificaciones a Ledens podrán dirigirse a <a href="mailto:hola@ledens.es">hola@ledens.es</a>.</p>

            <h3>15.4 Cesión</h3>
            <p>El cliente no podrá ceder su posición contractual sin consentimiento previo y por escrito de Ledens. Ledens podrá ceder sus derechos y obligaciones a terceros siempre que ello no suponga merma alguna de los derechos del cliente.</p>

            <h3>15.5 Idioma</h3>
            <p>Estos Términos se publican en español. En caso de traducción a otros idiomas, prevalecerá la versión española en caso de discrepancia.</p>
          </section>

          <div className="legal-contact">
            <div>
              <h3>¿Dudas con los Términos?</h3>
              <p>Nuestro equipo legal te lo aclara en menos de 48 horas laborables. Sin formalismos.</p>
            </div>
            <div className="actions">
              <a href="mailto:legal@ledens.es"><i className="ri-mail-line"></i> legal@ledens.es</a>
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
