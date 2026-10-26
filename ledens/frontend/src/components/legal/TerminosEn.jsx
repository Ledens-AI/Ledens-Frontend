import React from 'react';
import { Link } from 'react-router-dom';
import Footer from '../Footer.jsx';
import useTocHighlight from './useTocHighlight.js';

/* English translation of TerminosPage — keep both in step. */
const TOC = [
  { id: 'identificacion',  label: 'Service provider details' },
  { id: 'objeto',          label: 'Purpose and acceptance' },
  { id: 'usuarios',        label: 'Users and registration' },
  { id: 'contratacion',    label: 'Contracting process' },
  { id: 'precios',         label: 'Prices, payments and taxes' },
  { id: 'ejecucion',       label: 'Carrying out the works' },
  { id: 'desistimiento',   label: 'Right of withdrawal' },
  { id: 'garantia',        label: 'Legal guarantees' },
  { id: 'responsabilidad', label: 'Limitation of liability' },
  { id: 'propiedad',       label: 'Intellectual property' },
  { id: 'conducta',        label: 'Acceptable use' },
  { id: 'suspension',      label: 'Suspension and termination' },
  { id: 'reclamaciones',   label: 'Complaints and disputes' },
  { id: 'legislacion',     label: 'Governing law and jurisdiction' },
  { id: 'general',         label: 'General provisions' },
];

