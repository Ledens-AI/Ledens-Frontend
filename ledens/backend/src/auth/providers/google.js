import crypto from 'node:crypto';

// Overridable so tests can point these at a local stand-in instead of the
// real Google endpoints — see test/oauth-google.test.js. Read as functions,
// not module-load-time constants: the test sets these env vars *after* this
// module has already been imported (via createApp()), so a cached const
// would silently keep pointing at the real Google endpoints.
const authUrl = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const userinfoUrl = () => process.env.GOOGLE_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo';

export function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI,
  );
}

export function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

export function buildAuthUrl(state) {
  const url = new URL(authUrl());
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

// Trades the one-time code for an access token. We deliberately don't verify
// an id_token's signature ourselves — that's easy to get subtly wrong by
// hand. Instead we call Google's own userinfo endpoint next, over HTTPS,
// which is already an authenticated channel.
export async function exchangeCodeForToken(code) {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error('google token exchange: no access_token in response');
  return body.access_token;
}

export async function fetchProfile(accessToken) {
  const res = await fetch(userinfoUrl(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google userinfo fetch failed: ${res.status}`);
  const profile = await res.json();
  if (!profile.sub || !profile.email) throw new Error('google userinfo: missing sub or email');
  return {
    providerUserId: profile.sub,
    email: profile.email,
    emailVerified: profile.email_verified === true || profile.email_verified === 'true',
    name: profile.name || profile.email,
  };
}
