-- Migration 133: finalize-state tracking for asynchronous customer charges.
--
-- Bank-draw (SEPA/ACH/Bacs) customer charges confirm at Stripe as `processing`
-- and settle days later. The charge row is written `pending` and, until now,
-- NOTHING ever moved it to `completed` (or `failed`) when the debit cleared —
-- so settled bank draws never posted to the GL, couldn't be refunded, and were
-- excluded from revenue totals.
--
-- This adds the finalize timestamp (mirrors pay_platform_billing_charges.settled_at
-- from migration 118) and an index the reconciliation poller uses to find rows
-- that still need checking against the provider.

BEGIN;

-- When an async charge was finalized to its terminal state (completed/failed).
-- NULL while still pending. Set by the payment-finalization service.
ALTER TABLE pay_transactions
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- The reconciliation poller sweeps processed charges still 'pending' that carry a
-- provider reference to look up. Partial index keeps that sweep cheap.
CREATE INDEX IF NOT EXISTS idx_pay_transactions_pending_processed
  ON pay_transactions(created_at)
  WHERE status = 'pending' AND is_processed = true AND provider_reference IS NOT NULL;

COMMIT;
