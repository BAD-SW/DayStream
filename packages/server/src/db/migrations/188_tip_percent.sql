-- Spec 51, gap 14 (owner, 23 Nov 2026): a tip picked as a suggested percentage follows the order.
-- The percentage is kept so the tip is worked out again whenever the order's lines change before
-- payment; NULL means the tip was typed as an amount.
BEGIN;
ALTER TABLE fin_orders
  ADD COLUMN IF NOT EXISTS tip_percent NUMERIC(5,2) CHECK (tip_percent IS NULL OR (tip_percent >= 0 AND tip_percent <= 100));
COMMIT;
