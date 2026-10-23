-- Test-only stand-in for the production accounting schema (owned by the import
-- tooling, not by this repo's migrations). Column names, types, keys and the two
-- views are copied from production's catalog (information_schema / pg_views,
-- 23 Oct 2026); only columns the finance module reads are kept. No real rows.
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, name text, role text NOT NULL DEFAULT 'client');
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL, actor_label text NOT NULL, action text NOT NULL,
  target_id uuid REFERENCES users (id) ON DELETE SET NULL, target_label text, detail text);

CREATE SCHEMA ledens;
CREATE TABLE ledens.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, display_name text NOT NULL,
  user_id uuid REFERENCES users (id), identity_verified boolean NOT NULL DEFAULT false);
CREATE TABLE ledens.project_statuses (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE ledens.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  project_id text, name text, customer_name_source text, salesman text, address text, start_date date, municipio text,
  provincia text, customer_id uuid REFERENCES ledens.customers (id), status_id uuid REFERENCES ledens.project_statuses (id), end_date date);
CREATE TABLE ledens.bank_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL,
  external_account_id text NOT NULL, name text, currency text NOT NULL, state text, provider_updated_at timestamptz);
CREATE TABLE ledens.bank_movements (id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), source_id text PRIMARY KEY,
  completed_on date, type text, state text, description text, reference text, payer text, amount numeric NOT NULL,
  total_amount numeric NOT NULL, beneficiary_name text, bank_account_id uuid REFERENCES ledens.bank_accounts (id),
  currency text, is_internal_transfer boolean);
CREATE TABLE ledens.documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  documentoid text, registered_on date, trimestre text, tipo text, soporte text, numerodocumento text, document_on date,
  descripcion text, tercero text, niftercero text, base_amount numeric, vat_amount numeric, withholding_amount numeric,
  total numeric, destino text, review_state text, estadopagocobro text, enlacearchivo text, observaciones text,
  tipodocumento text, categoria text, comportamientocoste text);
CREATE TABLE ledens.bank_document_allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  bank_movement_id uuid NOT NULL REFERENCES ledens.bank_movements (id), document_id uuid NOT NULL REFERENCES ledens.documents (id),
  allocated_amount numeric NOT NULL, reconciled_on date, state text, observaciones text, conciliacionid text,
  UNIQUE (bank_movement_id, document_id));
CREATE TABLE ledens.work_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, id_categoria text, name text);
CREATE TABLE ledens.work_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, id_partida text,
  category_id uuid REFERENCES ledens.work_categories (id), categoria text, name text);
CREATE TABLE ledens.employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  empleadoid text, name text, daily_pay numeric, tipo text, activo boolean, user_id uuid REFERENCES users (id));
CREATE TABLE ledens.material_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  bank_movement_id uuid REFERENCES ledens.bank_movements (id), und text, description text, quantity numeric NOT NULL,
  unit_price numeric NOT NULL, total numeric NOT NULL, occurred_on date, project_id uuid REFERENCES ledens.projects (id),
  work_item_id uuid REFERENCES ledens.work_items (id), partida text, document_id uuid REFERENCES ledens.documents (id));
CREATE TABLE ledens.worker_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  bank_movement_id uuid REFERENCES ledens.bank_movements (id), category_id uuid REFERENCES ledens.work_categories (id),
  categoria text, occurred_on date, amount numeric NOT NULL, base_amount numeric, vat_amount numeric, pct_irpf numeric,
  withholding_amount numeric, forma_de_pago text, employee_id uuid REFERENCES ledens.employees (id), empleado text,
  project_id uuid REFERENCES ledens.projects (id), proyecto text, document_id uuid REFERENCES ledens.documents (id));
CREATE TABLE ledens.customer_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE, raw_id uuid UNIQUE,
  occurred_on date, id_pago text, bank_movement_id uuid REFERENCES ledens.bank_movements (id),
  project_id uuid REFERENCES ledens.projects (id), cliente text, total numeric NOT NULL, vat_amount numeric,
  document_id uuid REFERENCES ledens.documents (id));
CREATE TABLE ledens.budgets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES ledens.projects (id),
  source_id text UNIQUE, provenance text NOT NULL DEFAULT 'manual', description text NOT NULL DEFAULT '');
CREATE TABLE ledens.budget_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), budget_id uuid NOT NULL REFERENCES ledens.budgets (id),
  version_number int NOT NULL CHECK (version_number > 0), state text NOT NULL DEFAULT 'draft'
  CHECK (state IN ('draft', 'offered', 'accepted', 'rejected', 'withdrawn')), created_at timestamptz NOT NULL DEFAULT now(), notes text,
  UNIQUE (budget_id, version_number));
CREATE TABLE ledens.budget_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id text UNIQUE,
  project_id uuid NOT NULL REFERENCES ledens.projects (id), work_item_id uuid NOT NULL REFERENCES ledens.work_items (id),
  presupuestoid text, nombre_partida text, categoria text, quantity numeric NOT NULL, unit_price numeric NOT NULL, unidad text,
  total numeric NOT NULL, approval_source text, budget_id uuid NOT NULL REFERENCES ledens.budgets (id),
  version_id uuid REFERENCES ledens.budget_versions (id));

-- Views exactly as defined in production (005_ledens_financial_views).
CREATE VIEW ledens.v_bank_balances AS
 SELECT b.id, b.source_id, b.total_amount,
    COALESCE(sum(a.allocated_amount) FILTER (WHERE (a.state = 'Confirmado'::text)), (0)::numeric) AS confirmed_allocated,
    (b.total_amount - COALESCE(sum(a.allocated_amount) FILTER (WHERE (a.state = 'Confirmado'::text)), (0)::numeric)) AS difference,
    count(a.id) AS document_links
   FROM (ledens.bank_movements b LEFT JOIN ledens.bank_document_allocations a ON ((a.bank_movement_id = b.id)))
  GROUP BY b.id, b.source_id, b.total_amount;
CREATE VIEW ledens.v_document_balances AS
 WITH pairs AS (
   SELECT document_id, bank_movement_id, count(*) AS n, count(*) FILTER (WHERE (state = 'Confirmado'::text)) AS confirmed,
          count(allocated_amount) AS amounts, sum(allocated_amount) AS applied
     FROM ledens.bank_document_allocations GROUP BY document_id, bank_movement_id
 ), balances AS (
   SELECT document_id, sum(CASE WHEN ((n = 1) AND (confirmed = 1) AND (amounts = 1)) THEN applied ELSE (0)::numeric END) AS paid,
          bool_or((NOT ((n = 1) AND (confirmed = 1) AND (amounts = 1)))) AS allocation_issue
     FROM pairs GROUP BY document_id
 )
 SELECT d.id, d.source_id, d.total, COALESCE(b.paid, (0)::numeric) AS paid, (d.total - COALESCE(b.paid, (0)::numeric)) AS balance,
   CASE WHEN (b.document_id IS NULL) THEN 'Sin conciliación'::text ELSE 'Bridge'::text END AS method,
   CASE WHEN (COALESCE(b.allocation_issue, false) OR (d.total IS NULL) OR (d.review_state = 'Incidencia'::text)) THEN 'Incidencia'::text
        WHEN (d.review_state = 'Revisado'::text) THEN 'OK'::text ELSE 'Pendiente'::text END AS quality
   FROM (ledens.documents d LEFT JOIN balances b ON ((b.document_id = d.id)));
