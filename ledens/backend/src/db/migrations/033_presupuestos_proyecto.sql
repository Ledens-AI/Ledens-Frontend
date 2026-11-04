-- Presupuestos linked to the projects of Gestión financiera (ledens.projects).
-- The link lives on the obra (root presupuesto); an ampliación follows the obra
-- it extends, so `project_id` is only set where parent_id IS NULL. No foreign key
-- into ledens.*: those tables belong to the accounting import (same rule as
-- presupuesto_partidas.base_code); PresupuestosService checks the project exists
-- and that the user may see it before writing it.
ALTER TABLE presupuestos ADD COLUMN project_id uuid;
ALTER TABLE presupuestos ADD CONSTRAINT presupuestos_project_root_chk CHECK (parent_id IS NULL OR project_id IS NULL);
CREATE INDEX presupuestos_project_idx ON presupuestos (project_id) WHERE project_id IS NOT NULL;

-- The obra of Casa Marbella belongs to project P2026-014. Linked only when
-- exactly one obra mentions Marbella and exactly one project has that code;
-- otherwise nothing changes and it is linked from «Presupuestos y obras».
DO $$
DECLARE pid uuid; n int; obra uuid;
BEGIN
  IF to_regclass('ledens.projects') IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT min(id::text)::uuid, count(*) FROM ledens.projects WHERE btrim(project_id) = 'P2026-014'$q$ INTO pid, n;
  IF n <> 1 THEN RETURN; END IF;
  SELECT min(id::text)::uuid, count(*) INTO obra, n FROM presupuestos
   WHERE parent_id IS NULL AND project_id IS NULL AND (title ILIKE '%marbella%' OR address ILIKE '%marbella%');
  IF n <> 1 THEN RETURN; END IF;
  UPDATE presupuestos SET project_id = pid, updated_at = now() WHERE id = obra;
  INSERT INTO audit_log (actor_label, action, target_label, detail)
  SELECT 'Sistema (migración)', 'Presupuesto vinculado a proyecto', p.ref, p.ref || ' · ' || p.title || ' → P2026-014'
    FROM presupuestos p WHERE p.id = obra;
END $$;
