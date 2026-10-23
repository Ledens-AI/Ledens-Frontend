-- Incremental project accounting. Existing signed ledger and Bridge remain authoritative.
CREATE TABLE ledens.invoice_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES ledens.documents(id),
 line_number integer NOT NULL CHECK(line_number>0), description text, quantity numeric,
 net_amount numeric, vat_amount numeric, gross_amount numeric, currency text,
 extraction_confidence numeric, evidence jsonb NOT NULL DEFAULT '{}',
 UNIQUE(document_id,line_number)
);
CREATE TABLE ledens.financial_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 material_id uuid UNIQUE REFERENCES ledens.material_expenses(id),
 worker_payment_id uuid UNIQUE REFERENCES ledens.worker_payments(id),
 customer_payment_id uuid UNIQUE REFERENCES ledens.customer_payments(id),
 invoice_line_id uuid UNIQUE REFERENCES ledens.invoice_lines(id),
 CHECK(num_nonnulls(material_id,worker_payment_id,customer_payment_id,invoice_line_id)=1),
 document_id uuid REFERENCES ledens.documents(id), bank_movement_id uuid REFERENCES ledens.bank_movements(id),
 occurred_on date, description text, counterparty text,
 category text NOT NULL DEFAULT 'unclassified' CHECK(category IN
 ('materials','labor','subcontract','other_direct','revenue','advance','overhead','unclassified')),
 gross_amount numeric NOT NULL CHECK(gross_amount<>0 AND gross_amount=round(gross_amount,2)),
 net_amount numeric, vat_amount numeric, nondeductible_vat numeric, withholding_amount numeric,
 currency text CHECK(currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','excluded')),
 source_valid boolean NOT NULL DEFAULT true,
 recognized_on date, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'approved' OR (source_valid AND currency='EUR' AND net_amount IS NOT NULL AND vat_amount IS NOT NULL
   AND nondeductible_vat IS NOT NULL AND withholding_amount IS NOT NULL
   AND gross_amount=net_amount+vat_amount-withholding_amount
   AND abs(nondeductible_vat)<=abs(vat_amount)
   AND (nondeductible_vat=0 OR sign(nondeductible_vat)=sign(vat_amount))
   AND category<>'unclassified' AND (category='advance' OR recognized_on IS NOT NULL)))
);
CREATE TABLE ledens.project_financial_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES ledens.financial_records(id),
 project_id uuid NOT NULL REFERENCES ledens.projects(id), allocated_amount numeric NOT NULL
 CHECK(allocated_amount<>0 AND allocated_amount=round(allocated_amount,2)),
 created_by uuid REFERENCES public.users(id), updated_by uuid REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,project_id)
);
CREATE TABLE ledens.finance_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, record_id uuid NOT NULL REFERENCES ledens.financial_records(id),
 actor_id uuid REFERENCES public.users(id), action text NOT NULL, reason text NOT NULL,
 before_value jsonb NOT NULL, after_value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledens.finance_requests (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES public.users(id), payload_hash text NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledens.finance_budget_basis (
 version_id uuid PRIMARY KEY REFERENCES ledens.budget_versions(id),
 amount_basis text NOT NULL CHECK(amount_basis='net'), lines_hash text NOT NULL,
 reviewed_by uuid NOT NULL REFERENCES public.users(id), reviewed_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL
);
CREATE TABLE ledens.finance_project_permissions (
 user_id uuid NOT NULL REFERENCES public.users(id), project_id uuid REFERENCES ledens.projects(id),
 can_review_unassigned boolean NOT NULL DEFAULT false, can_write boolean NOT NULL DEFAULT false,
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 UNIQUE NULLS NOT DISTINCT(user_id,project_id)
);
CREATE INDEX finance_records_queue_idx ON ledens.financial_records(status,occurred_on,id);
CREATE INDEX finance_records_document_idx ON ledens.financial_records(document_id);
CREATE INDEX project_allocations_project_idx ON ledens.project_financial_allocations(project_id,record_id);
CREATE INDEX finance_events_record_idx ON ledens.finance_events(record_id,id);
CREATE INDEX IF NOT EXISTS material_project_idx ON ledens.material_expenses(project_id);
CREATE INDEX IF NOT EXISTS worker_payment_project_idx ON ledens.worker_payments(project_id);
CREATE INDEX IF NOT EXISTS customer_payment_project_idx ON ledens.customer_payments(project_id);

-- Legacy signs: costs negative, client receipts positive. Never infer tax eligibility.
INSERT INTO ledens.financial_records(material_id,document_id,bank_movement_id,occurred_on,description,category,gross_amount)
 SELECT id,document_id,bank_movement_id,occurred_on,description,'materials',-total
 FROM ledens.material_expenses WHERE total IS NOT NULL AND total<>0 AND total=round(total,2);
INSERT INTO ledens.financial_records(worker_payment_id,document_id,bank_movement_id,occurred_on,counterparty,category,gross_amount)
 SELECT id,document_id,bank_movement_id,occurred_on,empleado,'labor',-amount
 FROM ledens.worker_payments WHERE amount<>0 AND amount=round(amount,2);
INSERT INTO ledens.financial_records(customer_payment_id,document_id,bank_movement_id,occurred_on,counterparty,category,gross_amount)
 SELECT id,document_id,bank_movement_id,occurred_on,cliente,'advance',total
 FROM ledens.customer_payments WHERE total<>0 AND total=round(total,2);
INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount)
 SELECT r.id,coalesce(m.project_id,w.project_id,c.project_id),r.gross_amount
 FROM ledens.financial_records r LEFT JOIN ledens.material_expenses m ON m.id=r.material_id
 LEFT JOIN ledens.worker_payments w ON w.id=r.worker_payment_id LEFT JOIN ledens.customer_payments c ON c.id=r.customer_payment_id
 WHERE coalesce(m.project_id,w.project_id,c.project_id) IS NOT NULL;

