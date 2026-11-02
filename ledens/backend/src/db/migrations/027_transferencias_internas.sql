-- Transferencias entre cuentas («Concepto de movimientos»). A bank movement to or
-- from another account of Sociedad Inversora Navarro Robinson S.L. is neither a
-- cost nor an income. ledens.bank_movements belongs to the bank import (its
-- is_internal_transfer flag is rewritten by the sync and is part of the Bridge
-- fingerprint), so the person's decision lives here: one row per movement.
-- Such a movement leaves «Pendiente de conciliación» and is listed as
-- «Transferencia entre cuentas». Removing the row undoes it.
CREATE TABLE ledens.internal_transfers (
  bank_movement_id uuid        PRIMARY KEY REFERENCES ledens.bank_movements (id),
  marked_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  marked_at        timestamptz NOT NULL DEFAULT now(),
  reason           text        CHECK (reason IS NULL OR length(reason) <= 500)
);
