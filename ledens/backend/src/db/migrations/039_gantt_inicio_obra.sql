-- «Inicio de obra» in the Planificación (Gantt): a milestone per obra (root
-- presupuesto) on its start date that a task may take as its predecessor, like
-- any other task. gantt_dependencias only links lines to lines (its
-- predecessor_id references presupuesto_partidas), so the milestone gets its
-- own table instead of loosening that key (src/presupuestos/gantt.js).
CREATE TABLE gantt_inicio_dependencias (
  partida_id uuid NOT NULL REFERENCES presupuesto_partidas (id) ON DELETE CASCADE,
  obra_id    uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  type       text NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days   integer NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -365 AND 365),
  PRIMARY KEY (partida_id, obra_id)
);
CREATE INDEX gantt_inicio_dependencias_obra_idx ON gantt_inicio_dependencias (obra_id);
