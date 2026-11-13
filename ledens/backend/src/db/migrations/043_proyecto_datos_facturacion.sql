-- Datos de facturación de un proyecto: who the invoices of the work are made out
-- to (titular), their CIF/NIF/NIE (or a foreign tax id) and fiscal address. One
-- row per ledens.projects row, required when a project is created from
-- Gestión financiera → Proyectos and fillable later for the projects that
-- already exist. ledens.projects belongs to the accounting import and is never
-- altered: this table only hangs from it. The address is the titular's, which
-- may differ from the address of the obra (ledens.projects.address).
CREATE TABLE ledens.project_billing (
  project_id  uuid        PRIMARY KEY REFERENCES ledens.projects (id) ON DELETE CASCADE,
  holder_name text        NOT NULL CHECK (btrim(holder_name) <> '' AND length(holder_name) <= 200),
  tax_id      text        NOT NULL CHECK (tax_id ~ '^[A-Z0-9]{2,20}$'),
  address     text        NOT NULL CHECK (btrim(address) <> '' AND length(address) <= 200),
  postal_code text        NOT NULL CHECK (btrim(postal_code) <> '' AND length(postal_code) <= 20),
  municipio   text        NOT NULL CHECK (btrim(municipio) <> '' AND length(municipio) <= 200),
  provincia   text        NOT NULL CHECK (btrim(provincia) <> '' AND length(provincia) <= 200),
  country     text        NOT NULL DEFAULT 'España' CHECK (btrim(country) <> '' AND length(country) <= 100),
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