CREATE FUNCTION ledens.guard_project_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capacity numeric; used numeric;
BEGIN
 SELECT gross_amount INTO capacity FROM ledens.financial_records WHERE id=NEW.record_id FOR UPDATE;
 SELECT coalesce(sum(abs(allocated_amount)),0) INTO used FROM ledens.project_financial_allocations
 WHERE record_id=NEW.record_id AND id<>NEW.id;
 IF sign(NEW.allocated_amount)<>sign(capacity) OR used+abs(NEW.allocated_amount)>abs(capacity) THEN
 RAISE EXCEPTION 'project_allocation_exceeds_source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_allocation_capacity BEFORE INSERT OR UPDATE ON ledens.project_financial_allocations
 FOR EACH ROW EXECUTE FUNCTION ledens.guard_project_allocation();

-- A single, complete allocation projects into the legacy Project_ID. All splits remain NULL.
CREATE FUNCTION ledens.sync_legacy_project() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r ledens.financial_records; p uuid;
BEGIN
 SELECT * INTO r FROM ledens.financial_records WHERE id=coalesce(NEW.record_id,OLD.record_id);
 SELECT project_id INTO p FROM ledens.project_financial_allocations
 WHERE record_id=r.id AND allocated_amount=r.gross_amount;
 PERFORM set_config('ledens.finance_sync','on',true);
 IF r.material_id IS NOT NULL THEN UPDATE ledens.material_expenses SET project_id=p WHERE id=r.material_id; END IF;
 IF r.worker_payment_id IS NOT NULL THEN UPDATE ledens.worker_payments SET project_id=p WHERE id=r.worker_payment_id; END IF;
 IF r.customer_payment_id IS NOT NULL THEN UPDATE ledens.customer_payments SET project_id=p WHERE id=r.customer_payment_id; END IF;
 PERFORM set_config('ledens.finance_sync','off',true);
 RETURN NULL;
END $$;
CREATE TRIGGER sync_project AFTER INSERT OR UPDATE OR DELETE ON ledens.project_financial_allocations
 FOR EACH ROW EXECUTE FUNCTION ledens.sync_legacy_project();

