-- Categorías de los gastos operacionales (Gestión financiera → Gastos
-- operacionales): what each running cost of the company is for — Empleado,
-- Gasolina, Oficina, Software… An admin assigns one to each record imputed to a
-- «Gastos operacionales» project, one by one or several at once, and the
-- screen sums the spending per category.
--   * ledens.opex_categories: the list, in the order the screen offers it.
--     Admins add, rename and remove (only one no record uses) categories;
--     every change goes to audit_log.
--   * ledens.opex_record_categories: the category of a ledens.financial_records
--     row. financial_records belongs to the canonical finance model and is
--     never altered: this table only hangs from it. Each change is a
--     finance_events row of the record (`opex_category`).
-- Nothing here changes an amount, a project or a classification.
CREATE TABLE ledens.opex_categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 60),
  position   integer     NOT NULL,
  created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX opex_categories_name_key ON ledens.opex_categories (lower(name));

INSERT INTO ledens.opex_categories (name, position) VALUES
  ('Empleado', 1), ('AI', 2), ('Gasolina', 3), ('Furgoneta', 4), ('Oficina', 5),
  ('Comisión financiera', 6), ('Responsabilidad civil', 7), ('Móvil', 8),
  ('Marketing', 9), ('Fibra', 10), ('Software', 11);

CREATE TABLE ledens.opex_record_categories (
  record_id   uuid        PRIMARY KEY REFERENCES ledens.financial_records (id) ON DELETE CASCADE,
  category_id uuid        NOT NULL REFERENCES ledens.opex_categories (id),
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opex_record_categories_category_idx ON ledens.opex_record_categories (category_id);
