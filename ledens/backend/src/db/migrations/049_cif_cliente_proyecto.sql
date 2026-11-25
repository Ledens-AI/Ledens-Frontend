-- CIF del cliente de un proyecto (Gestión financiera → Proyectos). The CIF, NIF
-- or NIE of whoever the project is for, typed in the project's form: the client
-- is often not a registered ledens.customers row, only a name in
-- customer_name_source, so the CIF belongs to the project.
-- ledens.projects belongs to the accounting import and is never altered: this
-- table only hangs from it. `tax_id` is stored normalized (upper case, no spaces,
-- dots or dashes); a Spanish one is checked with its control character, a
-- foreign one carries its country prefix (src/finanzas/projects.js, cleanTaxId).
CREATE TABLE ledens.project_customer_tax_ids (
  project_id uuid        PRIMARY KEY REFERENCES ledens.projects (id) ON DELETE CASCADE,
  tax_id     text        NOT NULL CHECK (tax_id ~ '^[A-Z0-9]{4,20}$'),
  updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
