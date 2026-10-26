-- Presupuestos (migration 020), adjustments after it shipped:
-- * unit_price keeps 6 decimals and executed quantities 4, so a budget
--   imported from a spreadsheet with VAT-inclusive prices (e.g. 200 / 1,21)
--   adds back up to its original total and progress (src/presupuestos/import.js);
-- * the reference keeps every digit of the sequence: lpad(…, 3) truncated
--   1000 to «100» and collided with an earlier reference.
ALTER TABLE presupuesto_partidas ALTER COLUMN unit_price TYPE numeric(14, 6);
ALTER TABLE presupuesto_produccion ALTER COLUMN executed TYPE numeric(14, 4);

CREATE FUNCTION presupuesto_next_ref() RETURNS text LANGUAGE sql AS $$
  SELECT 'PRE-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, greatest(3, length(n::text)), '0')
    FROM (SELECT nextval('presupuesto_ref_seq') AS n) s
$$;
ALTER TABLE presupuestos ALTER COLUMN ref SET DEFAULT presupuesto_next_ref();
