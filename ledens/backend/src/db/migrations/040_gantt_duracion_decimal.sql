-- Planificación (Gantt): durations in tenths of a working day, from 0 (two
-- tasks of 0,5 days in a row fill one day). Was whole days from 1 (035).
ALTER TABLE gantt_tareas DROP CONSTRAINT IF EXISTS gantt_tareas_duration_days_check;
ALTER TABLE gantt_tareas ALTER COLUMN duration_days TYPE numeric(6,1);
ALTER TABLE gantt_tareas ADD CONSTRAINT gantt_tareas_duration_days_check CHECK (duration_days BETWEEN 0 AND 3650);
