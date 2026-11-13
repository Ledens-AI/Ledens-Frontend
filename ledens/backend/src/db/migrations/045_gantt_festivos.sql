-- Planificación (Gantt): calendario laboral. Días no laborables además de los
-- sábados y domingos: festivos de toda la empresa (project_id NULL — los
-- nacionales y de Andalucía, que un admin carga por año y revisa) o de un
-- proyecto concreto (project_id = ledens.projects.id, sin clave ajena hacia
-- ledens.*: los festivos locales del municipio de la obra, días de lluvia…).
-- El Gantt de un proyecto no cuenta como laborable ninguno de los suyos ni de
-- la empresa (src/presupuestos/gantt.js, calendar()).
CREATE TABLE gantt_festivos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha      date NOT NULL,
  nombre     text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  project_id uuid,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gantt_festivos_unico ON gantt_festivos (fecha, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX gantt_festivos_proyecto ON gantt_festivos (project_id, fecha);
