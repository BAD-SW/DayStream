-- Debit notes — the "debit" side of an Adjustment (spec 10, Adjustment feature).
--
-- Transaction model (user's canonical framing): there are four financial
-- transaction types — Charge, Payment, Credit, Debit. A debit is a credit with
-- the opposite sign. A debit note is therefore the exact mirror of a credit note:
-- it posts the SAME per-line revenue split with debit/credit SWAPPED and moves the
-- customer's drawable account balance DOWN (can go negative — a debit is just a
-- credit with the sign flipped, so there is no zero-floor):
--   Debit  2500 Customer Deposits            (draw the account down)
--   Credit <per-line revenue account(s)>     (re-recognise revenue)
--   Credit 2300 Tax Payable                  (re-apply tax)
-- and records a pay_account_credits row with a NEGATIVE amount so the net balance
-- sums down through the existing balance machinery unchanged.
--
-- Conventions mirror pay_credit_notes (migration 151): tenant_id + business_id,
-- gapless per-business number, INTEGER cents, item_type for revenue mapping.

BEGIN;

-- 0. Allow pay_account_credits rows to hold a NEGATIVE balance. A debit note is a
--    credit with the opposite sign, so it records a negative drawable bucket; the
--    customer's available balance is SUM(remaining_cents) over 'available' rows and
--    may net below zero (an owing position). The original positive-only checks
--    (migration 131) encoded "credit is a positive bucket" — relax them so the
--    mirror (a debit) is representable with the same machinery.
ALTER TABLE pay_account_credits DROP CONSTRAINT IF EXISTS pay_account_credits_original_cents_check;
ALTER TABLE pay_account_credits DROP CONSTRAINT IF EXISTS pay_account_credits_remaining_cents_check;
-- original_cents is non-zero (a bucket has a direction: + credit, - debit).
ALTER TABLE pay_account_credits
  ADD CONSTRAINT pay_account_credits_original_cents_check CHECK (original_cents <> 0);

-- 1. Extend pay_transactions.type to allow 'debit' (it was charge/refund/credit).
--    The TYPE column then reads "debit" for a debit-note ledger row, mirroring
--    how a credit note reads "credit".
ALTER TABLE pay_transactions DROP CONSTRAINT IF EXISTS pay_transactions_type_check;
ALTER TABLE pay_transactions
  ADD CONSTRAINT pay_transactions_type_check
  CHECK (type IN ('charge', 'refund', 'credit', 'debit'));

-- 1b. Add the 'account_debit' payment method — the mirror of 'account_credit'
--     (from migration 131). A debit-note ledger row uses it, just as a credit-note
--     row uses 'account_credit'. Full catalog repeated so the constraint is correct
--     on a fresh install regardless of prior migration order.
ALTER TABLE pay_transactions DROP CONSTRAINT IF EXISTS pay_transactions_payment_method_check;
ALTER TABLE pay_transactions
  ADD CONSTRAINT pay_transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'bank_transfer', 'bank_draw', 'check',
    'gift_card', 'google_pay', 'apple_pay', 'account_credit', 'account_debit', 'other'
  ));

-- 2. Debit-note document tables (mirror of pay_credit_notes).
CREATE TABLE IF NOT EXISTS pay_debit_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id        UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id        UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  debit_note_number  BIGINT NOT NULL,                    -- sequential per business, no gaps
  issue_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  currency           VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  tax_cents          INTEGER NOT NULL DEFAULT 0,
  total_cents        INTEGER NOT NULL DEFAULT 0,
  reason             TEXT NOT NULL,
  status             VARCHAR(12) NOT NULL DEFAULT 'issued'
                       CHECK (status IN ('issued', 'void')),
  -- The drawable account-credit row this note created (NEGATIVE amount), for traceability.
  account_credit_id  UUID REFERENCES pay_account_credits(id) ON DELETE SET NULL,
  created_by         UUID REFERENCES usr_users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, debit_note_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_debit_notes_business ON pay_debit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_debit_notes_tenant ON pay_debit_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_debit_notes_customer ON pay_debit_notes(customer_id);

-- Per-business sequential debit-note numbers (no gaps), mirroring the credit-note seq.
CREATE TABLE IF NOT EXISTS pay_debit_note_number_seq (
  business_id UUID PRIMARY KEY REFERENCES sys_businesses(id) ON DELETE CASCADE,
  next_number BIGINT NOT NULL DEFAULT 1000
);

CREATE TABLE IF NOT EXISTS pay_debit_note_line_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debit_note_id  UUID NOT NULL REFERENCES pay_debit_notes(id) ON DELETE CASCADE,
  description    VARCHAR(200) NOT NULL,
  item_type      VARCHAR(20) NOT NULL DEFAULT 'service'
                   CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee')),
  quantity       NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_debit_note_line_items_note
  ON pay_debit_note_line_items(debit_note_id);

-- 3. Link a display-only ledger transaction row (type 'debit') to its debit note,
--    so the debit note shows in the customer's transaction history and the row
--    resolves back for its label + Print/Email (mirror of credit_note_id).
ALTER TABLE pay_transactions
  ADD COLUMN IF NOT EXISTS debit_note_id UUID REFERENCES pay_debit_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pay_transactions_debit_note
  ON pay_transactions(debit_note_id) WHERE debit_note_id IS NOT NULL;

COMMIT;
