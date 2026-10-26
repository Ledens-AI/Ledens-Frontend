import React from 'react';
import { Link } from 'react-router-dom';
import Footer from '../Footer.jsx';
import useTocHighlight from './useTocHighlight.js';

/* English translation of PrivacidadPage — keep both in step. */
const TOC = [
  { id: 'responsable',    label: 'Data controller' },
  { id: 'datos',          label: 'Data we collect' },
  { id: 'finalidades',    label: 'What we use it for' },
  { id: 'base',           label: 'Legal basis for processing' },
  { id: 'conservacion',   label: 'Retention periods' },
  { id: 'destinatarios',  label: 'Recipients and processors' },
  { id: 'transferencias', label: 'International transfers' },
  { id: 'decisiones',     label: 'Automated decisions' },
  { id: 'derechos',       label: 'Your rights' },
  { id: 'seguridad',      label: 'Information security' },
  { id: 'menores',        label: 'Minors' },
  { id: 'cambios',        label: 'Changes to this policy' },
];

export default function PrivacidadEn() {
  const activeId = useTocHighlight(TOC.map(t => t.id));

  return (
    <>
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <div className="legal-crumbs">
            <Link to="/">Home</Link>
            <span className="sep">/</span>
            <span>Legal</span>
            <span className="sep">/</span>
            <span className="here">Privacy policy</span>
          </div>
          <span className="legal-eb"><i className="ri-shield-keyhole-line"></i> GDPR · LOPDGDD</span>
          <h1>Ledens Privacy Policy</h1>
          <p className="lead">
            Your privacy matters to us. Here we explain, with no small print, what personal
            data we process, why we process it, how long we keep it and what rights you have
            over it under Regulation (EU) 2016/679 (GDPR) and the Spanish LOPDGDD.
          </p>
          <div className="legal-meta">
            <div><i className="ri-calendar-line"></i> Last updated: <strong>19 May 2026</strong></div>
            <div><i className="ri-file-text-line"></i> Version <strong>2.1</strong></div>
            <div><i className="ri-time-line"></i> Reading time: <strong>~8 min</strong></div>
          </div>
        </div>
      </section>

      <div className="legal-shell">
        <aside className="toc">
          <div className="toc-title">Contents</div>
          <ol>
            {TOC.map(item => (
              <li key={item.id}>
                <a href={`#${item.id}`} className={activeId === item.id ? 'active' : ''}>
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <article className="legal-content">
          <div className="callout">
            <i className="ri-translate-2"></i>
            <div>
              <strong>About this translation</strong>
              This English version is provided for convenience. If there is any discrepancy, the Spanish version prevails.
            </div>
          </div>

          <section id="responsable">
            <h2><span className="num">01</span>Data controller</h2>
            <p>The controller of your personal data is:</p>
            <table>
              <tbody>
                <tr><th style={{ width: '42%' }}>Company name</th><td>Sociedad Inversora Navarro Robinson S.L. (hereinafter, "Ledens")</td></tr>
                <tr><th>Tax ID (NIF)</th><td>B19753805</td></tr>
                <tr><th>Registered office</th><td>Avenida del Sor Teresa Prat 5, Polo Digital, Málaga</td></tr>
                <tr><th>Commercial Register</th><td>S 8, H MA182799, I/A 1 (21.06.24)</td></tr>
                <tr><th>Contact email</th><td><a href="mailto:alvaro.navarro@ledens.es">alvaro.navarro@ledens.es</a></td></tr>
                <tr><th>Phone</th><td>+34 655 638 219</td></tr>
                <tr><th>Data Protection Officer (DPO)</th><td><a href="mailto:dpo@ledens.es">dpo@ledens.es</a></td></tr>
              </tbody>
            </table>
            <div className="callout">
              <i className="ri-information-line"></i>
              <div>
                <strong>Supervisory authority</strong>
                You have the right to lodge a complaint with the Spanish Data Protection Agency
                (AEPD), C/ Jorge Juan, 6, 28001 Madrid ·{' '}
                <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>.
              </div>
            </div>
          </section>

          <section id="datos">
            <h2><span className="num">02</span>Personal data we collect</h2>
            <p>We only process the personal data strictly necessary to provide our service. Depending on how you interact with Ledens, we may collect the following categories:</p>

            <h3>Identification and contact data</h3>
            <ul>
              <li>First name and surname(s).</li>
              <li>Email address.</li>
              <li>Contact phone number.</li>
              <li>Postal address of the property being renovated.</li>
              <li>DNI/NIE (only when needed to sign the works contract or file certificates).</li>
            </ul>

            <h3>Request or project data</h3>
            <ul>
              <li>Type of renovation, rooms involved and features of the property.</li>
              <li>Photos and plans you send us voluntarily.</li>
              <li>Communications by email, WhatsApp, chat or phone.</li>
            </ul>

            <h3>Contract and billing data</h3>
            <ul>
              <li>Signed quotes, contracts and works certificates.</li>
              <li>Bank details (IBAN) and proof of payment.</li>
              <li>Invoices issued or received.</li>
            </ul>

            <h3>Browsing data</h3>
            <ul>
              <li>IP address, device identifiers, browser and operating system.</li>
              <li>Pages visited, time spent and source of traffic.</li>
              <li>Cookies and similar technologies (with your prior consent where applicable —
                see our <Link to="/cookies">Cookie policy</Link>).</li>
            </ul>

            <div className="callout callout-warn">
              <i className="ri-error-warning-line"></i>
              <div>
                <strong>We do not process special categories</strong>
                We do not ask for or process data about health, beliefs, religion, sexual orientation
                or any other data under Art. 9 GDPR. If you give it to us by mistake, we will delete it.
              </div>
            </div>
          </section>

          <section id="finalidades">
            <h2><span className="num">03</span>Purposes of processing</h2>
            <p>We process your data for the following specific purposes:</p>
            <ol className="list">
              <li><strong>Handling your quote request:</strong> contacting you, arranging the technical visit and preparing the financial proposal.</li>
              <li><strong>Contract management:</strong> carrying out the renovation, issuing invoices, managing payments and certifying completion.</li>
              <li><strong>After-sales service and guarantee:</strong> dealing with guarantee claims and keeping the history of your works.</li>
              <li><strong>Access to your client area:</strong> registering your account, authenticating you and showing you the status of your renovation.</li>
              <li><strong>Service communications:</strong> operational notices (visits, schedule changes, handovers).</li>
              <li><strong>Marketing communications:</strong> only when you have given your express consent, or you are a client and they concern similar services (Art. 21.2 LSSI).</li>
              <li><strong>Legal obligations:</strong> accounting, tax, employment and anti-money-laundering obligations where applicable.</li>
              <li><strong>Statistical analysis and service improvement:</strong> with aggregated or pseudonymised data.</li>
            </ol>
          </section>

          <section id="base">
            <h2><span className="num">04</span>Legal basis for processing</h2>
            <p>Under Article 6 GDPR, the legal bases for each processing activity are:</p>
            <table>
              <thead><tr><th>Purpose</th><th>Legal basis</th></tr></thead>
              <tbody>
                <tr><td>Handling a quote before the contract</td><td>Steps taken at the data subject’s request prior to entering into a contract <em>(Art. 6.1.b GDPR)</em></td></tr>
                <tr><td>Carrying out the renovation and billing</td><td>Performance of a contract <em>(Art. 6.1.b GDPR)</em></td></tr>
                <tr><td>Client account and online area</td><td>Performance of a contract <em>(Art. 6.1.b GDPR)</em></td></tr>
                <tr><td>Accounting and tax obligations</td><td>Legal obligation <em>(Art. 6.1.c GDPR)</em></td></tr>
                <tr><td>Unsolicited marketing communications</td><td>Consent <em>(Art. 6.1.a GDPR)</em></td></tr>
                <tr><td>Communications to clients about similar services</td><td>Legitimate interest <em>(Art. 6.1.f GDPR and Art. 21.2 LSSI)</em></td></tr>
                <tr><td>Analytics and marketing cookies</td><td>Consent <em>(Art. 6.1.a GDPR)</em></td></tr>
                <tr><td>Handling your GDPR rights</td><td>Legal obligation <em>(Art. 6.1.c GDPR)</em></td></tr>
              </tbody>
            </table>
          </section>

          <section id="conservacion">
            <h2><span className="num">05</span>Retention periods</h2>
            <p>We keep your data for as long as strictly necessary for the purposes described and, afterwards, for as long as there are legal liabilities to meet.</p>
            <table>
              <thead><tr><th>Type of data</th><th>Period</th></tr></thead>
              <tbody>
                <tr><td>Quote request not taken up</td><td>12 months from the last contact</td></tr>
                <tr><td>Contract and works data</td><td>For the term of the contract + 5 years (Art. 1964 Spanish Civil Code)</td></tr>
                <tr><td>Billing and accounting</td><td>6 years (Art. 30 Spanish Commercial Code)</td></tr>
                <tr><td>Tax data</td><td>4 years (Spanish General Tax Act)</td></tr>
                <tr><td>Client account</td><td>Until you ask to close it + the corresponding legal blocking period</td></tr>
                <tr><td>Marketing consents</td><td>Until withdrawn</td></tr>
                <tr><td>Browsing data / cookies</td><td>As stated in the <Link to="/cookies">Cookie policy</Link></td></tr>
              </tbody>
            </table>
            <p>Once these periods have passed, the data will be blocked for as long as liabilities may arise and then securely deleted.</p>
          </section>

          <section id="destinatarios">
            <h2><span className="num">06</span>Recipients and data processors</h2>
            <p>Your data is not disclosed to third parties unless required by law. We do use service providers (data processors) who access your data solely to provide their service to us, under a contract signed in accordance with Art. 28 GDPR.</p>
            <table>
              <thead><tr><th>Provider</th><th>Service</th><th>Location</th></tr></thead>
              <tbody>
                <tr><td>Amazon Web Services EMEA SARL</td><td>Hosting and databases</td><td>European Union (Ireland / Frankfurt)</td></tr>
                <tr><td>Google Ireland Ltd.</td><td>Corporate email (Workspace) and analytics</td><td>European Union + United States</td></tr>
                <tr><td>Microsoft Ireland Ltd.</td><td>Sign-in with a Microsoft account (optional)</td><td>European Union</td></tr>
                <tr><td>Stripe Payments Europe Ltd.</td><td>Payment processing</td><td>European Union</td></tr>
                <tr><td>Meta Platforms Ireland Ltd.</td><td>WhatsApp Business for communicating with clients</td><td>European Union + United States</td></tr>
                <tr><td>External tax and employment advisers</td><td>Accounting and payroll</td><td>Spain</td></tr>
              </tbody>
            </table>
            <p>We may also disclose your data to public authorities, law enforcement agencies and courts when legally required.</p>
          </section>

          <section id="transferencias">
            <h2><span className="num">07</span>International data transfers</h2>
            <p>We process your data preferably within the European Economic Area (EEA). When one of our providers processes data outside the EEA (for example, in the United States), we ensure an adequate level of protection through:</p>
            <ul>
              <li>Participation in the <strong>EU-US Data Privacy Framework</strong> approved by the European Commission’s adequacy decision of 10 July 2023.</li>
              <li><strong>Standard Contractual Clauses</strong> approved by the European Commission (Decision 2021/914).</li>
              <li>Additional technical measures (encryption in transit and at rest, pseudonymisation).</li>
            </ul>
            <p>You can request a copy of these safeguards by writing to <a href="mailto:dpo@ledens.es">dpo@ledens.es</a>.</p>
          </section>

          <section id="decisiones">
            <h2><span className="num">08</span>Automated decisions and profiling</h2>
            <p>Ledens <strong>does not make automated decisions with significant legal effects</strong> on data subjects within the meaning of Article 22 GDPR. Relevant contractual decisions (quote acceptance, works schedule, guarantees) are always reviewed by a member of the team.</p>
            <p>We may use automated analysis tools to suggest property opportunities based on the criteria you have stated; these results are mere suggestions that do not affect your rights until you decide to act on them.</p>
          </section>

          <section id="derechos">
            <h2><span className="num">09</span>Your rights as a data subject</h2>
            <p>As the owner of the data, the GDPR grants you the following rights, which you can exercise free of charge at any time:</p>
            <div className="rights-grid">
              <div className="right-card"><h4><i className="ri-eye-line"></i>Access</h4><p>Know what data of yours we process and get a copy of it.</p></div>
              <div className="right-card"><h4><i className="ri-edit-line"></i>Rectification</h4><p>Correct inaccurate data or complete incomplete data.</p></div>
              <div className="right-card"><h4><i className="ri-delete-bin-line"></i>Erasure</h4><p>Ask us to delete your data when it is no longer needed.</p></div>
              <div className="right-card"><h4><i className="ri-lock-line"></i>Restriction</h4><p>Ask us to pause processing while a dispute is resolved.</p></div>
              <div className="right-card"><h4><i className="ri-close-circle-line"></i>Objection</h4><p>Object to processing based on legitimate interest, including direct marketing.</p></div>
              <div className="right-card"><h4><i className="ri-download-2-line"></i>Portability</h4><p>Receive your data in a structured format and transmit it to another controller.</p></div>
              <div className="right-card"><h4><i className="ri-shield-cross-line"></i>Not to be subject to automated decisions</h4><p>Ask for human intervention in purely automated decisions.</p></div>
              <div className="right-card"><h4><i className="ri-arrow-go-back-line"></i>Withdrawal of consent</h4><p>Withdraw any consent you have given at any time, without retroactive effect.</p></div>
            </div>

            <h3>How to exercise your rights</h3>
            <ul>
              <li>Email <a href="mailto:dpo@ledens.es">dpo@ledens.es</a> stating the right you are exercising and attaching a copy of your ID or equivalent document.</li>
              <li>Write by post to Sociedad Inversora Navarro Robinson S.L., Avenida del Sor Teresa Prat 5, Polo Digital, Málaga.</li>
              <li>Log in to your client account and use the data download and deletion options.</li>
            </ul>
            <p>We will resolve your request within <strong>one month</strong> at most, extendable by two further months in especially complex cases (Art. 12.3 GDPR).</p>
            <div className="callout callout-ok">
              <i className="ri-checkbox-circle-line"></i>
              <div>
                <strong>Complaint to the AEPD</strong>
                If you believe we have not handled your rights properly, you can lodge a complaint with the
                Spanish Data Protection Agency at{' '}
                <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>.
              </div>
            </div>
          </section>

          <section id="seguridad">
            <h2><span className="num">10</span>Information security</h2>
            <p>We have put in place appropriate technical and organisational measures to ensure a level of security appropriate to the risk, in accordance with Article 32 GDPR. These include:</p>
            <ul>
              <li>Encryption of communications (TLS 1.3) and of data at rest.</li>
              <li>Role-based access control and multi-factor authentication for staff.</li>
              <li>Encrypted backups and regular recovery tests.</li>
              <li>Risk analysis and data protection impact assessments (DPIA) where applicable.</li>
              <li>Regular data protection training for staff.</li>
              <li>A security breach notification procedure (72 h to the AEPD).</li>
            </ul>
          </section>

          <section id="menores">
            <h2><span className="num">11</span>Minors</h2>
            <p>Our services are intended exclusively for people over 18. We do not knowingly collect personal data from minors. If we find that a minor’s data has been provided without the consent of their parents or guardians, we will delete it immediately.</p>
          </section>

          <section id="cambios">
            <h2><span className="num">12</span>Changes to this policy</h2>
            <p>We may update this policy to reflect legal, technical or service changes. If the changes are substantial, we will let you know by email or through a prominent notice on the website at least <strong>30 days before</strong> they take effect.</p>
            <p>The version in force is always the one published on this page, shown with its update date.</p>
          </section>

          <div className="legal-contact">
            <div>
              <h3>Questions about your data?</h3>
              <p>Our Data Protection Officer replies within 72 working hours.</p>
            </div>
            <div className="actions">
              <a href="mailto:dpo@ledens.es"><i className="ri-mail-line"></i> dpo@ledens.es</a>
              <a href="tel:+34655638219"><i className="ri-phone-line"></i> +34 655 638 219</a>
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
