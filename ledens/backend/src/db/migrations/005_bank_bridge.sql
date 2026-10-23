ALTER TABLE ledens.invoice_ingestions
  ADD COLUMN invoice_currency text,
  ADD COLUMN total_confidence numeric,
  ADD COLUMN number_confidence numeric,
  ADD COLUMN party_confidence numeric,
  ADD COLUMN tax_id_confidence numeric,
  ADD COLUMN direction_confidence numeric;

CREATE TABLE ledens.bridge_cases (
  document_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','matched','dismissed')),
  reason text NOT NULL DEFAULT 'awaiting_evaluation',
  candidates jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1,
  allocation_id uuid,
  resolution_mode text,
  document_fingerprint text,
  bank_fingerprint text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bridge_pending_idx ON ledens.bridge_cases(next_attempt_at) WHERE status='pending';
CREATE TABLE ledens.bridge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  bank_movement_id uuid,
  allocation_id uuid,
  actor_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  request_id uuid UNIQUE,
  request_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bridge_events_document_idx ON ledens.bridge_events(document_id,created_at DESC);

CREATE FUNCTION ledens.queue_document_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ledens.bridge_cases(document_id) VALUES(NEW.id)
  ON CONFLICT(document_id) DO UPDATE SET next_attempt_at=now(),version=ledens.bridge_cases.version+1,updated_at=now()
    WHERE ledens.bridge_cases.status='pending';
  RETURN NEW;
END $$;

-- The guard covers all writers, not just this service. Existing rows are never
-- rewritten by this migration. Confirmed amounts keep the signed ledger model.
CREATE FUNCTION ledens.guard_bridge_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dt numeric; bt numeric; used_doc numeric; used_bank numeric;
BEGIN
  IF NEW.state IS DISTINCT FROM 'Confirmado' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(727032);
  SELECT total INTO dt FROM ledens.documents WHERE id=NEW.document_id FOR UPDATE;
  SELECT total_amount INTO bt FROM ledens.bank_movements WHERE id=NEW.bank_movement_id FOR UPDATE;
  IF dt IS NULL OR bt IS NULL OR dt=0 OR bt=0 OR NEW.allocated_amount=0
      OR sign(NEW.allocated_amount)<>sign(dt) OR sign(NEW.allocated_amount)<>sign(bt)
      OR NEW.allocated_amount<>round(NEW.allocated_amount,2) THEN
    RAISE EXCEPTION 'Allocation sign or amount invalid' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(abs(allocated_amount)),0) INTO used_doc FROM ledens.bank_document_allocations
    WHERE document_id=NEW.document_id AND state='Confirmado' AND id<>NEW.id;
  SELECT COALESCE(sum(abs(allocated_amount)),0) INTO used_bank FROM ledens.bank_document_allocations
    WHERE bank_movement_id=NEW.bank_movement_id AND state='Confirmado' AND id<>NEW.id;
  IF used_doc+abs(NEW.allocated_amount)>abs(dt) OR used_bank+abs(NEW.allocated_amount)>abs(bt) THEN
    RAISE EXCEPTION 'Allocation exceeds available balance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Accounting tables are imported separately; keep auth-only installations usable.
DO $$ BEGIN
  IF to_regclass('ledens.documents') IS NOT NULL THEN
    ALTER TABLE ledens.bridge_cases ADD FOREIGN KEY(document_id) REFERENCES ledens.documents(id);
    CREATE TRIGGER document_bridge_queue AFTER INSERT OR UPDATE OF total,document_on,tipo,numerodocumento,niftercero,tercero
      ON ledens.documents FOR EACH ROW EXECUTE FUNCTION ledens.queue_document_bridge();
  END IF;
  IF to_regclass('ledens.bank_document_allocations') IS NOT NULL THEN
    CREATE TRIGGER bridge_allocation_guard BEFORE INSERT OR UPDATE ON ledens.bank_document_allocations
      FOR EACH ROW EXECUTE FUNCTION ledens.guard_bridge_allocation();
  END IF;
END $$;
