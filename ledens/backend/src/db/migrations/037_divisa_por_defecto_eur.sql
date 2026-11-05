-- A bank movement with no currency and no account (rows of the
-- FactMovimientosBancarios Excel, the company's euro ledger: the Revolut sync
-- always brings both) is EUR. 036 left it unreconcilable («El banco no informó
-- la divisa del movimiento ni de qué cuenta es»). Same views as 036, same
-- columns; only the last fallback of the currency changes. A movement or account
-- that states another currency keeps it. Same expression as bankCurrency() in
-- src/bridge/rules.js. The imported rows are not touched.
CREATE OR REPLACE VIEW ledens.v_document_funding AS
 SELECT d.id document_id,b.bank_movement_id,b.allocated_amount,abs(d.total) capacity,d.id origin_document_id,'bank'::text funding_kind
 FROM ledens.documents d JOIN ledens.bank_document_allocations b ON b.document_id=d.id AND b.state='Confirmado'
 JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED'
  AND coalesce(m.currency,(SELECT ba.currency FROM ledens.bank_accounts ba WHERE ba.id=m.bank_account_id),'EUR')='EUR'
 WHERE d.total<>0
 UNION ALL
 SELECT target.document_id,b.bank_movement_id,b.allocated_amount*s.gross_amount/a.nominal_gross,target.goods_gross,a.document_id,'advance'
 FROM ledens.purchase_settlements s JOIN ledens.purchase_documents a ON a.document_id=s.advance_document_id
 JOIN ledens.purchase_documents target ON target.document_id=s.related_document_id AND target.kind='delivery'
 JOIN ledens.bank_document_allocations b ON b.document_id=a.document_id AND b.state='Confirmado'
 JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED'
  AND coalesce(m.currency,(SELECT ba.currency FROM ledens.bank_accounts ba WHERE ba.id=m.bank_account_id),'EUR')='EUR'
 WHERE s.kind='application';
CREATE OR REPLACE VIEW ledens.v_purchase_coverage AS
 SELECT p.document_id,p.goods_gross,coalesce((SELECT sum(s.gross_amount) FROM ledens.purchase_settlements s JOIN ledens.purchase_documents a ON a.document_id=s.advance_document_id
  WHERE s.related_document_id=p.document_id AND s.kind='application' AND coalesce((SELECT sum(abs(b.allocated_amount)) FROM ledens.bank_document_allocations b
   JOIN ledens.bank_movements m ON m.id=b.bank_movement_id AND m.state='COMPLETED'
    AND coalesce(m.currency,(SELECT ba.currency FROM ledens.bank_accounts ba WHERE ba.id=m.bank_account_id),'EUR')='EUR'
   WHERE b.document_id=a.document_id AND b.state='Confirmado'),0)>=a.nominal_gross),0) paid
 FROM ledens.purchase_documents p WHERE kind='delivery';
