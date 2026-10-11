-- Migration 128: widen pay_transactions.payment_method to the full Section C catalog.
--
-- The ledger's method CHECK (migration 043) predates the processed-method set and
-- only allowed cash/card/bank_transfer/check/gift_card/other. Section C one-time
-- customer payments can settle via the processed pull/wallet methods bank_draw,
-- google_pay, and apple_pay (see payment-catalog.service METHOD_CATALOG and the
-- vault's method_type set in migration 115), so a charge recorded with one of
-- those would otherwise violate the constraint.
--
-- Drop and re-add the CHECK with the complete method set. VARCHAR(30) already fits.

BEGIN;

ALTER TABLE pay_transactions DROP CONSTRAINT IF EXISTS pay_transactions_payment_method_check;

ALTER TABLE pay_transactions
  ADD CONSTRAINT pay_transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'bank_transfer', 'bank_draw', 'check',
    'gift_card', 'google_pay', 'apple_pay', 'other'
  ));

COMMIT;
