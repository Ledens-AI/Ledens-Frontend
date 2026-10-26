import React from 'react';
import { Link } from 'react-router-dom';
import Footer from '../Footer.jsx';
import useTocHighlight from './useTocHighlight.js';

/* English translation of CookiesPage — keep both in step. */
const TOC = [
  { id: 'que-son',        label: 'What are cookies?' },
  { id: 'quien',          label: 'Who uses them' },
  { id: 'categorias',     label: 'Cookie categories' },
  { id: 'listado',        label: 'List of cookies we use' },
  { id: 'terceros',       label: 'Third-party cookies' },
  { id: 'conservacion',   label: 'Retention periods' },
  { id: 'consentimiento', label: 'Managing your consent' },
  { id: 'navegador',      label: 'Browser settings' },
  { id: 'transferencias', label: 'International transfers' },
  { id: 'cambios',        label: 'Changes to this policy' },
];

export default function CookiesEn() {
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
            <span className="here">Cookie policy</span>
          </div>
          <span className="legal-eb">
            <i className="ri-cookie-line" /> Art. 22.2 LSSI · GDPR · AEPD Guide 2024
          </span>
          <h1>Cookie Policy</h1>
          <p className="lead">
            Here we explain which cookies we use on{' '}
            <a href="https://www.ledens.es">ledens.es</a>, what they are for, how long they last and how
            you can accept, reject or configure them as you like at any time.
          </p>
          <div className="legal-meta">
            <div><i className="ri-calendar-line" /> Last updated: <strong>19 May 2026</strong></div>
            <div><i className="ri-file-text-line" /> Version <strong>2.1</strong></div>
            <div><i className="ri-time-line" /> Reading time: <strong>~6 min</strong></div>
          </div>
        </div>
      </section>

      <div className="legal-shell">
        <aside className="toc">
          <div className="toc-title">Contents</div>
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

        <article className="legal-content">
          <div className="cookie-status">
            <span className="dot" aria-hidden="true" />
            <div className="copy">
              <strong>Your settings are active.</strong>{' '}
              You can change your preferences whenever you like without coming back to this page.
            </div>
            <button
              type="button"
              className="btn-manage"
              onClick={() => window.LedensCookies?.open()}
            >
              <i className="ri-equalizer-line" /> Manage cookies
            </button>
          </div>

          <div className="callout">
            <i className="ri-translate-2" />
            <div>
              <strong>About this translation</strong>{' '}
              This English version is provided for convenience. If there is any discrepancy, the Spanish version prevails.
            </div>
          </div>

          <section id="que-son">
            <h2><span className="num">01</span>What are cookies?</h2>
            <p>A <strong>cookie</strong> is a small piece of information that a website stores on your device (computer, phone or tablet) when you visit it. Among other things, cookies let the website recognise you on later visits, remember your preferences and measure how the site is used.</p>
            <p>Alongside cookies we use other <strong>similar technologies</strong> for the same purposes: pixels, tracking tags, local storage (<em>localStorage</em>, <em>sessionStorage</em>) and browser fingerprinting. For the purposes of this policy, they are all treated the same as cookies.</p>
            <div className="callout">
              <i className="ri-information-line" />
              <div>
                <strong>Applicable legal framework</strong>{' '}
                This policy complies with Article 22.2 of Spanish Law 34/2002 on Information Society Services (LSSI-CE), Regulation (EU) 2016/679 (GDPR) and the <em>Guide on the use of cookies</em> published by the AEPD in its January 2024 edition.
              </div>
            </div>
          </section>

          <section id="quien">
            <h2><span className="num">02</span>Who uses cookies on this website?</h2>
            <p>Cookies may be set by:</p>
            <ul>
              <li><strong>Sociedad Inversora Navarro Robinson S.L.</strong> (hereinafter, "Ledens"), the data controller, with registered office at Avenida del Sor Teresa Prat 5, Polo Digital, Málaga (NIF B19753805). These are called <strong>first-party cookies</strong>.</li>
              <li><strong>Third-party providers</strong> of services that add complementary features (analytics, maps, video, payment gateway, advertising). These are called <strong>third-party cookies</strong>. See section 5.</li>
            </ul>
            <p>For any question you can contact our Data Protection Officer at <a href="mailto:dpo@ledens.es">dpo@ledens.es</a>.</p>
          </section>

          <section id="categorias">
            <h2><span className="num">03</span>Categories of cookies we use</h2>
            <p>Following the classification recommended by the AEPD, we group cookies into <strong>four categories</strong>. You can turn all of them on or off, except the essential ones, from the icon at the bottom left or from the "Manage cookies" button at the top of this page.</p>

            <h3>
              <span className="cookie-chip chip-necessary"><i className="ri-shield-check-line" /> Technical</span>{' '}
              Essential
            </h3>
            <p>They let the user browse the website and use its different options (controlling traffic, identifying the session, accessing restricted areas, remembering basket items, storing server load balancing). Under Art. 22.2 LSSI, they <strong>do not require consent</strong> because they are strictly necessary to provide the service you have asked us for.</p>

            <h3>
              <span className="cookie-chip chip-pref"><i className="ri-settings-3-line" /> Preferences</span>{' '}
              Personalisation
            </h3>
            <p>They remember information so that you can access the service with certain features that may set your experience apart (number of results to show, type of browser, regional settings of the area you access the service from…). They require <strong>your prior consent</strong>.</p>

            <h3>
              <span className="cookie-chip chip-analytics"><i className="ri-line-chart-line" /> Analytics</span>{' '}
              Measurement
            </h3>
            <p>They let whoever is responsible for them track and analyse user behaviour. The information collected is used to measure the website’s activity and to build browsing profiles in order to make improvements based on the analysis of usage data. They require <strong>your prior consent</strong>.</p>

            <h3>
              <span className="cookie-chip chip-marketing"><i className="ri-megaphone-line" /> Marketing</span>{' '}
              Advertising and behavioural
            </h3>
            <p>They manage advertising space and, by analysing your browsing habits, show you ads related to your interests on and off the Ledens website. They may be shared with advertising networks and social platforms. They require <strong>your prior consent</strong>.</p>
          </section>

          <section id="listado">
            <h2><span className="num">04</span>List of cookies we use</h2>
            <p>Below you will find the details of each cookie set by Ledens or its providers. We review this list every quarter; if you find any discrepancy, write to us at <a href="mailto:dpo@ledens.es">dpo@ledens.es</a>.</p>

            <h3>Technical cookies (essential)</h3>
            <table className="cookie-table">
              <thead>
                <tr>
                  <th className="col-name">Name</th>
                  <th className="col-type">Source</th>
                  <th>Purpose</th>
                  <th className="col-life">Duration</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code>ledens_sid</code></td><td>First-party</td><td>Identifies your browsing session.</td><td>Session</td></tr>
                <tr><td><code>ledens_csrf</code></td><td>First-party</td><td>Protection against CSRF attacks on forms and the client area.</td><td>Session</td></tr>
                <tr><td><code>ledens.cookieConsent.v1</code></td><td>First-party (localStorage)</td><td>Stores your cookie preferences so we don’t ask again.</td><td>12 months</td></tr>
                <tr><td><code>ledens.lang.v1</code></td><td>First-party (localStorage)</td><td>Remembers the language (ES / EN) you choose in the top bar. Only saved when you choose it yourself.</td><td>Until you delete it</td></tr>
                <tr><td><code>__cf_bm</code></td><td>Cloudflare</td><td>Tells human traffic apart from bots to protect the site.</td><td>30 min</td></tr>
              </tbody>
            </table>

            <h3>Preference cookies</h3>
            <table className="cookie-table">
              <thead>
                <tr><th className="col-name">Name</th><th className="col-type">Source</th><th>Purpose</th><th className="col-life">Duration</th></tr>
              </thead>
              <tbody>
                <tr><td><code>ledens_city</code></td><td>First-party</td><td>Saves the city selected in the renovation search.</td><td>6 months</td></tr>
                <tr><td><code>ledens_last_quote</code></td><td>First-party</td><td>Keeps your last viewed quote so you can pick it up again.</td><td>30 days</td></tr>
              </tbody>
            </table>

            <h3>Analytics cookies</h3>
            <table className="cookie-table">
              <thead>
                <tr><th className="col-name">Name</th><th className="col-type">Source</th><th>Purpose</th><th className="col-life">Duration</th></tr>
              </thead>
              <tbody>
                <tr><td><code>_ga</code></td><td>Google Analytics 4</td><td>Distinguishes users in a pseudonymised way.</td><td>2 years</td></tr>
                <tr><td><code>_ga_&lt;ID&gt;</code></td><td>Google Analytics 4</td><td>Keeps the state of the analytics session.</td><td>2 years</td></tr>
                <tr><td><code>_gid</code></td><td>Google Analytics</td><td>Distinguishes users for 24 hours.</td><td>24 hours</td></tr>
                <tr><td><code>hjSessionUser_&lt;ID&gt;</code></td><td>Hotjar</td><td>Identifies the user to measure heatmaps and aggregated recordings.</td><td>12 months</td></tr>
                <tr><td><code>hjSession_&lt;ID&gt;</code></td><td>Hotjar</td><td>Keeps the measurement session for 30 minutes.</td><td>30 min</td></tr>
              </tbody>
            </table>

            <h3>Marketing cookies</h3>
            <table className="cookie-table">
              <thead>
                <tr><th className="col-name">Name</th><th className="col-type">Source</th><th>Purpose</th><th className="col-life">Duration</th></tr>
              </thead>
              <tbody>
                <tr><td><code>_fbp</code></td><td>Meta Pixel</td><td>Identifies the browser to show ads on Facebook and Instagram.</td><td>3 months</td></tr>
                <tr><td><code>fr</code></td><td>Meta</td><td>Delivery and measurement of ads on Meta’s social networks.</td><td>3 months</td></tr>
                <tr><td><code>_gcl_au</code></td><td>Google Ads</td><td>Measures ad effectiveness and site performance.</td><td>3 months</td></tr>
                <tr><td><code>IDE</code></td><td>DoubleClick</td><td>Selects ads and measures their performance.</td><td>13 months</td></tr>
                <tr><td><code>_ttp</code></td><td>TikTok Pixel</td><td>Attribution of TikTok campaigns.</td><td>13 months</td></tr>
                <tr><td><code>li_sugr</code></td><td>LinkedIn</td><td>Links visits to measure professional campaigns.</td><td>3 months</td></tr>
              </tbody>
            </table>
          </section>

          <section id="terceros">
            <h2><span className="num">05</span>Third-party cookies</h2>
            <p>Some services on the website require third parties who may set their own cookies on your device. These third parties act as controllers of the data collected through their cookies and apply their own policies, which we recommend you read:</p>
            <table>
              <thead><tr><th>Third party</th><th>Service</th><th>Privacy policy</th></tr></thead>
              <tbody>
                <tr><td>Google LLC</td><td>Analytics, Maps, reCAPTCHA, Ads</td><td><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">policies.google.com</a></td></tr>
                <tr><td>Meta Platforms Ireland Ltd.</td><td>Meta Pixel, WhatsApp Business</td><td><a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noopener noreferrer">facebook.com/privacy</a></td></tr>
                <tr><td>Hotjar Ltd.</td><td>Heatmaps and aggregated recordings</td><td><a href="https://www.hotjar.com/legal/policies/privacy/" target="_blank" rel="noopener noreferrer">hotjar.com/legal</a></td></tr>
                <tr><td>Cloudflare Inc.</td><td>CDN and bot protection</td><td><a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">cloudflare.com/privacypolicy</a></td></tr>
                <tr><td>Stripe Payments Europe Ltd.</td><td>Payment processing</td><td><a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">stripe.com/privacy</a></td></tr>
                <tr><td>TikTok Information Technologies UK Ltd.</td><td>TikTok Pixel</td><td><a href="https://www.tiktok.com/legal/privacy-policy-eea" target="_blank" rel="noopener noreferrer">tiktok.com/legal</a></td></tr>
                <tr><td>LinkedIn Ireland Unlimited Company</td><td>Insight Tag</td><td><a href="https://www.linkedin.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">linkedin.com/legal</a></td></tr>
              </tbody>
            </table>
            <div className="callout callout-warn">
              <i className="ri-error-warning-line" />
              <div>
                <strong>Ledens does not control third-party cookies.</strong>{' '}
                We have no access to or control over cookies set by external providers. If you want to exercise your rights over that data, contact the third party directly or manage your consent from the Ledens cookie panel, which blocks them at source when you haven’t accepted them.
              </div>
            </div>
          </section>

          <section id="conservacion">
            <h2><span className="num">06</span>Retention periods</h2>
            <p>Cookies can be <strong>session</strong> cookies (deleted when you close the browser) or <strong>persistent</strong> cookies (kept for a set time). In line with the AEPD’s recommendation, none of the persistent cookies we use lasts longer than <strong>24 months</strong>. Your consent record is kept for <strong>12 months</strong>, after which we will ask you again.</p>
          </section>

          <section id="consentimiento">
            <h2><span className="num">07</span>Managing your consent</h2>
            <p>On your first visit we show you a panel where you can:</p>
            <ol className="list">
              <li><strong>Accept all cookies</strong>, allowing all four categories.</li>
              <li><strong>Reject all</strong>, allowing only the essential technical cookies.</li>
              <li><strong>Customise your choice</strong> category by category with individual switches.</li>
            </ol>
            <p>Under Article 7 GDPR, your consent is <strong>freely given, specific, informed and unambiguous</strong>. The boxes are unticked by default (except the technical ones) and no non-essential cookie is set until you click "Accept all" or "Save my preferences".</p>
            <p>You can <strong>withdraw or change your consent at any time</strong>, as easily as you gave it:</p>
            <ul>
              <li>By clicking the <i className="ri-shield-user-line" style={{ color: 'var(--ledens-blue)' }} /> icon in the bottom-left corner of any page.</li>
              <li>By clicking <button type="button" className="cc-inline-link" onClick={() => window.LedensCookies?.open()}><strong>Manage cookies</strong></button> on this page.</li>
              <li>By deleting Ledens cookies directly from your browser (section 8).</li>
            </ul>
            <p>Withdrawing consent does not affect the lawfulness of processing based on consent before its withdrawal.</p>
          </section>

          <section id="navegador">
            <h2><span className="num">08</span>Browser settings</h2>
            <p>As an alternative to the Ledens panel, you can manage, block or delete cookies directly from your browser settings. The exact path varies by version, but these are the official pages:</p>
            <div className="browser-grid">
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.google.com/chrome/answer/95647?hl=en">
                <span className="ic"><i className="ri-chrome-line" /></span>
                <div><div className="lbl">Google Chrome</div><div className="sub">Settings → Privacy and security</div></div>
              </a>
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.mozilla.org/en-US/kb/enable-and-disable-cookies-website-preferences">
                <span className="ic"><i className="ri-firefox-line" /></span>
                <div><div className="lbl">Mozilla Firefox</div><div className="sub">Settings → Privacy & Security</div></div>
              </a>
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.apple.com/en-gb/guide/safari/sfri11471/mac">
                <span className="ic"><i className="ri-safari-line" /></span>
                <div><div className="lbl">Apple Safari</div><div className="sub">Preferences → Privacy</div></div>
              </a>
              <a className="browser-card" target="_blank" rel="noopener noreferrer" href="https://support.microsoft.com/en-gb/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09">
                <span className="ic"><i className="ri-edge-line" /></span>
                <div><div className="lbl">Microsoft Edge</div><div className="sub">Settings → Cookies and site permissions</div></div>
              </a>
            </div>
            <p>If you browse in <strong>incognito or private mode</strong>, remember that most persistent cookies are deleted when you close the window, so you will have to set your consent again on your next visit.</p>
            <div className="callout callout-warn">
              <i className="ri-alarm-warning-line" />
              <div>
                <strong>If you block all cookies:</strong>{' '}
                Some site features may not be available: login, client area, quote reminder, chat support. Technical cookies are essential for the website to work normally.
              </div>
            </div>
          </section>

          <section id="transferencias">
            <h2><span className="num">09</span>International transfers linked to cookies</h2>
            <p>Some of the third parties listed in section 5 (Google, Meta, TikTok, LinkedIn) are based in countries outside the European Economic Area, mainly the United States. International transfers arising from their cookies are covered by:</p>
            <ul>
              <li>The <strong>EU-US Data Privacy Framework</strong> (adequacy decision of 10 July 2023), when the provider is certified.</li>
              <li><strong>Standard Contractual Clauses</strong> approved by the European Commission (Decision 2021/914) with additional technical measures.</li>
            </ul>
            <p>More information in our <Link to="/privacidad">Privacy policy</Link>.</p>
          </section>

          <section id="cambios">
            <h2><span className="num">10</span>Changes to this policy</h2>
            <p>We may update this Cookie policy to reflect new services, legal changes or AEPD recommendations. The date of the latest review is shown at the top of the document.</p>
            <p>If a change involves a new purpose or a relevant new third party, <strong>we will ask for your consent again</strong> before setting the cookies concerned.</p>
          </section>

          <div className="legal-contact">
            <div>
              <h3>Questions about cookies?</h3>
              <p>Our Data Protection Officer replies within 72 working hours. No endless forms.</p>
            </div>
            <div className="actions">
              <a href="mailto:dpo@ledens.es"><i className="ri-mail-line" /> dpo@ledens.es</a>
              <button type="button" className="cc-inline-link" onClick={() => window.LedensCookies?.open()}>
                <i className="ri-equalizer-line" /> Manage my cookies
              </button>
            </div>
          </div>
        </article>
      </div>

      <Footer />
    </>
  );
}
