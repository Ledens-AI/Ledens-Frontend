-- Ledens Mobile: Google / Microsoft login (routes/oauth.js, auth/handoffs.js).
-- The provider callback runs in the phone's browser, which must never receive
-- a session token. It gets a one-time handoff code instead, bound by PKCE S256
-- to the app that started the login; the app trades it for a session with
-- POST /api/auth/mobile/exchange. Only the SHA-256 of the code is stored, it
-- lives 60 seconds and can be used once.
CREATE TABLE IF NOT EXISTS auth_handoffs (
  code_hash      text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge text NOT NULL,
  provider       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
CREATE INDEX IF NOT EXISTS auth_handoffs_expires_idx ON auth_handoffs (expires_at);
