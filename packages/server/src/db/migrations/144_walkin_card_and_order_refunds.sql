-- Migration 144: walk-in card payments (customerless) + partial/line-item order refunds.
--
-- Two features share this migration because they touch the same tables:
--
-- 1. WALK-IN CARD PAYMENTS. A walk-in has no customer record (GDPR: we don't
--    create a person they never consented to). The card is charged ONCE via a
--    PaymentIntent and never vaulted, and the resulting pay_transactions row has
--    NO customer — so pay_transactions.customer_id must become nullable. The order
--    may carry an optional free-text walk-in name (not a cus_customers row).
--
-- 2. PARTIAL / LINE-ITEM ORDER REFUNDS. A customer can return some items from an
--    order (keep 3 products, return the 4th). We track per-line how much has been
--    refunded so a line can't be over-refunded, and record each refund's line
--    breakdown for audit + the correct per-line GL reversal.
--
-- Money is stored as INTEGER cents throughout.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Walk-in card payment: a customerless charge row + an optional order name.
-- ---------------------------------------------------------------------------

-- A one-time walk-in card charge has no customer. The original 043 constraint was
-- customer_id UUID NOT NULL; relax it. Existing rows all have a customer, so this
-- is a safe widening.
ALTER TABLE pay_transactions ALTER COLUMN customer_id DROP NOT NULL;

-- Optional free-text name the staff can jot for a walk-in ("Jane"). This is NOT a
-- cus_customers record — just a label on the order/receipt. NULL => "Walk-in sale".
ALTER TABLE fin_orders ADD COLUMN IF NOT EXISTS walk_in_name VARCHAR(120);

-- ---------------------------------------------------------------------------
-- 2. Per-line refund tracking on order items.
-- ---------------------------------------------------------------------------

-- How much of each line has already been returned, so repeated partial refunds
-- can't exceed what was sold. refunded_quantity caps at the line quantity;
-- refunded_amount_cents caps at the line's total_price.
ALTER TABLE fin_order_items
  ADD COLUMN IF NOT EXISTS refunded_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0;

-- A richer order status: a partial return leaves the order 'partially_refunded';
-- returning everything makes it 'refunded'. Widen the CHECK (was open/completed/
-- voided/refunded in migration 076).
ALTER TABLE fin_orders DROP CONSTRAINT IF EXISTS fin_orders_status_check;
ALTER TABLE fin_orders
  ADD CONSTRAINT fin_orders_status_check
  CHECK (status IN ('open', 'completed', 'voided', 'refunded', 'partially_refunded'));

-- ---------------------------------------------------------------------------
-- 3. Refund line detail: which order lines (and how much of each) a given refund
--    transaction covered. One refund (a pay_transactions row of type 'refund')
--    can span multiple lines; this records the breakdown for audit and the
--    per-line GL reversal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_order_refund_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  order_id           UUID NOT NULL REFERENCES fin_orders(id) ON DELETE CASCADE,
  order_item_id      UUID NOT NULL REFERENCES fin_order_items(id) ON DELETE CASCADE,
  -- The refund transaction (pay_transactions type='refund') this line belongs to.
  refund_transaction_id UUID REFERENCES pay_transactions(id) ON DELETE SET NULL,
  item_type          VARCHAR(20) NOT NULL,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  -- Net revenue refunded for this line (excl. tax) + the tax refunded, split so
  -- the GL reversal can credit back the right revenue account and 2300 Tax Payable.
  revenue_cents      INTEGER NOT NULL DEFAULT 0,
  tax_cents          INTEGER NOT NULL DEFAULT 0,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),   -- revenue + tax
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_order_refund_lines_order ON pay_order_refund_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_pay_order_refund_lines_item ON pay_order_refund_lines(order_item_id);
CREATE INDEX IF NOT EXISTS idx_pay_order_refund_lines_txn ON pay_order_refund_lines(refund_transaction_id);

COMMIT;
