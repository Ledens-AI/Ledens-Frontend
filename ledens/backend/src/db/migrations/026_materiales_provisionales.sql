-- Pago de materiales provisional («Concepto de movimientos»). A bank payment with
-- no invoice classified as materials becomes a ledens.material_expenses row tied
-- to the movement, so it counts in profitability right away. It only stands in
-- for the invoice: once the Bridge confirms a document for that movement and the
-- document has its records, the provisional record is excluded (never deleted)
-- and the document's records take its place, so the cost is never counted twice.
-- The replacement inherits what the person decided for the provisional one:
--   * its class: unclassified records of the document become 'materials';
--   * its obra: when it was allocated whole to one project, records of the
--     document without a project are allocated to it.
-- Everything is audited in finance_events. It runs from deferred triggers, so it
-- covers every way a link is confirmed (automatic or manual Bridge, imports) and
-- invoice lines that arrive after the reconciliation.
CREATE TABLE ledens.provisional_material_payments (
  material_id             uuid        PRIMARY KEY REFERENCES ledens.material_expenses (id),
  bank_movement_id        uuid        NOT NULL REFERENCES ledens.bank_movements (id),
  created_by              uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  replaced_at             timestamptz,
  replaced_by_document_id uuid        REFERENCES ledens.documents (id),
  carried_project_id      uuid        REFERENCES ledens.projects (id)
);
CREATE INDEX provisional_material_open_idx ON ledens.provisional_material_payments (bank_movement_id) WHERE replaced_at IS NULL;

CREATE FUNCTION ledens.replace_provisional_materials(movement uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record; r ledens.financial_records; d ledens.financial_records; doc uuid; proj uuid; proj_name text;
BEGIN
 FOR p IN SELECT * FROM ledens.provisional_material_payments WHERE bank_movement_id=movement FOR UPDATE LOOP
  IF p.replaced_at IS NULL THEN
   -- Only a reconciled document that already has its records replaces it.
   SELECT a.document_id INTO doc FROM ledens.bank_document_allocations a
    WHERE a.bank_movement_id=movement AND a.state='Confirmado'
      AND EXISTS(SELECT 1 FROM ledens.financial_records f WHERE f.document_id=a.document_id AND f.source_valid AND f.status<>'excluded')
    ORDER BY a.reconciled_on NULLS LAST,a.id LIMIT 1;
   IF doc IS NULL THEN CONTINUE; END IF;
   proj:=NULL;
   SELECT * INTO r FROM ledens.financial_records WHERE material_id=p.material_id FOR UPDATE;
   IF r.id IS NOT NULL AND r.status<>'excluded' THEN
    SELECT a.project_id INTO proj FROM ledens.project_financial_allocations a WHERE a.record_id=r.id AND a.allocated_amount=r.gross_amount;
    DELETE FROM ledens.project_financial_allocations WHERE record_id=r.id;
    UPDATE ledens.financial_records SET status='excluded',source_valid=false,version=version+1,updated_at=now() WHERE id=r.id;
    INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value)
     VALUES(r.id,'provisional_replaced','Pago de materiales provisional sustituido por la factura conciliada en el Bridge',
      to_jsonb(r),jsonb_build_object('document_id',doc,'project_id',proj));
   END IF;
   UPDATE ledens.provisional_material_payments SET replaced_at=now(),replaced_by_document_id=doc,carried_project_id=proj WHERE material_id=p.material_id;
  ELSE
   proj:=p.carried_project_id;
  END IF;
  SELECT name INTO proj_name FROM ledens.projects WHERE id=proj;
  -- The invoice's records (also lines registered later) inherit the class and the obra.
  FOR d IN SELECT f.* FROM ledens.financial_records f JOIN ledens.bank_document_allocations a
    ON a.document_id=f.document_id AND a.bank_movement_id=movement AND a.state='Confirmado'
    WHERE f.source_valid AND f.status<>'excluded' ORDER BY f.id FOR UPDATE OF f LOOP
   IF d.category='unclassified' THEN
    UPDATE ledens.financial_records SET category='materials',version=version+1,updated_at=now() WHERE id=d.id;
    INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value)
     SELECT d.id,'reclassified','Clasificación heredada del pago de materiales provisional',to_jsonb(d),to_jsonb(x) FROM ledens.financial_records x WHERE x.id=d.id;
   END IF;
   IF proj IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ledens.project_financial_allocations x WHERE x.record_id=d.id) THEN
    INSERT INTO ledens.project_financial_allocations(record_id,project_id,allocated_amount) VALUES(d.id,proj,d.gross_amount);
    UPDATE ledens.financial_records SET version=version+1,updated_at=now() WHERE id=d.id;
    INSERT INTO ledens.finance_events(record_id,action,reason,before_value,after_value)
     VALUES(d.id,'replace_allocations','Obra heredada del pago de materiales provisional',jsonb_build_object('allocations','[]'::jsonb),
      jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('project_id',proj,'project_name',proj_name,'allocated_amount',d.gross_amount))));
   END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION ledens.provisional_on_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Only when a link becomes confirmed (or moves to another document), so a person's
 -- later change of class or obra on the invoice is never overridden.
 IF TG_OP='UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state AND OLD.document_id IS NOT DISTINCT FROM NEW.document_id THEN RETURN NULL; END IF;
 IF NEW.state='Confirmado' AND EXISTS(SELECT 1 FROM ledens.provisional_material_payments WHERE bank_movement_id=NEW.bank_movement_id)
 THEN PERFORM ledens.replace_provisional_materials(NEW.bank_movement_id); END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER provisional_material_on_allocation AFTER INSERT OR UPDATE ON ledens.bank_document_allocations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledens.provisional_on_allocation();

-- Invoice lines registered after the reconciliation (only new records: a later
-- change of class or obra made by a person is never overridden).
CREATE FUNCTION ledens.provisional_on_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m uuid;
BEGIN
 IF NEW.document_id IS NULL OR NOT NEW.source_valid OR NEW.status='excluded' THEN RETURN NULL; END IF;
 FOR m IN SELECT DISTINCT a.bank_movement_id FROM ledens.bank_document_allocations a
   JOIN ledens.provisional_material_payments p ON p.bank_movement_id=a.bank_movement_id
   WHERE a.document_id=NEW.document_id AND a.state='Confirmado' LOOP
  PERFORM ledens.replace_provisional_materials(m);
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER provisional_material_on_record AFTER INSERT ON ledens.financial_records
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledens.provisional_on_record();
