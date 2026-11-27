import { Router } from 'express';
import { getPool, isDbConfigured } from '../db/pool.js';
import { createSession, isMobileAuthEnabled, sessionCookieOptions, SESSION_COOKIE } from '../auth/sessions.js';
import { createHandoff, isChallenge } from '../auth/handoffs.js';
import { findOrCreateUserFromIdentity, EmailInUseError } from '../auth/identities.js';
import * as google from '../auth/providers/google.js';
import * as microsoft from '../auth/providers/microsoft.js';
import { checkIdentity, acceptWithIdentity, InvitacionError } from '../invitaciones/service.js';
import { INVITE_COOKIE } from './invitaciones.js';

const router = Router();

// One-time-use, short-lived cookie proving the browser that lands on the
// callback is the same one we sent to the provider — without it, anyone
// could call the callback URL directly and forge a login. Shared across
// providers: only one OAuth attempt is ever in flight per browser at a time.
const STATE_COOKIE = 'oauth_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Ledens Mobile (GET /api/auth/<provider>/mobile): the PKCE challenge of the
// app that opened the browser. With it, the callback answers with a one-time
// handoff code on MOBILE_OAUTH_REDIRECT_URI instead of a session cookie.
const MOBILE_COOKIE = 'oauth_mobile';
// The web version of Ledens Mobile (/movil/, Safari): `?destino=movil` brings
// the person back there instead of to the landing page; `?destino=obra`, to
// the page of a link to share an obra (/obra-compartida), which then joins it.
// Fixed values, never a URL from the request, so there is no open redirect.
const DEST_COOKIE = 'oauth_destino';
const DESTINATIONS = { movil: { ok: '/movil/', error: '/movil/acceso' }, obra: { ok: '/obra-compartida', error: '/obra-compartida' } };
const destinationOf = (v) => (Object.hasOwn(DESTINATIONS, v) ? v : null);
const AUTH_PATH = '/api/auth';
const mobileRedirectUri = () => process.env.MOBILE_OAUTH_REDIRECT_URI || 'ledens://auth/callback';
const flowCookie = (req) => ({ ...sessionCookieOptions(req), path: AUTH_PATH, maxAge: STATE_MAX_AGE_MS });

// Every start says which flow the next callback belongs to, so a cookie left
// behind by an abandoned attempt (same Chrome on Android) can't redirect a
// later web login to the app, or the other way round.
function setFlow(req, res, { mobileChallenge = null } = {}) {
  if (mobileChallenge) res.cookie(MOBILE_COOKIE, mobileChallenge, flowCookie(req));
  else res.clearCookie(MOBILE_COOKIE, { path: AUTH_PATH });
  const dest = mobileChallenge ? null : destinationOf(req.query.destino);
  if (dest) res.cookie(DEST_COOKIE, dest, flowCookie(req));
  else res.clearCookie(DEST_COOKIE, { path: AUTH_PATH });
  // A login started from a shared obra's page is not an invitation's, whatever an abandoned attempt left.
  if (dest === 'obra') res.clearCookie(INVITE_COOKIE, { path: AUTH_PATH });
}

const toApp = (params) => `${mobileRedirectUri()}?${new URLSearchParams(params)}`;

