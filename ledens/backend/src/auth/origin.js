// Origin (CSRF) guard shared by every router whose writes are authenticated
// by a session: presupuestos, obras, invitaciones, finanzas, finance, bridge
// and herramientas. It replaces seven inline copies of the same rule.
//
// Reads (GET/HEAD) always pass. A write passes when:
//  - its Origin header is exactly our web origin (CORS_ORIGIN) — the browser
//    case, unchanged: a cookie-authenticated write without our Origin is 403;
//  - or it was authenticated by a Bearer token that requireAuth has ALREADY
//    validated (req.authTransport === 'bearer', set only after the token
//    matched a live session and only while MOBILE_AUTH_ENABLED is 'true')
//    AND it carries no Origin header at all — the native-app case.
//
// Why the Bearer exemption is safe: CSRF works by making a victim's browser
// send its ambient cookie. A Bearer request carries no ambient credential —
// a foreign site cannot attach `Authorization` without a CORS preflight that
// our CORS policy refuses — and requireAuth refuses any request carrying the
// session cookie together with a Bearer header, so the cookie can never ride
// along on an exempted request.
//
// Order matters and fails closed: mounted before requireAuth (or on a route
// without it), req.authTransport is undefined and the guard is the strict
// web rule. A Bearer request that does send an Origin (i.e. a browser) must
// still match our origin.
//
// `origin` is the allowed origin, or a function returning it (read per
// request, e.g. bridge.js). `message` keeps each router's existing error body.
export function requireSameOrigin({ origin = process.env.CORS_ORIGIN, message = 'Origen no permitido' } = {}) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const allowed = typeof origin === 'function' ? origin() : origin;
    const sent = req.get('origin');
    if (sent === undefined && req.authTransport === 'bearer') return next();
    if (!allowed || sent !== allowed) return res.status(403).json({ error: message });
    next();
  };
}
