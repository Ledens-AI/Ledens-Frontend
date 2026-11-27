-- «Compartir» an obra (root presupuesto) with a link: whoever opens it creates
-- an account (or logs in with theirs) and follows the obra as a read-only client
-- (obra_clientes), like a client invited by email but without an address chosen
-- beforehand. The team (assigned jefe or admin) creates and revokes links from
-- «Usuarios con acceso» of the project page; see invitaciones/acceso.js.
CREATE TABLE obra_enlaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id  uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  -- Only a SHA-256 of the link's token, as with sessions and invitations: the
  -- token is shown once, to whoever creates the link, and never stored.
  token_hash      text NOT NULL UNIQUE,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  -- People who joined the obra with it (a person already in the obra does not count).
  uses            integer NOT NULL DEFAULT 0 CHECK (uses >= 0)
);
CREATE INDEX obra_enlaces_presupuesto_idx ON obra_enlaces (presupuesto_id);

-- How a read-only client got into the obra: an invitation (invitacion_id), a
-- shared link (enlace_id) or neither (the team made them read-only, e.g. a
-- former titular).
ALTER TABLE obra_clientes ADD COLUMN enlace_id uuid REFERENCES obra_enlaces (id) ON DELETE SET NULL;
