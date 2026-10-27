import { Router } from 'express';
import { getPool, isDbConfigured } from '../db/pool.js';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '../auth/sessions.js';
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

// Ends a provider login in a session. With an invitation link in progress
// (cookie set by /api/invitaciones/aceptacion/proveedor) the provider account
// must carry the invited email; the link proves that email, so the login
// counts as verified and the invitation is accepted. Otherwise the login is the
// ordinary one and the provider alone decides whether the email is verified.
async function signIn(req, res, provider, profile) {
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
  res.redirect(invite ? '/plataforma' : '/');
}

// A failed or cancelled provider login goes back to the page it started from:
// the invitation page while a link is in progress, /auth otherwise.
function failTo(req, res, code) {
  if (!req.cookies?.[INVITE_COOKIE]) return res.redirect(`/auth?error=${code}`);
  res.clearCookie(INVITE_COOKIE, { path: '/api/auth' });
  res.redirect(`/invitacion?error=${code}`);
}

router.get('/google', (req, res) => {
  if (!google.isGoogleConfigured()) {
    return res.status(503).json({ error: 'Login con Google no disponible todavía' });
  }
  if (!isDbConfigured()) {
    return res.status(503).json({ error: 'Login no disponible todavía' });
  }

  const state = google.randomState();
  res.cookie(STATE_COOKIE, state, { ...sessionCookieOptions(req), maxAge: STATE_MAX_AGE_MS });
  res.redirect(google.buildAuthUrl(state));
});

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
function onCallbackHost(req, res, provider, redirectUri) {
  const forwarded = String(req.get('x-forwarded-host') || '').split(',')[0].trim().toLowerCase();
  let target;
  try { target = new URL(redirectUri); } catch { return false; }
  if (!forwarded || forwarded === target.host.toLowerCase()) return false;
  res.redirect(`${target.origin}/api/auth/${provider}/inicio`);
  return true;
}

function startMicrosoft(req, res) {
  if (!microsoft.isMicrosoftConfigured()) {
    return res.status(503).json({ error: 'Login con Microsoft no disponible todavía' });
  }
  if (!isDbConfigured()) {
    return res.status(503).json({ error: 'Login no disponible todavía' });
  }

  const state = microsoft.randomState();
  res.cookie(STATE_COOKIE, state, { ...sessionCookieOptions(req), maxAge: STATE_MAX_AGE_MS });
  res.redirect(microsoft.buildAuthUrl(state));
}
router.get('/microsoft', (req, res) => {
  if (microsoft.isMicrosoftConfigured() && onCallbackHost(req, res, 'microsoft', process.env.MICROSOFT_REDIRECT_URI)) return;
  startMicrosoft(req, res);
});
router.get('/microsoft/inicio', startMicrosoft);

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