// Ends a provider login in a session. With an invitation link in progress
// (cookie set by /api/invitaciones/aceptacion/proveedor) the provider account
// must carry the invited email; the link proves that email, so the login
// counts as verified and the invitation is accepted. Otherwise the login is the
// ordinary one and the provider alone decides whether the email is verified.
async function signIn(req, res, provider, profile) {
  const mobileChallenge = req.cookies?.[MOBILE_COOKIE];
  if (mobileChallenge) {
    // Ledens Mobile: no cookie session for the browser; the app redeems the
    // code with its PKCE verifier (POST /api/auth/mobile/exchange).
    res.clearCookie(MOBILE_COOKIE, { path: AUTH_PATH });
    if (!isMobileAuthEnabled() || !isChallenge(mobileChallenge)) return res.redirect(toApp({ error: `${provider}_failed` }));
    const user = await findOrCreateUserFromIdentity({ provider, ...profile });
    const code = await createHandoff(user.id, mobileChallenge, provider);
    console.info('[auth] mobile oauth handoff', { user: user.id, provider });
    return res.redirect(toApp({ code }));
  }
  const dest = destinationOf(req.cookies?.[DEST_COOKIE]);
  res.clearCookie(DEST_COOKIE, { path: AUTH_PATH });
  const invite = req.cookies?.[INVITE_COOKIE];
  let user;
  if (invite) {
    res.clearCookie(INVITE_COOKIE, { path: '/api/auth' });
    try {
      await checkIdentity(getPool(), invite, profile.email);
      user = await findOrCreateUserFromIdentity({ provider, ...profile, emailVerified: true });
      await acceptWithIdentity(getPool(), invite, user.id, provider === 'google' ? 'Google' : 'Microsoft');
    } catch (err) {
      if (err instanceof InvitacionError) return res.redirect(`/invitacion?error=${encodeURIComponent(err.code || 'invitacion_no_valida')}`);
      throw err;
    }
  } else {
    user = await findOrCreateUserFromIdentity({ provider, ...profile });
  }
  const { token } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
  res.redirect(invite ? '/plataforma' : dest ? DESTINATIONS[dest].ok : '/');
}

// A failed or cancelled provider login goes back to the page it started from:
// /movil/ or a shared obra's page (destino), the invitation page while a link
// is in progress, /auth otherwise.
function failTo(req, res, code) {
  if (req.cookies?.[MOBILE_COOKIE]) {
    res.clearCookie(MOBILE_COOKIE, { path: AUTH_PATH });
    return res.redirect(toApp({ error: code }));
  }
  const dest = destinationOf(req.cookies?.[DEST_COOKIE]);
  if (dest) {
    res.clearCookie(DEST_COOKIE, { path: AUTH_PATH });
    return res.redirect(`${DESTINATIONS[dest].error}?error=${code}`);
  }
  if (!req.cookies?.[INVITE_COOKIE]) return res.redirect(`/auth?error=${code}`);
  res.clearCookie(INVITE_COOKIE, { path: '/api/auth' });
  res.redirect(`/invitacion?error=${code}`);
}

function startGoogle(req, res, flow = {}) {
  if (!google.isGoogleConfigured()) {
    return res.status(503).json({ error: 'Login con Google no disponible todavía' });
  }
  if (!isDbConfigured()) {
    return res.status(503).json({ error: 'Login no disponible todavía' });
  }

  setFlow(req, res, flow);
  const state = google.randomState();
  res.cookie(STATE_COOKIE, state, { ...sessionCookieOptions(req), maxAge: STATE_MAX_AGE_MS });
  res.redirect(google.buildAuthUrl(state));
}
router.get('/google', (req, res) => startGoogle(req, res));

// Ledens Mobile: same provider app, same registered redirect_uri as the web;
// only the end of the callback differs (handoff code, see signIn). An invitation
// in progress in this browser is dropped: invitations are accepted on the web.
function mobileStart(start) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isMobileAuthEnabled()) return res.status(404).json({ error: 'No encontrado' });
    const challenge = req.query.code_challenge;
    if (!isChallenge(challenge) || (req.query.code_challenge_method ?? 'S256') !== 'S256') {
      return res.status(400).json({ error: 'Solicitud no válida' });
    }
    res.clearCookie(INVITE_COOKIE, { path: '/api/auth' });
    start(req, res, { mobileChallenge: challenge });
  };
}
router.get('/google/mobile', mobileStart(startGoogle));

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });

  // Google itself reports a cancelled consent screen this way — not an error
  // on our side, so a plainer message than the generic failure below.
  if (error) return failTo(req, res, 'google_cancelled');

  if (!code || !state || !expectedState || state !== expectedState) {
    return failTo(req, res, 'google_failed');
  }

  try {
    const accessToken = await google.exchangeCodeForToken(code);
    const profile = await google.fetchProfile(accessToken);
    await signIn(req, res, 'google', profile);
  } catch (err) {
    if (err instanceof EmailInUseError) {
      return failTo(req, res, 'google_email_in_use');
    }
    console.error('[oauth] google callback failed', err);
    failTo(req, res, 'google_failed');
  }
});

