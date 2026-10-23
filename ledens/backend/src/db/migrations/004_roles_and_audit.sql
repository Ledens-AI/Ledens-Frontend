-- Roles decide what each user may see and do in /plataforma:
--   admin  — user administration, roles, audit log
--   jefe   — jefe de obra: the works assigned to them
--   client — their own works and budgets (default for every new account)
-- Enforced server-side by requireRole() in src/auth/sessions.js; the
-- frontend only mirrors it.
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'client'
  CHECK (role IN ('admin', 'jefe', 'client'));

-- Who changed what, for the admin "Auditoría" screen. actor/target keep a
-- text label too, so entries stay readable after a user is deleted.
CREATE TABLE audit_log (
  id           bigserial   PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid        REFERENCES users (id) ON DELETE SET NULL,
  actor_label  text        NOT NULL,
  action       text        NOT NULL,
  target_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
  target_label text,
  detail       text
);

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Initial staff and test client, as requested by the owner (23 Oct 2026).
-- Accounts that don't exist yet are created with no password: nobody can
-- register these emails with a password of their own (that returns 409), and
-- the real owner gets in either with a Google/Microsoft login on that email
-- (which proves ownership and claims the account, see src/auth/identities.js)
-- or with a temporary password set by an operator:
--   npm run users -- set-password <email>
-- Accounts that already exist keep their name and password; only the role
-- changes.
WITH seed (email, name, role) AS (
  VALUES
    ('ajnavarrosilva@gmail.com',     'Álvaro Navarro',  'admin'),
    ('alvaro.navarro@ledens.es',     'Álvaro Navarro',  'admin'),
    ('ana.anzola@ledens.es',         'Ana Anzola',      'jefe'),
    ('alvaronavarrosilva@outlook.es','Álvaro Navarro',  'client')
),
upserted AS (
  INSERT INTO users (email, name, role)
  SELECT email, name, role FROM seed
  ON CONFLICT ((lower(email))) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
  RETURNING id, email, role
)
INSERT INTO audit_log (actor_label, action, target_id, target_label, detail)
SELECT 'Sistema', 'Rol asignado', id, email, 'Rol inicial: ' || role || ' (migración 004)'
  FROM upserted;
