-- Users of the site. One row per person, however they sign in.
-- password_hash is NULL for people who only ever use Google / Microsoft / Apple.
CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  name          text        NOT NULL,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Emails are unique regardless of upper/lower case.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Social login methods linked to a user. Keeping these apart from `users`
-- lets one person use several methods (e.g. Google today, Microsoft later)
-- and still be the same account.
CREATE TABLE auth_identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         text        NOT NULL CHECK (provider IN ('google', 'microsoft', 'apple')),
  provider_user_id text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX auth_identities_user_id_idx ON auth_identities (user_id);
