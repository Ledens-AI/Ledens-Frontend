-- Cuentas por pagar (Gestión financiera → Cuentas por pagar). What the company
-- owes and has not paid yet: the jornales each worker earns day by day, and any
-- other debt entered by hand (a supplier, a subcontractor, a bonus…), each one
-- optionally imputed to a project. Nothing here counts in profitability or in the
-- accounting tables: it is a forecast of the money that will be needed at the end
-- of the week (workers paid weekly) or of the month (workers paid monthly).
-- ledens.employees belongs to the accounting import and is never altered: the pay
-- frequency and the attendance hang from it in their own tables.

-- One row: the first day jornales are generated for (no backfill of the past).
CREATE TABLE ledens.payables_config (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  jornales_desde date    NOT NULL
);
INSERT INTO ledens.payables_config (jornales_desde) VALUES ((now() AT TIME ZONE 'Europe/Madrid')::date);

-- How each worker is paid. No row = semanal, accrues, from payables_config.
-- `starts_on` is the first day that accrues (a worker added or reactivated later
-- never accrues the days before).
CREATE TABLE ledens.worker_pay_settings (
  employee_id uuid        PRIMARY KEY REFERENCES ledens.employees (id),
  frequency   text        NOT NULL DEFAULT 'semanal' CHECK (frequency IN ('semanal', 'mensual')),
  accrues     boolean     NOT NULL DEFAULT true,
  starts_on   date,
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Exceptions to the default calendar: Monday–Friday are worked, Saturday and
-- Sunday are not. A row says otherwise for one worker and one day (a Saturday
-- worked, an absence, a holiday).
CREATE TABLE ledens.worker_attendance (
  employee_id uuid        NOT NULL REFERENCES ledens.employees (id),
  work_date   date        NOT NULL,
  works       boolean     NOT NULL,
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);

CREATE TABLE ledens.payables (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  origin       text        NOT NULL CHECK (origin IN ('jornal', 'manual')),
  employee_id  uuid        REFERENCES ledens.employees (id),
  work_date    date,
  project_id   uuid        REFERENCES ledens.projects (id),
  concept      text        NOT NULL CHECK (length(concept) BETWEEN 1 AND 300),
  counterparty text        CHECK (length(counterparty) <= 200),
  amount       numeric     NOT NULL CHECK (amount > 0 AND amount = round(amount, 2)),
  due_on       date,
  status       text        NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagada', 'anulada')),
  paid_on      date,
  notes        text        CHECK (length(notes) <= 1000),
  created_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (origin <> 'jornal' OR (employee_id IS NOT NULL AND work_date IS NOT NULL)),
  CHECK (origin = 'jornal' OR work_date IS NULL),
  CHECK ((status = 'pagada') = (paid_on IS NOT NULL))
);
-- One jornal per worker and day, whatever its status: an annulled one is
-- reactivated, never generated twice.
CREATE UNIQUE INDEX payables_jornal_uniq ON ledens.payables (employee_id, work_date) WHERE origin = 'jornal';
CREATE INDEX payables_open_idx ON ledens.payables (due_on) WHERE status = 'pendiente';
