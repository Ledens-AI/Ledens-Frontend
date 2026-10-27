-- Invitaciones de cliente (/plataforma). The jefe de obra assigned to an obra
-- (or an admin) invites a client by email; the email carries a one-time link
-- that lets the client sign in (Google, Microsoft or a new password) and proves
-- they own the address (users.email_verified).
--
-- An obra is a root presupuesto (parent_id IS NULL). Its titular client is
-- presupuestos.client_id, who approves and comments; obra_clientes adds other
-- clients who see the obra (its presupuestos, progress, photos and documents)
-- without deciding on it. Inviting the titular adds no row.
CREATE TABLE invitaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- As typed by whoever invited: the list never shows the account's own data,
  -- so it can't be used to find out who already has an account.
  email           text NOT NULL CHECK (length(email) <= 200),
  name            text CHECK (length(name) <= 120),
  lang            text NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
  invited_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Only a SHA-256 of the link's token, as with sessions. It is minted when the
  -- email is handed to the mail sender (see invitaciones/service.js), so it is
  -- NULL until then and again once the invitation is used or revoked.
  token_hash      text UNIQUE,
  expires_at      timestamptz NOT NULL,
  sent_count      integer NOT NULL DEFAULT 1 CHECK (sent_count > 0),
  last_sent_at    timestamptz NOT NULL DEFAULT now(),
  -- false while access waits for the link: the account had a password nobody
  -- had proven (see the account-takeover note in CLAUDE.md).
  access_granted  boolean NOT NULL DEFAULT false,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX invitaciones_presupuesto_idx ON invitaciones (presupuesto_id);
CREATE INDEX invitaciones_user_idx ON invitaciones (user_id);
-- One open invitation per person and obra: inviting again resends it.
CREATE UNIQUE INDEX invitaciones_one_open ON invitaciones (presupuesto_id, user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Every send and resend, for the per-user sending limit.
CREATE TABLE invitacion_envios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invitacion_id  uuid NOT NULL REFERENCES invitaciones (id) ON DELETE CASCADE,
  sent_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  sent_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitacion_envios_sender_idx ON invitacion_envios (sent_by, sent_at);

CREATE TABLE obra_clientes (
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invitacion_id   uuid REFERENCES invitaciones (id) ON DELETE SET NULL,
  added_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (presupuesto_id, user_id)
);
CREATE INDEX obra_clientes_user_idx ON obra_clientes (user_id);
