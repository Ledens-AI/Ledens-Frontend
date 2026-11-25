-- CIF del cliente de un proyecto (Gestión financiera → Proyectos). The CIF, NIF
-- or NIE of whoever the project is for, typed in the project's form: the client
-- is often not a registered ledens.customers row, only a name in
-- customer_name_source, so the CIF belongs to the project. «Generar factura»
-- (src/facturas/service.js) takes it from here and nowhere else.
-- ledens.projects belongs to the accounting import and is never altered: this
-- table only hangs from it. `tax_id` is stored normalized (upper case, no spaces,
-- dots, dashes or slashes) and checked like an invoice's (src/facturas/nif.js).
CREATE TABLE ledens.project_customer_tax_ids (
  project_id uuid        PRIMARY KEY REFERENCES ledens.projects (id) ON DELETE CASCADE,
  tax_id     text        NOT NULL CHECK (tax_id ~ '^[A-Z0-9]{5,20}$'),
  updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The CIF/NIF already used in an invoice of the project (proyecto_facturacion,
-- migration 049, checked when the invoice was issued) becomes the project's, so
-- nobody has to type it again.
INSERT INTO ledens.project_customer_tax_ids (project_id, tax_id, updated_by, updated_at)
SELECT f.project_id, upper(regexp_replace(f.nif, '[\s./-]', '', 'g')), f.updated_by, f.updated_at
  FROM proyecto_facturacion f
 WHERE EXISTS (SELECT 1 FROM ledens.projects p WHERE p.id = f.project_id)
   AND upper(regexp_replace(f.nif, '[\s./-]', '', 'g')) ~ '^[A-Z0-9]{5,20}$'
ON CONFLICT (project_id) DO NOTHING;