// Microsoft / Google send the person back to *_REDIRECT_URI. The state cookie
// has to be set on that same host, or the callback can't find it and the login
// fails («No se pudo iniciar sesión»): when the browser started on another
// address of the site (as forwarded by the Static Web App), go through that
// host first. /inicio never redirects again, so this can't loop.
function onCallbackHost(req, res, provider, redirectUri, path = 'inicio') {
  const forwarded = String(req.get('x-forwarded-host') || '').split(',')[0].trim().toLowerCase();
  let target;
  try { target = new URL(redirectUri); } catch { return false; }
  if (!forwarded || forwarded === target.host.toLowerCase()) return false;
  // Only the known, validated parameters travel to the other host.
  const keep = new URLSearchParams();
  if (path === 'mobile' && isChallenge(req.query.code_challenge)) keep.set('code_challenge', req.query.code_challenge);
  if (path === 'inicio' && destinationOf(req.query.destino)) keep.set('destino', req.query.destino);
  const qs = keep.toString();
  res.redirect(`${target.origin}/api/auth/${provider}/${path}${qs ? `?${qs}` : ''}`);
  return true;
}

function startMicrosoft(req, res, flow = {}) {
  if (!microsoft.isMicrosoftConfigured()) {
    return res.status(503).json({ error: 'Login con Microsoft no disponible todavía' });
  }
  if (!isDbConfigured()) {
    return res.status(503).json({ error: 'Login no disponible todavía' });
  }

  setFlow(req, res, flow);
  const state = microsoft.randomState();
  res.cookie(STATE_COOKIE, state, { ...sessionCookieOptions(req), maxAge: STATE_MAX_AGE_MS });
  res.redirect(microsoft.buildAuthUrl(state));
}
router.get('/microsoft', (req, res) => {
  if (microsoft.isMicrosoftConfigured() && onCallbackHost(req, res, 'microsoft', process.env.MICROSOFT_REDIRECT_URI)) return;
  startMicrosoft(req, res);
});
router.get('/microsoft/inicio', (req, res) => startMicrosoft(req, res));
router.get('/microsoft/mobile', mobileStart((req, res, flow) => {
  if (microsoft.isMicrosoftConfigured() && onCallbackHost(req, res, 'microsoft', process.env.MICROSOFT_REDIRECT_URI, 'mobile')) return;
  startMicrosoft(req, res, flow);
}));

router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });

  if (error) {
    // access_denied is the person cancelling; anything else is Microsoft refusing (logged with its AADSTS code).
    if (error !== 'access_denied') console.warn('[oauth] microsoft returned an error', error, String(req.query.error_description || '').slice(0, 300));
    return failTo(req, res, error === 'access_denied' ? 'microsoft_cancelled' : 'microsoft_failed');
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    console.warn('[oauth] microsoft callback without its state cookie', { host: req.get('x-forwarded-host') || req.get('host'), hasCookie: Boolean(expectedState) });
    return failTo(req, res, 'microsoft_failed');
  }

  try {
    const { accessToken, idToken } = await microsoft.exchangeCodeForToken(code);
    const profile = await microsoft.fetchProfile(accessToken, { idToken });
    await signIn(req, res, 'microsoft', profile);
  } catch (err) {
    if (err instanceof EmailInUseError) {
      return failTo(req, res, 'microsoft_email_in_use');
    }
    console.error('[oauth] microsoft callback failed', err);
    failTo(req, res, 'microsoft_failed');
  }
});

export default router;
