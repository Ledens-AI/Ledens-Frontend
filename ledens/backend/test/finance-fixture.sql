CREATE SCHEMA ledens;
CREATE TABLE public.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,role text);
CREATE TABLE public.audit_log(id bigint GENERATED ALWAYS AS IDENTITY,actor_id uuid REFERENCES users(id),actor_label text,action text,target_id uuid REFERENCES users(id),detail text);
CREATE TABLE ledens.projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id text,name text,address text);
CREATE TABLE ledens.budgets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES ledens.projects(id));
CREATE TABLE ledens.budget_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),budget_id uuid REFERENCES ledens.budgets(id),version_number integer,state text);
CREATE TABLE ledens.budget_approvals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid REFERENCES ledens.budget_versions(id),decision text,decided_at timestamptz DEFAULT now());
CREATE TABLE ledens.budget_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),budget_id uuid REFERENCES ledens.budgets(id),version_id uuid REFERENCES ledens.budget_versions(id),quantity numeric,unit_price numeric,total numeric);
CREATE TABLE ledens.documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),total numeric,tipo text,document_on date,
 numerodocumento text,tercero text,niftercero text,base_amount numeric,vat_amount numeric,review_state text,
 registered_on date,trimestre text,enlacearchivo text,observaciones text,estadopagocobro text);
CREATE TABLE ledens.bank_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id text,amount numeric,total_amount numeric,
 completed_on date,type text,state text,description text,reference text,payer text,beneficiary_name text,currency text,
 bank_fee numeric,bill_amount numeric,bill_currency text,is_internal_transfer boolean);
CREATE TABLE ledens.bank_document_allocations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bank_movement_id uuid REFERENCES ledens.bank_movements(id),
 document_id uuid REFERENCES ledens.documents(id),allocated_amount numeric,state text,reconciled_on date,observaciones text,conciliacionid text,
 UNIQUE(bank_movement_id,document_id));
CREATE TABLE ledens.material_expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid REFERENCES ledens.documents(id),
 bank_movement_id uuid REFERENCES ledens.bank_movements(id),occurred_on date,description text,total numeric,project_id uuid REFERENCES ledens.projects(id));
CREATE TABLE ledens.worker_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid REFERENCES ledens.documents(id),
 bank_movement_id uuid REFERENCES ledens.bank_movements(id),occurred_on date,empleado text,amount numeric,project_id uuid REFERENCES ledens.projects(id));
CREATE TABLE ledens.customer_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid REFERENCES ledens.documents(id),
 bank_movement_id uuid REFERENCES ledens.bank_movements(id),occurred_on date,cliente text,total numeric,project_id uuid REFERENCES ledens.projects(id));
-- Production columns used by Pago a trabajadores (employees, their position, worker_payments.employee_id).
CREATE TABLE ledens.positions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,activo boolean);
CREATE TABLE ledens.employees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,primary_position_id uuid REFERENCES ledens.positions(id),activo boolean);
ALTER TABLE ledens.worker_payments ADD COLUMN employee_id uuid REFERENCES ledens.employees(id);
