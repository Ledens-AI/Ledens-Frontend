-- Re-evaluate verified, unallocated pending documents under the requested rule.
-- No confirmed allocation, manual dismissal or document amount is rewritten.
UPDATE ledens.bridge_cases c SET next_attempt_at=now(),reason='amount_near_date_rule_enabled',version=version+1,updated_at=now()
FROM ledens.invoice_ingestions i WHERE i.document_id=c.document_id AND c.status='pending'
 AND i.status IN ('ready','archived') AND i.invoice_currency='EUR'
 AND ((i.date_confidence>=0.5 AND i.total_confidence>=0.5 AND i.direction_confidence>=0.5) OR to_jsonb(i)->'purchase_proof' IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=c.document_id);
