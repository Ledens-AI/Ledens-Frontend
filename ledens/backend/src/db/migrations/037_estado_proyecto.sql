-- Estado de un proyecto en «Presupuestos y obras»: abierto, en estudio o
-- cerrado. Only an abierto project lets the team declare the progress of its
-- obras («Actualizar avance»); en estudio (still being budgeted) and cerrado
-- do not. ledens.projects belongs to the accounting import and is never
-- altered (CLAUDE.md), so the state lives here, keyed by its id with no
-- foreign key into ledens.* (same rule as presupuestos.project_id).
--
-- A project with no row takes its state from ledens.project_statuses
-- (PresupuestosService.projectEstado): closed-looking names → cerrado,
-- study/offer → en estudio, anything else → abierto. Changed by an admin from
-- the project page; every change in audit_log «Estado de proyecto».
CREATE TABLE proyecto_estados (
  project_id  uuid PRIMARY KEY,
  estado      text NOT NULL CHECK (estado IN ('abierto', 'en_estudio', 'cerrado')),
  updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Every project that already has an approved obra stays open, whatever the
-- accounting import calls it, so the progress that can be declared today
-- (Casa Marbella) keeps working and an approved obra with no start date yet
-- can be declared too.
INSERT INTO proyecto_estados (project_id, estado)
SELECT DISTINCT p.project_id, 'abierto'
  FROM presupuestos p
 WHERE p.parent_id IS NULL AND p.project_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM presupuesto_versiones v WHERE v.presupuesto_id = p.id AND v.status = 'approved')
ON CONFLICT (project_id) DO NOTHING;
