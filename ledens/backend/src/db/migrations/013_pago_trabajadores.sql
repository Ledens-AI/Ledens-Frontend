-- Pago a trabajadores: a bank movement classified from «Pendiente de conciliación»
-- as worker pay is split into fixed-size lines (Oficial 100 € when the movement is
-- above 450 €, Ayudante 60 € otherwise; the last line carries any remainder).
-- Each line waits in «Pendiente de trabajador» until a person gives it a worker
-- and a project; saving it creates the ledens.worker_payments row (registered in
-- financial_records by 006's triggers) and allocates it through FinanceService.
-- These two tables are only the staging area: no amount here counts anywhere.
CREATE TABLE ledens.worker_payment_batches (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_movement_id uuid        NOT NULL UNIQUE REFERENCES ledens.bank_movements (id),
  role             text        NOT NULL CHECK (role IN ('oficial', 'ayudante')),
  unit_amount      numeric     NOT NULL CHECK (unit_amount > 0),
  total_amount     numeric     NOT NULL CHECK (total_amount > 0 AND total_amount = round(total_amount, 2)),
  occurred_on      date,
  created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledens.worker_payment_splits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid        NOT NULL REFERENCES ledens.worker_payment_batches (id) ON DELETE CASCADE,
  line_number       integer     NOT NULL CHECK (line_number > 0),
  amount            numeric     NOT NULL CHECK (amount > 0 AND amount = round(amount, 2)),
  role              text        NOT NULL CHECK (role IN ('oficial', 'ayudante')),
  worker_payment_id uuid        UNIQUE REFERENCES ledens.worker_payments (id),
  saved_by          uuid        REFERENCES users (id) ON DELETE SET NULL,
  saved_at          timestamptz,
  UNIQUE (batch_id, line_number)
);
CREATE INDEX worker_payment_splits_pending_idx ON ledens.worker_payment_splits (batch_id) WHERE worker_payment_id IS NULL;
