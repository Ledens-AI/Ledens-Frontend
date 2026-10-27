import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { trustedOrganizationEmail, trustedConsumerEmail, idTokenClaims, fetchProfile } from '../src/auth/providers/microsoft.js';
// Microsoft accounts of the company's own tenant count as verified; nothing else does.
const TENANT = '89aa3c28-3056-4509-bfc5-5c16f8f0737a';
const jwt = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const claims = (over = {}) => ({ tid: TENANT, aud: 'test-client-id', iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, preferred_username: 'ana.anzola@ledens.es', ...over });
let server, saved;
before(async () => {
  saved = { ...process.env };
  process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
  delete process.env.MICROSOFT_TRUSTED_TENANT_IDS; delete process.env.MICROSOFT_TRUSTED_DOMAINS;
  server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ sub: 'ms-1', email: 'Ana.Anzola@ledens.es', name: 'Ana' })); });
  server.listen(0); await once(server, 'listening');
  process.env.MICROSOFT_USERINFO_URL = `http://127.0.0.1:${server.address().port}/userinfo`;
});
after(() => { server?.close(); process.env = saved; });

test('an account of the Ledens tenant on ledens.es is a verified email', () => {
  assert.equal(trustedOrganizationEmail(claims(), 'Ana.Anzola@ledens.es'), true);
  assert.equal(trustedOrganizationEmail(claims({ tid: 'f0000000-0000-0000-0000-000000000000', iss: 'https://login.microsoftonline.com/f0000000-0000-0000-0000-000000000000/v2.0' }), 'ana.anzola@ledens.es'), false, 'another tenant');
  assert.equal(trustedOrganizationEmail(claims({ tid: '9188040d-6c67-4c5b-b112-36a304b66dad', iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0', preferred_username: 'x@outlook.es' }), 'x@outlook.es'), false, 'personal accounts');
  assert.equal(trustedOrganizationEmail(claims({ preferred_username: 'someone_gmail.com#EXT#@ledens.onmicrosoft.com' }), 'someone@gmail.com'), false, 'an external guest');
  assert.equal(trustedOrganizationEmail(claims({ preferred_username: 'ana@ledens.onmicrosoft.com' }), 'ana@ledens.onmicrosoft.com'), false, 'not the company domain');
  assert.equal(trustedOrganizationEmail(claims({ aud: 'other-app' }), 'ana.anzola@ledens.es'), false, 'a token for another app');
  assert.equal(trustedOrganizationEmail(claims({ iss: 'https://evil.example/v2.0' }), 'ana.anzola@ledens.es'), false, 'issuer of another tenant');
  assert.equal(trustedOrganizationEmail(null, 'ana.anzola@ledens.es'), false);
});

test('the trusted tenants and domains can be configured or switched off', () => {
  process.env.MICROSOFT_TRUSTED_DOMAINS = '';
  try { assert.equal(trustedOrganizationEmail(claims(), 'ana.anzola@ledens.es'), false); } finally { delete process.env.MICROSOFT_TRUSTED_DOMAINS; }
  process.env.MICROSOFT_TRUSTED_TENANT_IDS = 'f0000000-0000-0000-0000-000000000000';
  try { assert.equal(trustedOrganizationEmail(claims(), 'ana.anzola@ledens.es'), false); } finally { delete process.env.MICROSOFT_TRUSTED_TENANT_IDS; }
});

test('fetchProfile marks the email verified only with a matching id_token', async () => {
  assert.equal(idTokenClaims('not a jwt'), null);
  assert.deepEqual(idTokenClaims(jwt({ tid: TENANT })), { tid: TENANT });
  assert.equal((await fetchProfile('t', { idToken: jwt(claims()) })).emailVerified, true);
  assert.equal((await fetchProfile('t', { idToken: jwt(claims({ preferred_username: 'otra@ledens.es' })) })).emailVerified, false, 'sign-in name is another account');
  assert.equal((await fetchProfile('t')).emailVerified, false, 'no id_token');
});

test('a personal account is verified only on a Microsoft mail domain it signs in with', () => {
  const C = '9188040d-6c67-4c5b-b112-36a304b66dad';
  const personal = (over = {}) => ({ tid: C, aud: 'test-client-id', iss: `https://login.microsoftonline.com/${C}/v2.0`, preferred_username: 'grijnierse@hotmail.com', ...over });
  assert.equal(trustedConsumerEmail(personal(), 'Grijnierse@hotmail.com'), true);
  assert.equal(trustedConsumerEmail(personal({ preferred_username: 'x@gmail.com' }), 'x@gmail.com'), false, 'a personal account on another address');
  assert.equal(trustedConsumerEmail(personal({ preferred_username: 'x@hotmail.com.evil.test' }), 'x@hotmail.com.evil.test'), false, 'a lookalike domain');
  assert.equal(trustedConsumerEmail(personal(), 'otra@hotmail.com'), false, 'sign-in name is not the email');
  assert.equal(trustedConsumerEmail(personal({ tid: TENANT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0` }), 'grijnierse@hotmail.com'), false, 'an organisation tenant');
  assert.equal(trustedConsumerEmail(personal({ aud: 'other-app' }), 'grijnierse@hotmail.com'), false, 'a token for another app');
  process.env.MICROSOFT_CONSUMER_DOMAINS = '';
  try { assert.equal(trustedConsumerEmail(personal(), 'grijnierse@hotmail.com'), false, 'switched off'); } finally { delete process.env.MICROSOFT_CONSUMER_DOMAINS; }
});
