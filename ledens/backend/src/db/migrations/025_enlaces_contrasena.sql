-- Links to create or reset a password (/contrasena#<token>), sent by email
-- through the notification queue like client invitations (migration 023).
-- Asked for by the person (forgot / no password yet) or sent by an admin.
-- Only a SHA-256 of the token, minted when the mail sender claims the
-- message; a newer link, using it or expiry ends it.
CREATE TABLE password_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lang          text NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
  requested_by  uuid REFERENCES users (id) ON DELETE SET NULL, -- NULL: the person asked
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  token_hash    text UNIQUE,
  used_at       timestamptz,
  ended_at      timestamptz -- replaced by a newer link
);
CREATE INDEX password_links_user_idx ON password_links (user_id, created_at);
