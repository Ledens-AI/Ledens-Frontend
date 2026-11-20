-- Partidas eliminadas de un presupuesto ya aprobado (obra en curso). The line
-- stays (what the client approved, and any production declared on it, is
-- history) but stops counting: totals, % de ejecución / consumido, Gantt,
-- necesidades de materiales and «Analizar existentes» skip it. Lines of a
-- draft are deleted outright, and those of a sent version go into a new draft
-- version without them (PresupuestosService.removeLine); only an approved
-- version keeps them marked here.
ALTER TABLE presupuesto_partidas
  ADD COLUMN removed_at     timestamptz,
  ADD COLUMN removed_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN removed_reason text CHECK (removed_reason IS NULL OR length(removed_reason) <= 1000);