CREATE VIEW ledens.v_project_recognized AS
 SELECT a.project_id,r.id record_id,r.category,r.recognized_on,r.occurred_on,r.document_id,
 a.allocated_amount, a.allocated_amount/r.gross_amount share,
 (r.net_amount+r.nondeductible_vat)*a.allocated_amount/r.gross_amount economic_amount
 FROM ledens.project_financial_allocations a JOIN ledens.financial_records r ON r.id=a.record_id
 WHERE r.status='approved' AND r.currency='EUR';

-- Refresh source changes without retaining a stale approved accounting value.
CREATE FUNCTION ledens.sync_financial_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r ledens.financial_records; amount numeric; source_column text; category_value text;
BEGIN
 IF current_setting('ledens.finance_sync',true)='on' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='material_expenses' THEN source_column:='material_id';amount:=-NEW.total;category_value:='materials';
 ELSIF TG_TABLE_NAME='worker_payments' THEN source_column:='worker_payment_id';amount:=-NEW.amount;category_value:='labor';
 ELSE source_column:='customer_payment_id';amount:=NEW.total;category_value:='advance'; END IF;
 PERFORM pg_advisory_xact_lock(727032);
 EXECUTE format('SELECT * FROM ledens.financial_records WHERE %I=$1 FOR UPDATE',source_column) INTO r USING NEW.id;
 IF amount IS NULL OR amount=0 OR amount<>round(amount,2) THEN
   IF r.id IS NOT NULL THEN
     INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value)
       VALUES(r.id,'source_invalidated','Source amount requires correction',to_jsonb(r),to_jsonb(NEW));
     DELETE FROM ledens.project_financial_allocations WHERE record_id=r.id;
     UPDATE ledens.financial_records SET status='pending',source_valid=false,version=version+1,updated_at=now() WHERE id=r.id;
   END IF;
   RETURN NEW;
 END IF;
 IF r.id IS NULL THEN
   EXECUTE format('INSERT INTO ledens.financial_records(%I,document_id,bank_movement_id,occurred_on,category,gross_amount,description,counterparty) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',source_column)
   INTO r USING NEW.id,NEW.document_id,NEW.bank_movement_id,NEW.occurred_on,category_value,amount,to_jsonb(NEW)->>'description',coalesce(to_jsonb(NEW)->>'empleado',to_jsonb(NEW)->>'cliente');
   IF NEW.project_id IS NOT NULL THEN INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES(r.id,NEW.project_id,amount); END IF;
 ELSE
   IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
   INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value)
   VALUES(r.id,'source_changed','External source updated; review required',to_jsonb(r),to_jsonb(NEW));
   DELETE FROM ledens.project_financial_allocations WHERE record_id=r.id;
   UPDATE ledens.financial_records SET gross_amount=amount,document_id=NEW.document_id,bank_movement_id=NEW.bank_movement_id,
    occurred_on=NEW.occurred_on,status='pending',source_valid=true,version=version+1,updated_at=now() WHERE id=r.id;
   IF NEW.project_id IS NOT NULL THEN INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES(r.id,NEW.project_id,amount); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER material_finance_sync AFTER INSERT OR UPDATE ON ledens.material_expenses FOR EACH ROW EXECUTE FUNCTION ledens.sync_financial_source();
CREATE TRIGGER worker_finance_sync AFTER INSERT OR UPDATE ON ledens.worker_payments FOR EACH ROW EXECUTE FUNCTION ledens.sync_financial_source();
CREATE TRIGGER customer_finance_sync AFTER INSERT OR UPDATE ON ledens.customer_payments FOR EACH ROW EXECUTE FUNCTION ledens.sync_financial_source();

CREATE FUNCTION ledens.invalidate_document_finance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value)
 SELECT id,'document_changed','Source document changed; accounting review required',to_jsonb(OLD),to_jsonb(NEW)
 FROM ledens.financial_records WHERE document_id=NEW.id AND status='approved';
 UPDATE ledens.financial_records SET status='pending',version=version+1,updated_at=now() WHERE document_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER document_finance_invalidation AFTER UPDATE OF total,base_amount,vat_amount,tipo,document_on ON ledens.documents
 FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ledens.invalidate_document_finance();
