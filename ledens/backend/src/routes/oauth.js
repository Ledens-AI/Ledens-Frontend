import { Router } from 'express';
import { isDbConfigured } from '../db/pool.js';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '../auth/sessions.js';
import { findOrCreateUserFromIdentity, EmailInUseError } from '../auth/identities.js';
import * as google from '../auth/providers/google.js';
import * as microsoft from '../auth/providers/microsoft.js';

const router = Router();

// One-time-use, short-lived cookie proving the browser that lands on the
// callback is the same one we sent to the provider — without it, anyone
// could call the callback URL directly and forge a login. Shared across
// providers: only one OAuth attempt is ever in flight per browser at a time.
const STATE_COOKIE = 'oauth_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

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
  if (error) return res.redirect('/auth?error=google_cancelled');

  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect('/auth?error=google_failed');
  }

  try {
    const accessToken = await google.exchangeCodeForToken(code);
    const profile = await google.fetchProfile(accessToken);
    const user = await findOrCreateUserFromIdentity({ provider: 'google', ...profile });
    const { token } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
    res.redirect('/');
  } catch (err) {
    if (err instanceof EmailInUseError) {
      return res.redirect('/auth?error=google_email_in_use');
    }
    console.error('[oauth] google callback failed', err);
    res.redirect('/auth?error=google_failed');
  }
});

router.get('/microsoft', (req, res) => {
  if (!microsoft.isMicrosoftConfigured()) {
    return res.status(503).json({ error: 'Login con Microsoft no disponible todavía' });
  }
  if (!isDbConfigured()) {
    return res.status(503).json({ error: 'Login no disponible todavía' });
  }

  const state = microsoft.randomState();
  res.cookie(STATE_COOKIE, state, { ...sessionCookieOptions(req), maxAge: STATE_MAX_AGE_MS });
  res.redirect(microsoft.buildAuthUrl(state));
});

router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });

  if (error) return res.redirect('/auth?error=microsoft_cancelled');

  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect('/auth?error=microsoft_failed');
  }

  try {
    const accessToken = await microsoft.exchangeCodeForToken(code);
    const profile = await microsoft.fetchProfile(accessToken);
    const user = await findOrCreateUserFromIdentity({ provider: 'microsoft', ...profile });
    const { token } = await createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
    res.redirect('/');
  } catch (err) {
    if (err instanceof EmailInUseError) {
      return res.redirect('/auth?error=microsoft_email_in_use');
    }
    console.error('[oauth] microsoft callback failed', err);
    res.redirect('/auth?error=microsoft_failed');
  }
});

export default router;
