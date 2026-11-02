-- Periodo trabajado de un pago a trabajador: the week, month or year the payment
-- is for, which is often not the day it was paid or registered (a week's pay
-- handed over on Saturday and registered on Monday). One row per
-- ledens.worker_payments row, set when the line is saved in «Pendiente de
-- trabajador» and editable afterwards from «Pagos a trabajadores».
-- ledens.worker_payments belongs to the accounting import and is never altered:
-- this table only hangs from it. `starts_on` is the first day of the period
-- (Monday, 1st of the month or 1 January). No amount here counts anywhere; the
-- «Pagos a trabajadores» chart groups by it when it exists.
CREATE TABLE ledens.worker_payment_periods (
  worker_payment_id uuid        PRIMARY KEY REFERENCES ledens.worker_payments (id) ON DELETE CASCADE,
  period            text        NOT NULL CHECK (period IN ('semana', 'mes', 'anio')),
  starts_on         date        NOT NULL,
  updated_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on = date_trunc(CASE period WHEN 'semana' THEN 'week' WHEN 'mes' THEN 'month' ELSE 'year' END, starts_on::timestamp)::date)
);
