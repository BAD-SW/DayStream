-- A payment taken for an order is linked to it. Until now a sale paid in cash, by transfer or
-- by check left no payment at all (nothing in Payments, nothing to refund), and a sale paid by
-- card or gift card left a payment that knew nothing about the order, so it was booked a
-- second time as money "on account" and gave the customer spendable credit.

ALTER TABLE pay_transactions ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES fin_orders(id);
CREATE INDEX IF NOT EXISTS idx_pay_transactions_order ON pay_transactions(order_id) WHERE order_id IS NOT NULL;
