-- Efectivo importado (FactMovimientosEfectivo) en las bandejas y en los resultados.
-- 015z kept the imported cash rows with kind NULL, out of every screen. They now
-- enter Pendiente de conciliación like cash entered from the app, so an admin
-- assigns each one (materiales, trabajadores, clientes) and its record counts in
-- profitability as any cash does (v_cash_records), or discards it when it is not
-- a cost or an income of its own (a duplicate of a payment already recorded, a
-- deposit into the bank...).
--   * The imported columns (movimientoefectivoid, tipomovimiento, concepto,
--     tercero, amount, categoria, project_source...) are never rewritten.
--   * Only the application columns are filled: kind from tipomovimiento (else the
--     sign of the amount), concept from concepto, counterparty from tercero, and
--     imported_detail keeps what the screens show (id, categoría, proyecto...).
--   * An imported amount keeps its own sign: the app reads abs(amount) and the
--     direction from kind.
--   * A row that cannot be read (no date, amount zero or with more than two
--     decimals) stays as it was, out of the screens.
-- On an installation without imported cash (016 created the table) only the new
-- columns are added.
-- One DO block: a single statement, like 015z (some runners take one per file).
DO $$ BEGIN
 ALTER TABLE ledens.cash_movements
  ADD COLUMN imported        boolean NOT NULL DEFAULT false,
  ADD COLUMN imported_detail jsonb,
  ADD COLUMN discard_reason  text CHECK (discard_reason IS NULL OR length(discard_reason) BETWEEN 5 AND 500);
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='ledens' AND table_name='cash_movements' AND column_name='movimientoefectivoid') THEN
 -- 015z's rule, widened for imported rows: signed amount and «descartado».
 ALTER TABLE ledens.cash_movements DROP CONSTRAINT cash_ui_row_valid;
 ALTER TABLE ledens.cash_movements ADD CONSTRAINT cash_ui_row_valid CHECK(kind IS NULL OR (
    kind IN ('pago','cobro') AND amount IS NOT NULL AND amount=round(amount,2)
    AND (amount>0 OR (imported AND amount<>0))
    AND occurred_on IS NOT NULL AND concept IS NOT NULL AND length(btrim(concept)) BETWEEN 1 AND 300
    AND (counterparty IS NULL OR length(counterparty)<=200)
    AND (assigned_to IS NULL OR assigned_to IN ('trabajadores','materiales','clientes') OR (imported AND assigned_to='descartado'))
    AND ((assigned_to IS NOT DISTINCT FROM 'descartado')=(discard_reason IS NOT NULL))
    AND (assigned_to IS DISTINCT FROM 'materiales' OR (kind='pago' AND material_id IS NOT NULL))
    AND (assigned_to IS DISTINCT FROM 'clientes' OR (kind='cobro' AND customer_payment_id IS NOT NULL))
    AND (assigned_to IS DISTINCT FROM 'trabajadores' OR kind='pago')));
 WITH src AS(
  SELECT k.id,to_jsonb(k) j,k.amount FROM ledens.cash_movements k
  WHERE k.kind IS NULL AND k.occurred_on IS NOT NULL AND k.amount IS NOT NULL AND k.amount<>0 AND k.amount=round(k.amount,2)),
 mapped AS(
  SELECT id,j,CASE
    WHEN lower(coalesce(j->>'tipomovimiento','')) ~ '^\s*(pago|gasto|salida)' THEN 'pago'
    WHEN lower(coalesce(j->>'tipomovimiento','')) ~ '^\s*(cobro|ingreso|entrada)' THEN 'cobro'
    WHEN amount<0 THEN 'pago' ELSE 'cobro' END kind
  FROM src)
 UPDATE ledens.cash_movements k SET
  imported=true,
  kind=m.kind,
  concept=left(coalesce(nullif(btrim(m.j->>'concepto'),''),'Efectivo importado '||coalesce(m.j->>'movimientoefectivoid','')),300),
  counterparty=left(nullif(btrim(m.j->>'tercero'),''),200),
  imported_detail=jsonb_strip_nulls(jsonb_build_object(
   'id',nullif(btrim(m.j->>'movimientoefectivoid'),''),'tipo',nullif(btrim(m.j->>'tipomovimiento'),''),
   'categoria',nullif(btrim(m.j->>'categoria'),''),'proyecto',nullif(btrim(m.j->>'project_source'),''),
   'comportamiento',nullif(btrim(m.j->>'comportamientocoste'),''),'impacto',nullif(btrim(m.j->>'impactoresultado'),''),
   'observaciones',nullif(btrim(m.j->>'observaciones'),'')))
 FROM mapped m WHERE k.id=m.id;
 END IF;
 -- The joint view (028) now reads cash amounts as abs(amount) signed by kind, so an
 -- imported amount counts with the direction of its kind, and shows the import.
 CREATE OR REPLACE VIEW ledens.treasury_movements AS
 SELECT b.id,
  'bank_movements'::text origin,
  b.completed_on occurred_on,
  coalesce(b.beneficiary_name,b.payer) counterparty,
  coalesce(nullif(b.description,''),b.reference) concept,
  b.description,
  b.reference,
  b.source_id,
  b.payer,
  b.beneficiary_name,
  concat_ws(' ',b.beneficiary_name,b.payer,b.description,b.reference) search_text,
  b.total_amount amount,
  b.currency,
  b.state,
  coalesce(b.is_internal_transfer,false) is_internal_transfer,
  EXISTS(SELECT 1 FROM ledens.internal_transfers it WHERE it.bank_movement_id=b.id) marked_transfer,
  CASE WHEN b.total_amount<0 THEN 'pago' WHEN b.total_amount>0 THEN 'cobro' END direction,
  NULL::text cash_kind,
  NULL::text assigned_to,
  NULL::uuid material_id,
  NULL::uuid customer_payment_id,
  NOT coalesce(b.is_internal_transfer,false) validable,
  false imported,
  NULL::jsonb imported_detail
 FROM ledens.bank_movements b
 UNION ALL
 SELECT k.id,
  'cash_movements'::text,
  k.occurred_on,
  k.counterparty,
  k.concept,
  k.concept,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  concat_ws(' ',k.counterparty,k.concept),
  CASE k.kind WHEN 'pago' THEN -round(abs(k.amount),2) WHEN 'cobro' THEN round(abs(k.amount),2) ELSE k.amount END,
  'EUR'::text,
  NULL::text,
  false,
  false,
  k.kind,
  k.kind,
  k.assigned_to,
  k.material_id,
  k.customer_payment_id,
  coalesce(k.kind IN ('pago','cobro'),false) AND k.assigned_to IS DISTINCT FROM 'descartado',
  k.imported,
  k.imported_detail
 FROM ledens.cash_movements k;
END $$;
