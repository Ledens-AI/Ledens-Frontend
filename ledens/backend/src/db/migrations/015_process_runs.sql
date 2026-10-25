-- Logs de transacciones: one row per execution of a transaction process
-- (ingesta, OCR, archivo, Bridge, alertas por correo, imputación, validación,
-- pago a trabajadores, proyectos, trabajadores, permisos). Created «en_curso»
-- when the process starts and closed as «ok», «rechazado» (the request was
-- refused: validation, permissions, conflict) or «error» (technical failure).
-- A row left «en_curso» means the process never finished (crash, timeout).
-- Holds identifiers, counts and error codes only: never file contents, tokens,
-- request bodies or exception texts with data.
CREATE TABLE ledens.process_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  process     text        NOT NULL,
  step        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'en_curso' CHECK (status IN ('en_curso', 'ok', 'rechazado', 'error')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  entity_type text,
  entity_id   text,
  actor_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
  actor_label text,
  message     text,
  error_code  text,
  http_status integer,
  detail      jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX process_runs_started_idx ON ledens.process_runs (started_at DESC);
CREATE INDEX process_runs_process_idx ON ledens.process_runs (process, started_at DESC);
CREATE INDEX process_runs_problem_idx ON ledens.process_runs (started_at DESC) WHERE status <> 'ok';
