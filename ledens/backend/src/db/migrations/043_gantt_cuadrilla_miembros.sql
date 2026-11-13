-- Recursos: who works in each cuadrilla of an obra (Planificación / Gantt).
-- Every cuadrilla (1..gantt_obras.cuadrillas) is one oficial and one peón of
-- the company's workers (ledens.employees, no foreign key into ledens.*: that
-- schema belongs to the accounting import). Choosing the number of cuadrillas
-- requires choosing them (src/presupuestos/gantt.js, setCuadrillas); the
-- «Recursos» screen (src/presupuestos/recursos.js) reads these rows to show
-- each worker's obras and overlapping assignments.
CREATE TABLE gantt_cuadrilla_miembros (
  obra_id     uuid NOT NULL REFERENCES presupuestos (id) ON DELETE CASCADE,
  cuadrilla   integer NOT NULL CHECK (cuadrilla BETWEEN 1 AND 20),
  rol         text NOT NULL CHECK (rol IN ('oficial', 'peon')),
  employee_id uuid NOT NULL,
  updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, cuadrilla, rol),
  UNIQUE (obra_id, employee_id) -- one worker, one place in an obra
);
CREATE INDEX gantt_cuadrilla_miembros_employee_idx ON gantt_cuadrilla_miembros (employee_id);
