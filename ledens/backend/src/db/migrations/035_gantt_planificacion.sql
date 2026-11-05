-- Planificación (Gantt) of a project with an approved presupuesto. Each task is
-- an approved line of one of its obras (presupuesto_partidas of an approved
-- version: root and approved ampliaciones). Its duration comes from the
-- rendimiento of its partida in the base (ledens.work_items, read only), unless
-- the team sets one here; its start follows its predecessors.
-- Only the team's choices are stored; dates are always recalculated
-- (src/presupuestos/gantt.js).
CREATE TABLE gantt_tareas (
  partida_id    uuid PRIMARY KEY REFERENCES presupuesto_partidas (id) ON DELETE CASCADE,
  duration_days integer CHECK (duration_days BETWEEN 1 AND 3650),
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Predecessors: FS fin → inicio, SS inicio → inicio, FF fin → fin, SF inicio → fin,
-- with a lag in working days (negative = solape).
CREATE TABLE gantt_dependencias (
  partida_id     uuid NOT NULL REFERENCES presupuesto_partidas (id) ON DELETE CASCADE,
  predecessor_id uuid NOT NULL REFERENCES presupuesto_partidas (id) ON DELETE CASCADE,
  type           text NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days       integer NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -365 AND 365),
  PRIMARY KEY (partida_id, predecessor_id),
  CHECK (partida_id <> predecessor_id)
);
CREATE INDEX gantt_dependencias_pred_idx ON gantt_dependencias (predecessor_id);
