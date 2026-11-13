import { isMobileAuthEnabled, readSessionCredential } from './sessions.js';

// The origin (CSRF) guard every router with writes shares: presupuestos,
// obras, invitaciones, herramientas, finanzas, finance and bridge. Before this
// file each one had its own inline copy; the rule and the 403 bodies are the
// same as those copies (each router passes its own body, byte for byte).
//
//  1. GET, HEAD and OPTIONS pass: they never change anything.
//  2. Any other method needs `Origin` to be exactly our web origin
//     (CORS_ORIGIN). No origin configured → every write is refused.
//  3. One exception, for Ledens Mobile: a request with NO `Origin` header that
//     requireAuth has already authenticated through a Bearer token
//     (req.authTransport === 'bearer' and req.user set), while
//     MOBILE_AUTH_ENABLED is exactly 'true' (read per request).
//
// Why the exception is safe: CSRF works by making a browser send a credential
// it attaches by itself, the cookie. A Bearer token is never attached by a
// browser; a foreign page cannot add `Authorization` to a cross-site request
// without a CORS preflight, which only our web origin passes (app.js). And
// requireAuth refuses cookie + Authorization together (401), so a request that
// reaches here as 'bearer' carries no cookie session at all.
//
// What the exception is NOT:
//  - the mere presence of an Authorization header — it only counts once
//    requireAuth matched it to a live session, so this guard must run AFTER
//    requireAuth (it never reads the header itself);
//  - a pass for a Bearer request that does carry an `Origin`: browsers send
//    Origin, and a browser never legitimately holds our Bearer token
//    (mobile login refuses any Origin), so a present Origin must still match;
//  - anything for anonymous requests: without req.user the rule is rule 2.
//
// `origin` is the expected value; leave it out to read CORS_ORIGIN on every
// request. `body` is the router's own 403 body.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const ORIGIN_DENIED = { error: 'Origen no permitido' };

const expectedOrigin = (options) => ('origin' in options ? options.origin : process.env.CORS_ORIGIN);

export function isAuthenticatedBearer(req) {
  return isMobileAuthEnabled() && req.authTransport === 'bearer' && !!req.user;
}

export function requireSameOrigin(options = {}) {
  const body = options.body || ORIGIN_DENIED;
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const sent = req.get('origin');
    if (sent === undefined && isAuthenticatedBearer(req)) return next();
    const origin = expectedOrigin(options);
    if (!origin || sent !== origin) return res.status(403).json(body);
    next();
  };
}

// For a router whose guard runs BEFORE authentication (invitaciones, where it
// also covers the public /aceptacion routes): answers exactly like
// requireSameOrigin for every request except one with no Origin that names a
// Bearer token (flag on, well-formed header, no cookie), which it lets continue
// unchecked so that requireAuth can validate the token first (a Bearer request
// WITH an Origin needs ours either way, so that is decided here). It is never
// enough on its own: every route behind it must also go through
// requireSameOrigin after requireAuth, or after nothing for a public route —
// which, with no req.user, then applies the full rule to that request.
export function requireSameOriginBeforeAuth(options = {}) {
  const guard = requireSameOrigin(options);
  return (req, res, next) => {
    if (!SAFE_METHODS.has(req.method) && req.get('origin') === undefined
      && readSessionCredential(req).transport === 'bearer') return next();
    guard(req, res, next);
  };
}
