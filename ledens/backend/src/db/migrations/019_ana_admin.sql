-- ana.anzola@ledens.es becomes admin, as requested by the owner (26 Oct 2026).
-- Only the role changes (name, password and sign-in methods stay); if the
-- account does not exist it is created without a password, like migration 004.
-- The change is written to audit_log like any role change from the panel.
WITH before AS (
  SELECT id, role FROM users WHERE lower(email) = 'ana.anzola@ledens.es'
),
upserted AS (
  INSERT INTO users (email, name, role) VALUES ('ana.anzola@ledens.es', 'Ana Anzola', 'admin')
  ON CONFLICT ((lower(email))) DO UPDATE SET role = 'admin', updated_at = now()
    WHERE users.role <> 'admin'
  RETURNING id, email
)
INSERT INTO audit_log (actor_label, action, target_id, target_label, detail)
SELECT 'Sistema', 'Rol cambiado', u.id, u.email,
       coalesce(CASE b.role WHEN 'jefe' THEN 'Jefe de obra' WHEN 'client' THEN 'Cliente' END, 'Sin cuenta') ||
       ' → Administrador · solicitado por el propietario (migración 019)'
  FROM upserted u LEFT JOIN before b ON b.id = u.id;
