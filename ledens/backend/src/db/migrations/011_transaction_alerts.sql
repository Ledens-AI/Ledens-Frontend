CREATE TABLE ledens.transaction_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE,
 event_type text NOT NULL, status text NOT NULL, reason text, document_id uuid,
 payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,lease_token uuid,lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text
);
CREATE INDEX transaction_alerts_pending_idx ON ledens.transaction_alerts(next_attempt_at,created_at) WHERE delivered_at IS NULL;
CREATE FUNCTION ledens.queue_transaction_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc uuid; kind text; state text; why text; data jsonb; signature text;
BEGIN
 IF TG_TABLE_NAME='invoice_ingestions' THEN
  IF NEW.status='analyzing' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.reason IS NOT DISTINCT FROM OLD.reason THEN RETURN NEW; END IF;
  doc:=NEW.document_id;kind:='ingestion';state:=NEW.status;why:=NEW.reason;
  data:=jsonb_build_object('ingestion_id',NEW.id,'filename',NEW.filename,'invoice_date',NEW.invoice_date,'destination_folder',NEW.destination_folder);
  signature:=NEW.id::text||':'||state||':'||coalesce(why,'');
 ELSIF TG_TABLE_NAME='invoice_sources' THEN
  IF NOT NEW.is_duplicate THEN RETURN NEW; END IF;
  SELECT document_id INTO doc FROM ledens.invoice_ingestions WHERE id=NEW.ingestion_id;
  kind:='ingestion';state:='duplicate';why:='duplicate_content';
  data:=jsonb_build_object('ingestion_id',NEW.ingestion_id,'filename',NEW.filename,'source_item_id',NEW.source_item_id);
  signature:='duplicate:'||NEW.source_key;
 ELSIF TG_TABLE_NAME='bridge_cases' THEN
  IF NEW.status='matched' OR NEW.checked_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.reason IS NOT DISTINCT FROM OLD.reason THEN RETURN NEW; END IF;
  -- Historical imports are not new processing attempts and must not create a mail flood.
  IF NOT EXISTS(SELECT 1 FROM ledens.invoice_ingestions WHERE document_id=NEW.document_id) THEN RETURN NEW; END IF;
  doc:=NEW.document_id;kind:='bridge';state:=NEW.status;why:=NEW.reason;
  data:=jsonb_build_object('version',NEW.version,'candidate_count',jsonb_array_length(NEW.candidates));
  signature:=doc::text||':'||state||':'||coalesce(why,'');
 ELSIF TG_TABLE_NAME='bank_document_allocations' THEN
  IF TG_OP='UPDATE' AND (NEW.state,NEW.allocated_amount,NEW.bank_movement_id,NEW.document_id) IS NOT DISTINCT FROM (OLD.state,OLD.allocated_amount,OLD.bank_movement_id,OLD.document_id) THEN RETURN NEW; END IF;
  doc:=NEW.document_id;kind:='allocation';state:=coalesce(NEW.state,'revision');why:='bridge_allocation_changed';
  data:=jsonb_build_object('allocation_id',NEW.id,'bank_movement_id',NEW.bank_movement_id,'allocated_amount',NEW.allocated_amount,'state',NEW.state);
  signature:=NEW.id::text||':'||md5(data::text);
 ELSE
  IF NEW.action NOT IN ('replace_allocations','recognition','review_flag') THEN RETURN NEW; END IF;
  SELECT document_id INTO doc FROM ledens.financial_records WHERE id=NEW.record_id;
  kind:='project_finance';state:=NEW.action;why:=NEW.reason;
  data:=jsonb_build_object('record_id',NEW.record_id,'actor_id',NEW.actor_id,'before',NEW.before_value,'after',NEW.after_value);
  signature:=NEW.id::text;
 END IF;
 data:=data||jsonb_build_object('document', (SELECT jsonb_build_object('number',d.numerodocumento,'date',d.document_on,'counterparty',d.tercero,'gross',d.total,'net',d.base_amount,'vat',d.vat_amount) FROM ledens.documents d WHERE d.id=doc));
 INSERT INTO ledens.transaction_alerts(event_key,event_type,status,reason,document_id,payload)
 VALUES(kind||':'||signature||CASE WHEN TG_TABLE_NAME='invoice_sources' THEN '' ELSE ':'||txid_current()::text END,kind,state,why,doc,data) ON CONFLICT(event_key) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER transaction_alert_ingestion AFTER INSERT OR UPDATE ON ledens.invoice_ingestions FOR EACH ROW EXECUTE FUNCTION ledens.queue_transaction_alert();
CREATE TRIGGER transaction_alert_duplicate AFTER INSERT ON ledens.invoice_sources FOR EACH ROW EXECUTE FUNCTION ledens.queue_transaction_alert();
CREATE TRIGGER transaction_alert_bridge AFTER INSERT OR UPDATE ON ledens.bridge_cases FOR EACH ROW EXECUTE FUNCTION ledens.queue_transaction_alert();
CREATE TRIGGER transaction_alert_allocation AFTER INSERT OR UPDATE ON ledens.bank_document_allocations FOR EACH ROW EXECUTE FUNCTION ledens.queue_transaction_alert();
CREATE TRIGGER transaction_alert_finance AFTER INSERT ON ledens.finance_events FOR EACH ROW EXECUTE FUNCTION ledens.queue_transaction_alert();
-- Include recent invoices already awaiting review when notifications are first deployed.
INSERT INTO ledens.transaction_alerts(event_key,event_type,status,reason,document_id,payload)
 SELECT 'ingestion:'||id::text||':'||status||':'||coalesce(reason,''),'ingestion',status,reason,document_id,
 jsonb_build_object('ingestion_id',id,'filename',filename,'invoice_date',invoice_date,'destination_folder',destination_folder)
 FROM ledens.invoice_ingestions WHERE created_at>now()-interval '1 day' AND status IN ('ready','review','archived') ON CONFLICT DO NOTHING;
