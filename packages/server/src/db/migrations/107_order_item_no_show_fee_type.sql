-- Allow 'no_show_fee' as an order line item_type so a charged no-show fee is a
-- first-class order line (flows through the existing checkout/journal path and
-- onto Sales/Payments/Revenue reports). The original CHECK was inline in 076
-- with an auto-generated name; drop it defensively and re-add the widened set.

BEGIN;

ALTER TABLE fin_order_items DROP CONSTRAINT IF EXISTS fin_order_items_item_type_check;

ALTER TABLE fin_order_items
  ADD CONSTRAINT fin_order_items_item_type_check
  CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee'));

COMMIT;
