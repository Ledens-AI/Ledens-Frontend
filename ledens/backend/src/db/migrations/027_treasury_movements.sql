-- Movimientos de tesorería: bank and cash movements read as one table.
-- A view, not a merged table: ledens.bank_movements belongs to the bank import
-- (Revolut sync) and is the target of foreign keys from documents' Bridge links,
-- material expenses, worker and customer payments; cash_movements is written by
-- the app (016) and keeps the imported FactMovimientosEfectivo rows (015z).
-- Both keep being written where they are; every screen that validates
-- movements reads them through this view.
--   origin     'bank_movements' | 'cash_movements': the table the row lives in.
--   amount     signed like a bank movement: a payment is negative. Cash entered
--              from the app has a positive amount and its kind; an imported cash
--              row (kind NULL) keeps its amount exactly as imported.
--   direction  'pago' | 'cobro' (NULL when it cannot be told: zero amount, or an
--              imported cash row, whose meaning is never inferred).
--   validable  whether the row enters the validation screens: bank movements
--              other than internal transfers, cash with an explicit kind.
--   search_text the texts a screen searches (and the Obramat rule reads).
CREATE VIEW ledens.treasury_movements AS
 SELECT b.id,
  'bank_movements'::text origin,
  b.completed_on occurred_on,
  coalesce(b.beneficiary_name,b.payer) counterparty,
  coalesce(nullif(b.description,''),b.reference) concept,
  b.description,
  b.reference,
  b.source_id,
  b.payer,
  b.beneficiary_name,
  concat_ws(' ',b.beneficiary_name,b.payer,b.description,b.reference) search_text,
  b.total_amount amount,
  b.currency,
  b.state,
  coalesce(b.is_internal_transfer,false) is_internal_transfer,
  CASE WHEN b.total_amount<0 THEN 'pago' WHEN b.total_amount>0 THEN 'cobro' END direction,
  NULL::text cash_kind,
  NULL::text assigned_to,
  NULL::uuid material_id,
  NULL::uuid customer_payment_id,
  NOT coalesce(b.is_internal_transfer,false) validable
 FROM ledens.bank_movements b
 UNION ALL
 SELECT k.id,
  'cash_movements'::text,
  k.occurred_on,
  k.counterparty,
  k.concept,
  k.concept,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  concat_ws(' ',k.counterparty,k.concept),
  CASE k.kind WHEN 'pago' THEN -k.amount WHEN 'cobro' THEN k.amount ELSE k.amount END,
  'EUR'::text,
  NULL::text,
  false,
  k.kind,
  k.kind,
  k.assigned_to,
  k.material_id,
  k.customer_payment_id,
  coalesce(k.kind IN ('pago','cobro'),false)
 FROM ledens.cash_movements k;
