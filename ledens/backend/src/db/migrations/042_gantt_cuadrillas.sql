-- Planificación (Gantt):
-- - Cuadrillas per obra: the rendimiento of the base is per cuadrilla, so with
--   N cuadrillas a duration computed from it is divided by N (a duration the
--   team typed stays as typed).
-- - «Inicio de obra» (039) is the default predecessor of every task nobody has
--   planned yet; removing it on purpose is recorded in sin_predecesoras, so the
--   task then has none (src/presupuestos/gantt.js).
CREATE TABLE gantt_obras (
  obra_id    uuid PRIMARY KEY REFERENCES presupuestos (id) ON DELETE CASCADE,
  cuadrillas integer NOT NULL DEFAULT 1 CHECK (cuadrillas BETWEEN 1 AND 20),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gantt_tareas ADD COLUMN sin_predecesoras boolean NOT NULL DEFAULT false;
