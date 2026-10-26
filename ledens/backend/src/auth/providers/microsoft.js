import crypto from 'node:crypto';

// Overridable so tests can point these at a local stand-in — same pattern,
// same reasoning (read per-call, not cached at module load), as
// src/auth/providers/google.js.
const authUrl = () =>
  process.env.MICROSOFT_AUTH_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const tokenUrl = () => process.env.MICROSOFT_TOKEN_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const userinfoUrl = () => process.env.MICROSOFT_USERINFO_URL || 'https://graph.microsoft.com/oidc/userinfo';

// "common" accepts both personal and work/school Microsoft accounts, per
// issue #12's "cualquier cuenta Microsoft (personal + organizacional)".

export function isMicrosoftConfigured() {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_REDIRECT_URI,
  );
}

export function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

export function buildAuthUrl(state) {
  const url = new URL(authUrl());
  url.searchParams.set('client_id', process.env.MICROSOFT_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.MICROSOFT_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeCodeForToken(code) {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`microsoft token exchange failed: ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error('microsoft token exchange: no access_token in response');
  return { accessToken: body.access_token, idToken: body.id_token || null };
}

// Claims of the id_token returned with the access token. It comes straight
// from Microsoft's token endpoint to this server over TLS, which OpenID Connect
// Core §3.1.3.7 accepts in place of checking the signature; it is never taken
// from the browser. Anything unreadable is null.
export function idTokenClaims(idToken) {
  try {
    const [, payload] = String(idToken || '').split('.');
    return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : null;
  } catch {
    return null;
  }
}

// Microsoft's userinfo carries no email_verified, so every Microsoft login used
// to count as unverified and could not claim an existing account (the staff
// accounts seeded by migration 004). An account of the company's own Entra
// tenant on the company's domain is administered by the company itself: its
// email is trusted when the id_token is for this app, issued by that tenant,
// and its sign-in name is that email (external guests have #EXT# names).
// Ledens tenant and domain by default; MICROSOFT_TRUSTED_TENANT_IDS /
// MICROSOFT_TRUSTED_DOMAINS (comma-separated) override them, '' disables it.
const LEDENS_TENANT = '89aa3c28-3056-4509-bfc5-5c16f8f0737a';
const list = (value, fallback) => (value ?? fallback).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export function trustedOrganizationEmail(claims, email) {
  const tenants = list(process.env.MICROSOFT_TRUSTED_TENANT_IDS, LEDENS_TENANT);
  const domains = list(process.env.MICROSOFT_TRUSTED_DOMAINS, 'ledens.es');
  if (!claims || !email || !tenants.length || !domains.length) return false;
  const tid = String(claims.tid || '').toLowerCase();
  const address = String(email).toLowerCase();
  return tenants.includes(tid)
    && claims.aud === process.env.MICROSOFT_CLIENT_ID
    && String(claims.iss || '').toLowerCase() === `https://login.microsoftonline.com/${tid}/v2.0`
    && String(claims.preferred_username || '').toLowerCase() === address
    && domains.includes(address.split('@')[1]);
}

// NOTE — unconfirmed against a real Microsoft account (no test account
// available yet): unlike Google, Microsoft's OIDC userinfo response may not
// reliably include an email_verified claim. We read it the same way either
// way — anything other than an explicit true counts as unverified — which
// is the safe default regardless: it just means a first Microsoft login is
// more likely to land in identities.js's "create/reclaim" path than its
// "trusted link" path until this is confirmed one way or the other.
// Confirmed since with real accounts: userinfo has no email_verified, so the
// company's own accounts are verified through trustedOrganizationEmail above.
export async function fetchProfile(accessToken, { idToken } = {}) {
  const res = await fetch(userinfoUrl(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`microsoft userinfo fetch failed: ${res.status}`);
  const profile = await res.json();
  const email = profile.email || profile.preferred_username;
  if (!profile.sub || !email) throw new Error('microsoft userinfo: missing sub or email');
  return {
    providerUserId: profile.sub,
    email,
    emailVerified: profile.email_verified === true || profile.email_verified === 'true'
      || trustedOrganizationEmail(idTokenClaims(idToken), email),
    name: profile.name || email,
  };
}
