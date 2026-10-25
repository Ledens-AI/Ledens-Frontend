ALTER TABLE ledens.invoice_sources ADD COLUMN content_hash text;
ALTER TABLE ledens.invoice_ingestions ADD COLUMN purchase_proof jsonb;
CREATE TABLE ledens.purchase_documents(
 document_id uuid PRIMARY KEY REFERENCES ledens.documents(id),kind text NOT NULL CHECK(kind IN ('advance','delivery','advance_refund')),
 issuer_tax_id text NOT NULL,buyer_tax_id text NOT NULL,document_number text NOT NULL,order_reference text NOT NULL,currency text NOT NULL CHECK(currency='EUR'),
 issued_on date NOT NULL,nominal_gross numeric NOT NULL,goods_gross numeric NOT NULL DEFAULT 0,goods_net numeric NOT NULL DEFAULT 0,goods_vat numeric NOT NULL DEFAULT 0,
 applied_gross numeric NOT NULL DEFAULT 0,fingerprint text NOT NULL,evidence jsonb NOT NULL,
 UNIQUE(issuer_tax_id,buyer_tax_id,document_number),
 CHECK(nominal_gross=round(nominal_gross,2) AND goods_gross=round(goods_gross,2) AND applied_gross=round(applied_gross,2)),
 CHECK((kind='advance' AND nominal_gross>0 AND goods_gross=0 AND applied_gross=0) OR
 (kind='delivery' AND nominal_gross=0 AND goods_gross>0 AND goods_net+goods_vat=goods_gross AND applied_gross=goods_gross) OR
 (kind='advance_refund' AND nominal_gross<0 AND goods_gross=0 AND applied_gross=0))
);
CREATE INDEX purchase_documents_family_idx ON ledens.purchase_documents(issuer_tax_id,buyer_tax_id,order_reference,currency);
CREATE TABLE ledens.purchase_settlements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),advance_document_id uuid NOT NULL REFERENCES ledens.purchase_documents(document_id),
 related_document_id uuid NOT NULL UNIQUE REFERENCES ledens.purchase_documents(document_id),kind text NOT NULL CHECK(kind IN ('application','refund')),
 gross_amount numeric NOT NULL CHECK(gross_amount>0 AND gross_amount=round(gross_amount,2)),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(advance_document_id,related_document_id),CHECK(advance_document_id<>related_document_id)
);
CREATE TABLE ledens.purchase_settlement_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,document_id uuid NOT NULL REFERENCES ledens.documents(id),
 action text NOT NULL,actor_id uuid REFERENCES public.users(id),detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION ledens.guard_purchase_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ledens.purchase_documents;r ledens.purchase_documents;used numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(727032);
 SELECT * INTO a FROM ledens.purchase_documents WHERE document_id=NEW.advance_document_id FOR UPDATE;
 SELECT * INTO r FROM ledens.purchase_documents WHERE document_id=NEW.related_document_id FOR UPDATE;
 IF a.kind<>'advance' OR (NEW.kind='application' AND r.kind<>'delivery') OR (NEW.kind='refund' AND r.kind<>'advance_refund')
 OR (a.issuer_tax_id,a.buyer_tax_id,a.order_reference,a.currency) IS DISTINCT FROM (r.issuer_tax_id,r.buyer_tax_id,r.order_reference,r.currency)
 OR abs(a.issued_on-r.issued_on)>365 OR NEW.gross_amount<>(CASE WHEN r.kind='delivery' THEN r.applied_gross ELSE -r.nominal_gross END) THEN
 RAISE EXCEPTION 'Invalid purchase settlement' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(gross_amount),0) INTO used FROM ledens.purchase_settlements WHERE advance_document_id=a.document_id AND id<>NEW.id;
 IF used+NEW.gross_amount>a.nominal_gross THEN RAISE EXCEPTION 'Advance exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_settlement_guard BEFORE INSERT OR UPDATE ON ledens.purchase_settlements FOR EACH ROW EXECUTE FUNCTION ledens.guard_purchase_settlement();
CREATE FUNCTION ledens.immutable_purchase_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'Purchase source correction requires explicit review' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_document_guard BEFORE UPDATE ON ledens.purchase_documents FOR EACH ROW EXECUTE FUNCTION ledens.immutable_purchase_document();
CREATE VIEW ledens.v_document_economic_capacity AS
 SELECT d.id document_id,CASE WHEN p.kind='delivery' THEN CASE WHEN d.total=0 AND d.document_on=p.issued_on AND d.numerodocumento=p.document_number THEN p.goods_gross ELSE 0 END WHEN p.kind IN ('advance','advance_refund') THEN 0 ELSE abs(d.total) END capacity
 FROM ledens.documents d LEFT JOIN ledens.purchase_documents p ON p.document_id=d.id;
CREATE VIEW ledens.v_document_funding AS
 SELECT d.id document_id,b.bank_movement_id,b.allocated_amount,abs(d.total) capacity,d.id origin_document_id,'bank'::text funding_kind
 FROM ledens.documents d JOIN ledens.bank_document_allocations b ON b.document_id=d.id AND b.state='Confirmado'
 JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED' AND m.currency='EUR'
 WHERE d.total<>0
 UNION ALL
 SELECT target.document_id,b.bank_movement_id,b.allocated_amount*s.gross_amount/a.nominal_gross,target.goods_gross,a.document_id,'advance'
 FROM ledens.purchase_settlements s JOIN ledens.purchase_documents a ON a.document_id=s.advance_document_id
 JOIN ledens.purchase_documents target ON target.document_id=s.related_document_id AND target.kind='delivery'
 JOIN ledens.bank_document_allocations b ON b.document_id=a.document_id AND b.state='Confirmado'
 JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED' AND m.currency='EUR'
 WHERE s.kind='application';
CREATE VIEW ledens.v_purchase_coverage AS
 SELECT p.document_id,p.goods_gross,coalesce((SELECT sum(s.gross_amount) FROM ledens.purchase_settlements s JOIN ledens.purchase_documents a ON a.document_id=s.advance_document_id WHERE s.related_document_id=p.document_id AND s.kind='application' AND coalesce((SELECT sum(abs(b.allocated_amount)) FROM ledens.bank_document_allocations b JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED' AND m.currency='EUR' WHERE b.document_id=a.document_id AND b.state='Confirmado'),0)>=a.nominal_gross),0) paid FROM ledens.purchase_documents p WHERE kind='delivery';
CREATE FUNCTION ledens.queue_purchase_deliveries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE ledens.bridge_cases SET next_attempt_at=now(),status='pending',reason='advance_funding_changed',version=version+1,updated_at=now()
 WHERE document_id IN(SELECT related_document_id FROM ledens.purchase_settlements WHERE advance_document_id=NEW.document_id AND kind='application')
 AND (status='pending' OR resolution_mode='document_settlement');
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_funding_changed AFTER INSERT OR UPDATE ON ledens.bank_document_allocations FOR EACH ROW EXECUTE FUNCTION ledens.queue_purchase_deliveries();
