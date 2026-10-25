-- Pagos y cobros en efectivo. There is no bank behind them, so they get their own
-- table instead of rows in ledens.bank_movements (owned by the bank import).
-- An entry waits in «Pendiente de conciliación» until it is assigned:
--   * a payment to «Pagos a trabajadores» goes through the same batch/split
--     staging as a bank movement (013), keyed by cash_movement_id;
--   * a payment to «Pagos de materiales» becomes a ledens.material_expenses row;
--   * a receipt to «Pagos de clientes» becomes a ledens.customer_payments row.
-- Those source rows reach financial_records through 006's triggers, as always.
-- (015 is process_runs.)
CREATE TABLE ledens.cash_movements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text        NOT NULL CHECK (kind IN ('pago', 'cobro')),
  amount              numeric     NOT NULL CHECK (amount > 0 AND amount = round(amount, 2)),
  occurred_on         date        NOT NULL,
  concept             text        NOT NULL CHECK (length(btrim(concept)) BETWEEN 1 AND 300),
  counterparty        text        CHECK (counterparty IS NULL OR length(counterparty) <= 200),
  assigned_to         text        CHECK (assigned_to IN ('trabajadores', 'materiales', 'clientes')),
  material_id         uuid        UNIQUE REFERENCES ledens.material_expenses (id),
  customer_payment_id uuid        UNIQUE REFERENCES ledens.customer_payments (id),
  created_by          uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  assigned_by         uuid        REFERENCES users (id) ON DELETE SET NULL,
  assigned_at         timestamptz,
  CHECK (assigned_to IS DISTINCT FROM 'materiales' OR (kind = 'pago' AND material_id IS NOT NULL)),
  CHECK (assigned_to IS DISTINCT FROM 'clientes' OR (kind = 'cobro' AND customer_payment_id IS NOT NULL)),
  CHECK (assigned_to IS DISTINCT FROM 'trabajadores' OR kind = 'pago')
);
CREATE INDEX cash_movements_pending_idx ON ledens.cash_movements (occurred_on DESC) WHERE assigned_to IS NULL;

-- Worker batches can now come from a bank movement or from cash, never both.
ALTER TABLE ledens.worker_payment_batches ALTER COLUMN bank_movement_id DROP NOT NULL;
ALTER TABLE ledens.worker_payment_batches ADD COLUMN cash_movement_id uuid UNIQUE REFERENCES ledens.cash_movements (id);
ALTER TABLE ledens.worker_payment_batches ADD CONSTRAINT worker_payment_batches_one_source
  CHECK (num_nonnulls(bank_movement_id, cash_movement_id) = 1);

-- Financial records paid or collected in cash: profitability counts them as
-- treasury, since no bank movement or Bridge link will ever cover them.
CREATE VIEW ledens.v_cash_records AS
 SELECT r.id record_id FROM ledens.cash_movements k JOIN ledens.financial_records r ON r.material_id = k.material_id
 UNION ALL
 SELECT r.id FROM ledens.cash_movements k JOIN ledens.financial_records r ON r.customer_payment_id = k.customer_payment_id
 UNION ALL
 SELECT r.id FROM ledens.worker_payment_batches b JOIN ledens.worker_payment_splits s ON s.batch_id = b.id
  JOIN ledens.financial_records r ON r.worker_payment_id = s.worker_payment_id WHERE b.cash_movement_id IS NOT NULL;
