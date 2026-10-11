-- Migration 130: widen fin_orders.payment_method to the full Section C catalog.
--
-- Checkout orders (migration 076) constrained payment_method to a small legacy set
-- ('cash','card','transfer','other'). Section C lets a business take an order
-- payment by any accepted method — card, the manual-record methods (cash, check,
-- bank_transfer, other), gift card, direct debit (bank_draw), or a wallet. An
-- order completed with e.g. 'check' was being rejected by this CHECK (400/500).
--
-- Align the constraint with pay_transactions (migration 128) and the method
-- catalog. 'transfer' is retained for backward-compatibility with any existing
-- rows while 'bank_transfer' (the catalog's canonical manual-push name) is added.

BEGIN;

ALTER TABLE fin_orders DROP CONSTRAINT IF EXISTS fin_orders_payment_method_check;
-- The constraint may carry its pre-rename name on older databases; drop that too.
ALTER TABLE fin_orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE fin_orders
  ADD CONSTRAINT fin_orders_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'bank_draw', 'bank_transfer', 'transfer', 'check',
    'gift_card', 'google_pay', 'apple_pay', 'other'
  ));

COMMIT;
