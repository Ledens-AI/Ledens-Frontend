-- Pago de materiales provisional (026) covering several invoices. «Concepto de
-- movimientos» now classifies a payment as Pago de materiales whatever its
-- reconciled documents still lack: the missing concepts are reported when the
-- record is assigned to an obra. 026 replaced the provisional payment as soon as
-- the first reconciled document had records, so with several invoices the cost of
-- the others was lost. The provisional now waits until every reconciled document
-- of the movement has its records; then all of them inherit its class and obra.
-- Same function as 026 otherwise (026 itself is never edited).
CREATE OR REPLACE FUNCTION ledens.replace_provisional_materials(movement uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record; r ledens.financial_records; d ledens.financial_records; doc uuid; proj uuid; proj_name text;
BEGIN
 FOR p IN SELECT * FROM ledens.provisional_material_payments WHERE bank_movement_id=movement FOR UPDATE LOOP
  IF p.replaced_at IS NULL THEN
   -- Only a reconciled document that already has its records replaces it.
   SELECT a.document_id INTO doc FROM ledens.bank_document_allocations a
    WHERE a.bank_movement_id=movement AND a.state='Confirmado'
      AND EXISTS(SELECT 1 FROM ledens.financial_records f WHERE f.document_id=a.document_id AND f.source_valid AND f.status<>'excluded')
    ORDER BY a.reconciled_on NULLS LAST,a.id LIMIT 1;
   -- 029: only once every reconciled document of the movement has its records,
   -- so a payment covering several invoices is never replaced by the first one.
   IF doc IS NOT NULL AND EXISTS(SELECT 1 FROM ledens.bank_document_allocations a2
     WHERE a2.bank_movement_id=movement AND a2.state='Confirmado'
       AND NOT EXISTS(SELECT 1 FROM ledens.financial_records f2 WHERE f2.document_id=a2.document_id AND f2.source_valid AND f2.status<>'excluded')) THEN
    doc:=NULL;
   END IF;
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
