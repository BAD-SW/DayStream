-- Migration 167: make the Account Balances import safe to re-run (spec 50, Requirement 12).
--
-- An imported credit note or invoice records the import row it came from, as a key built from
-- customer + kind + amount + dates + description. Re-importing the same file finds the key and
-- reports the row as already imported instead of creating the balance twice. A credit or invoice
-- created in DayStream by staff has no key, so it is never mistaken for an imported one.

BEGIN;

ALTER TABLE pay_credit_notes ADD COLUMN IF NOT EXISTS import_key VARCHAR(255);
ALTER TABLE pay_invoices ADD COLUMN IF NOT EXISTS import_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_credit_notes_import_key
  ON pay_credit_notes(business_id, import_key) WHERE import_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_invoices_import_key
  ON pay_invoices(business_id, import_key) WHERE import_key IS NOT NULL;

COMMIT;
