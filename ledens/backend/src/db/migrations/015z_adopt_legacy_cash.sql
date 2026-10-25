-- Runs before 016, which cannot CREATE the already imported cash_movements.
-- Adopt the verified legacy shape without rewriting any imported value.
-- Imported rows have kind NULL: never infer their business meaning or expose
-- them as new unassigned cash. New UI rows always supply an explicit kind.
DO $$ BEGIN
 IF to_regclass('ledens.cash_movements') IS NULL OR EXISTS(SELECT 1 FROM schema_migrations WHERE name='016_cash_movements.sql') THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='ledens' AND table_name='cash_movements' AND column_name='movimientoefectivoid')
  OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='ledens' AND table_name='cash_movements' AND column_name='kind') THEN
  RAISE EXCEPTION 'Unrecognized existing cash schema: explicit review required';
 END IF;
 ALTER TABLE ledens.cash_movements
  ADD COLUMN kind text,
  ADD COLUMN concept text,
  ADD COLUMN counterparty text,
  ADD COLUMN assigned_to text,
  ADD COLUMN material_id uuid UNIQUE REFERENCES ledens.material_expenses(id),
  ADD COLUMN customer_payment_id uuid UNIQUE REFERENCES ledens.customer_payments(id),
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz,
  ADD CONSTRAINT cash_ui_row_valid CHECK(kind IS NULL OR (
    kind IN ('pago','cobro') AND amount IS NOT NULL AND amount>0 AND amount=round(amount,2)
    AND occurred_on IS NOT NULL AND concept IS NOT NULL AND length(btrim(concept)) BETWEEN 1 AND 300
    AND (counterparty IS NULL OR length(counterparty)<=200)
    AND (assigned_to IS NULL OR assigned_to IN ('trabajadores','materiales','clientes'))
    AND (assigned_to IS DISTINCT FROM 'materiales' OR (kind='pago' AND material_id IS NOT NULL))
    AND (assigned_to IS DISTINCT FROM 'clientes' OR (kind='cobro' AND customer_payment_id IS NOT NULL))
    AND (assigned_to IS DISTINCT FROM 'trabajadores' OR kind='pago')));
 CREATE INDEX cash_movements_pending_idx ON ledens.cash_movements(occurred_on DESC) WHERE assigned_to IS NULL AND kind IS NOT NULL;
 ALTER TABLE ledens.worker_payment_batches ALTER COLUMN bank_movement_id DROP NOT NULL;
 ALTER TABLE ledens.worker_payment_batches ADD COLUMN cash_movement_id uuid UNIQUE REFERENCES ledens.cash_movements(id);
 ALTER TABLE ledens.worker_payment_batches ADD CONSTRAINT worker_payment_batches_one_source CHECK(num_nonnulls(bank_movement_id,cash_movement_id)=1);
 CREATE VIEW ledens.v_cash_records AS
  SELECT r.id record_id FROM ledens.cash_movements k JOIN ledens.financial_records r ON r.material_id=k.material_id
  UNION ALL SELECT r.id FROM ledens.cash_movements k JOIN ledens.financial_records r ON r.customer_payment_id=k.customer_payment_id
  UNION ALL SELECT r.id FROM ledens.worker_payment_batches b JOIN ledens.worker_payment_splits s ON s.batch_id=b.id
   JOIN ledens.financial_records r ON r.worker_payment_id=s.worker_payment_id WHERE b.cash_movement_id IS NOT NULL;
 -- All application changes from 016 are now implemented in this same transaction.
 -- Record adoption only after every column, constraint and view succeeded.
 INSERT INTO schema_migrations(name) VALUES('016_cash_movements.sql');
END $$;
