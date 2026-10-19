-- Credit notes — the "credit" side of an Adjustment (spec 10, Requirement C4/C5
-- extended). A credit note reverses revenue and grants the customer drawable
-- account credit, with NO cash movement (the cash-free analogue of an invoice).
--
-- Model: an adjustment document is an invoice (debit — charge the customer) OR a
-- credit note (credit — reverse revenue, grant credit). They share the same
-- line-item shape so each line maps to the correct revenue account. A credit note
-- posts its GL entry at ISSUANCE (unlike an invoice, which posts when paid):
--   Debit  <per-line revenue account(s)>   (reduce revenue)
--   Debit  2300 Tax Payable                 (reverse collected tax)
--   Credit 2500 Customer Deposits            (new drawable liability)
-- and records a pay_account_credits row so the credit flows through the existing
-- apply-to-invoice machinery unchanged. Revenue is only ever recognised once:
-- here it is reduced; when the credit is later applied, it is re-recognised.
--
-- Conventions mirror pay_invoices (migrations 127/132): tenant_id + business_id,
-- gapless per-business number, INTEGER cents, item_type for revenue mapping.

BEGIN;

CREATE TABLE IF NOT EXISTS pay_credit_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id        UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id        UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  credit_note_number BIGINT NOT NULL,                    -- sequential per business, no gaps
  issue_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  currency           VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  tax_cents          INTEGER NOT NULL DEFAULT 0,
  total_cents        INTEGER NOT NULL DEFAULT 0,
  -- The reason is required at the service layer (audit + document). 'issued' is the
  -- only live state today; 'void' reserved for a future reversal path.
  reason             TEXT NOT NULL,
  status             VARCHAR(12) NOT NULL DEFAULT 'issued'
                       CHECK (status IN ('issued', 'void')),
  -- The drawable account-credit row this note created (for traceability).
  account_credit_id  UUID REFERENCES pay_account_credits(id) ON DELETE SET NULL,
  created_by         UUID REFERENCES usr_users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, credit_note_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_credit_notes_business ON pay_credit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_credit_notes_tenant ON pay_credit_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_credit_notes_customer ON pay_credit_notes(customer_id);

-- Per-business sequential credit-note numbers (no gaps), mirroring the invoice seq.
CREATE TABLE IF NOT EXISTS pay_credit_note_number_seq (
  business_id UUID PRIMARY KEY REFERENCES sys_businesses(id) ON DELETE CASCADE,
  next_number BIGINT NOT NULL DEFAULT 1000
);

CREATE TABLE IF NOT EXISTS pay_credit_note_line_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID NOT NULL REFERENCES pay_credit_notes(id) ON DELETE CASCADE,
  description    VARCHAR(200) NOT NULL,
  -- Drives which revenue account this line's credit reverses (service/product/
  -- membership/package/no_show_fee), same classification as invoice lines.
  item_type      VARCHAR(20) NOT NULL DEFAULT 'service'
                   CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee')),
  quantity       NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_credit_note_line_items_note
  ON pay_credit_note_line_items(credit_note_id);

COMMIT;
