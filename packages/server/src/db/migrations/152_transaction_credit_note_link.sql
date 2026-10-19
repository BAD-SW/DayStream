-- Link a ledger transaction row to its credit note, so an issued credit note
-- appears in the customer's transaction history (spec 10, Adjustment feature).
--
-- A credit note writes a DISPLAY-ONLY pay_transactions row (type 'credit') so it
-- shows up like any other financial event; this column lets the history resolve
-- that row back to the credit note for its label and Print/Email actions. The GL
-- is still posted once by the credit-note service — this row does not re-post.

BEGIN;

ALTER TABLE pay_transactions
  ADD COLUMN IF NOT EXISTS credit_note_id UUID REFERENCES pay_credit_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pay_transactions_credit_note
  ON pay_transactions(credit_note_id) WHERE credit_note_id IS NOT NULL;

COMMIT;