export default function TerminosEn() {
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
            <span className="here">Terms and Conditions</span>
          </div>
          <span className="legal-eb"><i className="ri-scales-3-line"></i> LSSI · TRLGDCU · Regulation (EU) 2019/771</span>
          <h1>Terms and Conditions of Service</h1>
          <p className="lead">
            These Terms govern the use of the Ledens website and services, and the contracting
            of renovation works. Take your time to read them: they set out your rights as a
            European consumer and our obligations as a company.
          </p>
          <div className="legal-meta">
            <div><i className="ri-calendar-line"></i> Last updated: <strong>19 May 2026</strong></div>
            <div><i className="ri-file-text-line"></i> Version <strong>2.1</strong></div>
            <div><i className="ri-time-line"></i> Reading time: <strong>~12 min</strong></div>
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
              This English version is provided for convenience. If there is any discrepancy, the Spanish version prevails (see 15.5).
            </div>
          </div>

          <section id="identificacion">
            <h2><span className="num">01</span>Service provider details</h2>
            <p>In compliance with Article 10 of Spanish Law 34/2002 on Information Society Services and Electronic Commerce (LSSI-CE), we provide the following identification details:</p>
            <table>
              <tbody>
                <tr><th style={{ width: '42%' }}>Company name</th><td>Sociedad Inversora Navarro Robinson S.L.</td></tr>
                <tr><th>Tax ID (NIF)</th><td>B19753805</td></tr>
                <tr><th>Registered office</th><td>Avenida del Sor Teresa Prat 5, Polo Digital, Málaga</td></tr>
                <tr><th>Registration details</th><td>S 8, H MA182799, I/A 1 (21.06.24)</td></tr>
                <tr><th>Email</th><td><a href="mailto:alvaro.navarro@ledens.es">alvaro.navarro@ledens.es</a></td></tr>
                <tr><th>Phone</th><td>+34 655 638 219</td></tr>
                <tr><th>Website</th><td><a href="https://www.ledens.es" target="_blank" rel="noopener noreferrer">www.ledens.es</a></td></tr>
              </tbody>
            </table>
          </section>

          <section id="objeto">
            <h2><span className="num">02</span>Purpose and acceptance</h2>
            <p>These <strong>Terms and Conditions</strong> (the "Terms") govern:</p>
            <ol className="list">
              <li>Access to and use of the website <a href="https://www.ledens.es">www.ledens.es</a> and the Ledens client app.</li>
              <li>Requesting renovation quotes and contracting the services provided by Ledens.</li>
              <li>Any complementary digital service (client area, chat, progress photos of the works).</li>
            </ol>
            <p>Using the website and/or requesting any service implies <strong>full and express acceptance</strong> of these Terms in the version in force at the time of each use. If you do not agree, please do not use our services.</p>
            <div className="callout">
              <i className="ri-user-3-line"></i>
              <div>
                <strong>These Terms are agreed between two parties</strong>
                "We", "Ledens" or "the provider" means Sociedad Inversora Navarro Robinson S.L. "You", "the user"
                or "the client" means the individual or legal entity that uses the website or contracts the services.
              </div>
            </div>
          </section>

          <section id="usuarios">
            <h2><span className="num">03</span>Users and registration</h2>
            <p>You do not need to register to access the website. To contract services or access the client area you must:</p>
            <ul>
              <li>Be <strong>over 18</strong> and have legal capacity to enter into contracts.</li>
              <li>Provide truthful, accurate and up-to-date information.</li>
              <li>Keep your credentials confidential (email, password and, where applicable, Google or Microsoft identifiers).</li>
              <li>Notify us immediately of any unauthorised use of your account.</li>
            </ul>
            <p>You are responsible for all activity carried out under your account. Ledens will not be liable for damage caused by misuse by third parties until the incident is reported to us.</p>
          </section>

          <section id="contratacion">
            <h2><span className="num">04</span>Contracting process</h2>
            <h3>4.1 Quote request</h3>
            <p>Requesting a quote through the website, WhatsApp, phone or email <strong>creates no contractual obligation</strong>. It is a free, no-obligation assessment. After the technical visit we will give you a fixed-price quote in writing.</p>

            <h3>4.2 Formation of the contract</h3>
            <p>The renovation contract is formed when you sign the quote (on paper or electronically) and the deposit stated in it is paid. From then on, the signed quote, its annexes and these Terms make up the <strong>entire agreement</strong> between the parties.</p>

            <h3>4.3 Written confirmation</h3>
            <p>After signing you will receive an email confirmation with:</p>
            <ul>
              <li>A copy of the signed quote and of these Terms.</li>
              <li>The expected start date (as a general rule, ≤ 48 h from signature).</li>
              <li>The estimated works schedule and payment method.</li>
              <li>Information about the right of withdrawal (see section 7).</li>
            </ul>
            <p>Ledens will archive the documents and you can access them in your client area.</p>
          </section>

          <section id="precios">
            <h2><span className="num">05</span>Prices, payments and taxes</h2>
            <h3>5.1 Prices</h3>
            <p>All prices shown on the website or in quotes are expressed <strong>in euros (€) and include the applicable VAT</strong>, unless expressly stated otherwise. Prices are valid for the period stated in the quote (generally <strong>30 days</strong> from issue).</p>

            <h3>5.2 Fixed-price quote</h3>
            <p>Unless the client expressly changes the project, the agreed price is <strong>fixed and lump-sum</strong>. No extra costs will be charged except for changes requested in writing or for duly justified unforeseen technical causes that could not be detected during the technical visit.</p>

            <h3>5.3 Payment methods</h3>
            <ul>
              <li>Bank transfer to the IBAN shown on the invoice.</li>
              <li>Debit/credit card through Stripe (PCI-DSS Level 1).</li>
              <li>Direct debit (SEPA Direct Debit) for clients on a recurring plan.</li>
            </ul>

            <h3>5.4 Usual payment schedule</h3>
            <table>
              <thead><tr><th>Milestone</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>Deposit on signing the quote</td><td>30%</td></tr>
                <tr><td>Start of works (materials)</td><td>40%</td></tr>
                <tr><td>Intermediate milestone (client sign-off)</td><td>20%</td></tr>
                <tr><td>Final handover of the works</td><td>10%</td></tr>
              </tbody>
            </table>

            <h3>5.5 Non-payment</h3>
            <p>Late payment of any milestone entitles Ledens to suspend the works after <strong>7 days’</strong> notice and to apply the statutory interest rate plus 2 points to the outstanding balance (Art. 1108 Spanish Civil Code).</p>
          </section>

          <section id="ejecucion">
            <h2><span className="num">06</span>Carrying out the works</h2>
            <h3>6.1 Deadlines</h3>
            <p>The deadlines stated in the quote are <strong>essential and binding</strong> on Ledens. If the agreed final deadline is missed for reasons attributable to Ledens, the client will be entitled to a <strong>penalty of 0.2% of the price for each calendar day of delay</strong>, capped at 5% of the total contract amount.</p>

            <h3>6.2 Client obligations</h3>
            <ul>
              <li>Allow access to the property at the agreed times.</li>
              <li>Obtain the homeowners’ association authorisations where applicable.</li>
              <li>Remove furniture and personal belongings before the start.</li>
              <li>Ensure water and electricity supply on site.</li>
            </ul>

            <h3>6.3 Subcontracting</h3>
            <p>Ledens may subcontract specialised professionals (licensed electricians, RITE installers, etc.) while always keeping <strong>direct responsibility towards the client</strong>. All subcontractors are registered with Social Security and hold the required civil liability insurance.</p>

            <h3>6.4 Changes</h3>
            <p>Any change to the project requested by the client will result in a <strong>signed addendum</strong> with its new price and deadline. No change will be made without a written document.</p>

            <h3>6.5 Force majeure</h3>
            <p>Ledens is not liable for delays due to force majeure (natural disasters, general strikes, government decisions, declared pandemics) under Article 1105 of the Spanish Civil Code. In such cases the deadline will be extended by the equivalent time.</p>
          </section>

          <section id="desistimiento">
            <h2><span className="num">07</span>Right of withdrawal</h2>
            <div className="callout callout-warn">
              <i className="ri-alarm-warning-line"></i>
              <div>
                <strong>14 days to change your mind</strong>
                As a consumer, if you signed the contract away from our premises or by electronic means,
                you have 14 calendar days to withdraw without giving any reason, under Articles 102 et seq.
                of Royal Legislative Decree 1/2007 (TRLGDCU).
              </div>
            </div>

            <h3>7.1 Period</h3>
            <p>The <strong>14 calendar day</strong> period starts from the signature of the contract. It is met if the withdrawal notice is sent before the period ends.</p>

            <h3>7.2 How to withdraw</h3>
            <ul>
              <li>Email <a href="mailto:hola@ledens.es">hola@ledens.es</a> with the subject "Withdrawal" ("Desistimiento").</li>
              <li>A letter by post to the registered office.</li>
              <li>The withdrawal form available in your client area.</li>
            </ul>

            <h3>7.3 Model withdrawal form</h3>
            <p>You may use the following model, although it is not mandatory:</p>
            <div className="callout">
              <i className="ri-double-quotes-l"></i>
              <div>
                <em>
                  For the attention of Sociedad Inversora Navarro Robinson S.L. (Avenida del Sor Teresa Prat 5, Polo Digital, Málaga · alvaro.navarro@ledens.es):<br />
                  I hereby give notice that I withdraw from my renovation contract signed on [date].<br />
                  Consumer’s name: [—] · Address: [—] · Date: [—] · Signature (only if sent on paper).
                </em>
              </div>
            </div>

            <h3>7.4 Effects of withdrawal</h3>
            <p>Once we receive your notice, we will refund all amounts paid within <strong>14 calendar days</strong> at most, using the same payment method you used unless you tell us otherwise. You will not incur any cost as a result of the refund.</p>

            <h3>7.5 Legal exceptions</h3>
            <p>Under Article 103 TRLGDCU, withdrawal does not apply when:</p>
            <ul>
              <li>The works have been <strong>fully</strong> carried out, having started with your prior express consent and acknowledgement that you would lose the right.</li>
              <li>The goods were made to your specifications (bespoke furniture, cut worktops, etc.) and have already been manufactured.</li>
              <li>The service is an urgent repair you requested.</li>
            </ul>
            <p>If you ask for the service to start during the withdrawal period and then withdraw, you must pay the amount proportional to the part already carried out.</p>
          </section>

          <section id="garantia">
            <h2><span className="num">08</span>Legal guarantees</h2>
            <p>The works and services provided by Ledens are covered by the following guarantees:</p>

            <h3>8.1 Guarantee of conformity (Regulation (EU) 2019/771 and Arts. 114 et seq. TRLGDCU)</h3>
            <ul>
              <li><strong>3 years</strong> from handover for movable goods incorporated into the renovation.</li>
              <li><strong>2 years</strong> on labour and finishes under Art. 1591 Spanish Civil Code.</li>
            </ul>

            <h3>8.2 Ten-year liability for construction works</h3>
            <p>In accordance with Article 17 of Spanish Law 38/1999 on Building Regulation, where applicable given the nature of the works:</p>
            <ul>
              <li><strong>10 years</strong> for damage affecting structural elements.</li>
              <li><strong>3 years</strong> for damage affecting habitability.</li>
              <li><strong>1 year</strong> for finishing defects.</li>
            </ul>

            <h3>8.3 How to make a claim</h3>
            <p>To use the guarantee, contact us at <a href="mailto:hola@ledens.es">hola@ledens.es</a> or through your client area, describing the issue and, if possible, attaching photos. We will reply within <strong>72 working hours</strong> at most.</p>

            <div className="callout callout-ok">
              <i className="ri-shield-check-line"></i>
              <div>
                <strong>No cost to the consumer</strong>
                Repair, replacement or remedy covered by the guarantee is completely free for the client,
                and the time it takes does not count against the guarantee period.
              </div>
            </div>
          </section>

          <section id="responsabilidad">
            <h2><span className="num">09</span>Limitation of liability</h2>
            <p>Ledens is liable for direct damage resulting from failure to meet its contractual obligations as provided in the TRLGDCU and the Spanish Civil Code.</p>
            <p>Within the limits allowed by applicable law, Ledens <strong>will not be liable</strong> for:</p>
            <ul>
              <li>Indirect damage, loss of profit, loss of opportunities or of data.</li>
              <li>Damage resulting from misuse, alteration or intervention by third parties not authorised by Ledens on the delivered works.</li>
              <li>Temporary website interruptions due to maintenance, third-party service failures or force majeure.</li>
            </ul>
            <p>The above limitations <strong>do not apply</strong> in cases of wilful misconduct, gross negligence, personal injury or harm caused to the consumer, nor to the mandatory rights granted by consumer law.</p>
          </section>

          <section id="propiedad">
            <h2><span className="num">10</span>Intellectual and industrial property</h2>
            <p>All website content (texts, graphics, photos, videos, source code, trademarks, logos) belongs to Ledens or its licensors and is protected by Spanish and European intellectual and industrial property law.</p>
            <p>Its reproduction, distribution, public communication, transformation or any other form of exploitation without Ledens’ prior written authorisation is <strong>expressly prohibited</strong>.</p>
            <p>Ledens may use photos of completed projects for commercial purposes, <strong>always respecting the client’s privacy</strong> and never showing identifying data without express consent.</p>
          </section>

          <section id="conducta">
            <h2><span className="num">11</span>Acceptable use of the website and services</h2>
            <p>The user agrees to use the website and services diligently, properly and lawfully, and to refrain from:</p>
            <ul>
              <li>Accessing or trying to access restricted resources without authorisation.</li>
              <li>Doing anything that may damage, overload or impair the systems.</li>
              <li>Introducing viruses, trojans or other malicious software.</li>
              <li>Collecting third parties’ data without their consent.</li>
              <li>Impersonating another person or entity.</li>
              <li>Using the website for purposes contrary to the law, morality or public order.</li>
            </ul>
          </section>

          <section id="suspension">
            <h2><span className="num">12</span>Suspension and termination</h2>
            <p>Ledens may suspend or cancel access to the website and/or the contract if the user seriously breaches these Terms, after reasonable notice except in justified urgent cases.</p>
            <p>The client may terminate the contract at any time, unless otherwise agreed, by paying for the services already provided and the justified expenses incurred by Ledens up to the date of termination.</p>
          </section>

          <section id="reclamaciones">
            <h2><span className="num">13</span>Complaints and dispute resolution</h2>
            <h3>13.1 Official complaint forms</h3>
            <p>Ledens has official complaint forms available to consumers under Decree 72/2008 of the Andalusian Regional Government. You can ask for them at any of our offices or by email at <a href="mailto:hola@ledens.es">hola@ledens.es</a>.</p>

            <h3>13.2 Amicable resolution</h3>
            <p>Before going to court, we invite you to contact our customer service. We undertake to answer any complaint within <strong>1 month</strong> at most.</p>

            <h3>13.3 Online dispute resolution platform</h3>
            <p>Under Regulation (EU) 524/2013, we inform you of the European Online Dispute Resolution platform, available at:</p>
            <p><a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr</a></p>

            <h3>13.4 Consumer Arbitration Board</h3>
            <p>If you prefer, you can go to the Andalusian Consumer Arbitration Board, whose intervention we accept to resolve any dispute arising from the provision of our services to consumers.</p>
          </section>

          <section id="legislacion">
            <h2><span className="num">14</span>Governing law and jurisdiction</h2>
            <p>These Terms are governed by <strong>Spanish law</strong> and, where applicable, by European Union law.</p>
            <p>For any dispute arising from their interpretation or performance, the parties submit:</p>
            <ul>
              <li><strong>If the client is a consumer:</strong> to the courts of the consumer’s place of residence, under Article 90.2 TRLGDCU.</li>
              <li><strong>If the client is a professional or a company:</strong> to the Courts and Tribunals of the city of Málaga, expressly waiving any other jurisdiction that might apply.</li>
            </ul>
          </section>

          <section id="general">
            <h2><span className="num">15</span>General provisions</h2>
            <h3>15.1 Changes</h3>
            <p>We may update these Terms at any time. Substantial changes will be notified by email to registered users at least <strong>30 days</strong> before they take effect.</p>

            <h3>15.2 Partial invalidity</h3>
            <p>If any clause of these Terms is declared void or unenforceable by a court, the rest will remain fully in force. The void clause will be replaced by a valid one pursuing the same purpose.</p>

            <h3>15.3 Notices</h3>
            <p>Notices between the parties will be sent by email to the addresses stated in the contract. Notices to Ledens may be sent to <a href="mailto:hola@ledens.es">hola@ledens.es</a>.</p>

            <h3>15.4 Assignment</h3>
            <p>The client may not assign their contractual position without Ledens’ prior written consent. Ledens may assign its rights and obligations to third parties provided this does not reduce the client’s rights in any way.</p>

            <h3>15.5 Language</h3>
            <p>These Terms are published in Spanish. Where they are translated into other languages, the Spanish version prevails in case of discrepancy.</p>
          </section>

          <div className="legal-contact">
            <div>
              <h3>Questions about the Terms?</h3>
              <p>Our legal team will clarify them within 48 working hours. No formalities.</p>
            </div>
            <div className="actions">
              <a href="mailto:legal@ledens.es"><i className="ri-mail-line"></i> legal@ledens.es</a>
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
