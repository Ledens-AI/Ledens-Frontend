ALTER TABLE ledens.invoice_ingestions ADD COLUMN IF NOT EXISTS party_evidence jsonb NOT NULL DEFAULT '{}';
-- Reconsider existing ingested invoices under the newly authorized global rule.
-- Manual/dismissed cases and documents with existing Bridge allocations are preserved.
INSERT INTO ledens.bridge_events(document_id,action,detail)
 SELECT c.document_id,'matching_rule_updated',jsonb_build_object('rule','party-amount-date-v2','previous_reason',c.reason)
 FROM ledens.bridge_cases c JOIN ledens.invoice_ingestions i ON i.document_id=c.document_id
 WHERE c.status='pending' AND i.status IN ('ready','archived') AND i.invoice_currency='EUR'
 AND i.date_confidence>=0.5 AND i.total_confidence>=0.5 AND i.direction_confidence>=0.5
 AND NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=c.document_id);
UPDATE ledens.bridge_cases c SET next_attempt_at=now(),version=version+1,updated_at=now()
 FROM ledens.invoice_ingestions i WHERE i.document_id=c.document_id AND c.status='pending'
 AND i.status IN ('ready','archived') AND i.invoice_currency='EUR'
 AND i.date_confidence>=0.5 AND i.total_confidence>=0.5 AND i.direction_confidence>=0.5
 AND NOT EXISTS(SELECT 1 FROM ledens.bank_document_allocations a WHERE a.document_id=c.document_id);
