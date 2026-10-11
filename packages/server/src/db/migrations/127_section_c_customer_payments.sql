-- Migration 127: Section C — Customer → Business Payments (spec 10-payment-platform, Phase 4, task 4.1).
--
-- Businesses collect directly from customers into their own connected accounts.
-- This migration lays the schema foundation for the rest of Section C:
--   - Extends the existing customer payment ledger (pay_transactions) with the
--     processed-method + linkage columns the charge/refund/invoice flows need.
--   - Links a membership enrollment to the stored payment method it charges.
--   - Adds dunning, invoicing, gift-card, and voucher tables.
--
-- Reused as-is (NOT recreated here): pay_payment_methods (vault, migration 115),
-- mbr_enrollments / mbr_plans (membership, 052+), pay_accepted_methods (045).
--
-- Isolation: application-level (see db/pool.ts), matching the rest of the payment
-- platform (migrations 115–122). No Postgres RLS blocks. Tenant/business scope is
-- carried as columns and enforced by the query layer. Note: pay_transactions and
-- mbr_enrollments are business-scoped and have NO tenant_id column (business_id
-- resolves the tenant), so the new ledger-extension columns follow that table's
-- existing shape; the brand-new tables carry tenant_id + business_id explicitly.
--
-- Money is stored as INTEGER cents throughout.

BEGIN;

-- ---------------------------------------------------------------------------
-- Invoices (optional per business) — created BEFORE the pay_transactions ALTER
-- because pay_transactions.invoice_id references pay_invoices(id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  invoice_number  BIGINT NOT NULL,                      -- sequential per business, no gaps
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE NOT NULL,
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(12) NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void')),
  notes           TEXT,
  pdf_path        TEXT,
  created_by      UUID REFERENCES usr_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_pay_invoices_business ON pay_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoices_tenant ON pay_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoices_customer ON pay_invoices(customer_id);
-- Open invoices for the overdue sweep / "to pay" lists.
CREATE INDEX IF NOT EXISTS idx_pay_invoices_open
  ON pay_invoices(due_date) WHERE status IN ('issued', 'overdue');

-- Per-business sequential invoice numbers (no gaps). One counter row per business;
-- the invoicing service increments it transactionally when issuing an invoice.
CREATE TABLE IF NOT EXISTS pay_invoice_number_seq (
  business_id UUID PRIMARY KEY REFERENCES sys_businesses(id) ON DELETE CASCADE,
  next_number BIGINT NOT NULL DEFAULT 1000
);

CREATE TABLE IF NOT EXISTS pay_invoice_line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES pay_invoices(id) ON DELETE CASCADE,
  description VARCHAR(200) NOT NULL,
  quantity    NUMERIC(8,2) NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_invoice_line_items_invoice ON pay_invoice_line_items(invoice_id);

-- ---------------------------------------------------------------------------
-- Dunning — tracks failed enrollment renewal charges and the retry schedule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_dunning_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id    UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  enrollment_id  UUID NOT NULL REFERENCES mbr_enrollments(id) ON DELETE CASCADE,
  attempt_number SMALLINT NOT NULL,
  scheduled_for  DATE NOT NULL,
  attempted_at   TIMESTAMPTZ,
  outcome        VARCHAR(12) NOT NULL DEFAULT 'pending'
                   CHECK (outcome IN ('settled', 'failed', 'pending')),
  transaction_id UUID REFERENCES pay_transactions(id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_dunning_enrollment ON pay_dunning_attempts(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_pay_dunning_business ON pay_dunning_attempts(business_id);
-- The dunning run picks up pending attempts due today.
CREATE INDEX IF NOT EXISTS idx_pay_dunning_due
  ON pay_dunning_attempts(scheduled_for) WHERE outcome = 'pending';

-- ---------------------------------------------------------------------------
-- Gift cards — business-scoped stored value, redeemable only at the issuing
-- business. Partial redemption decrements balance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_gift_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  code            VARCHAR(32) NOT NULL UNIQUE,
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  initial_amount_cents INTEGER NOT NULL,
  balance_cents   INTEGER NOT NULL,
  recipient_email VARCHAR(255),
  recipient_name  VARCHAR(200),
  purchaser_customer_id UUID REFERENCES cus_customers(id) ON DELETE SET NULL,
  expires_at      DATE,
  status          VARCHAR(12) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'depleted', 'expired', 'void')),
  created_by      UUID REFERENCES usr_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_gift_cards_business ON pay_gift_cards(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_gift_cards_tenant ON pay_gift_cards(tenant_id);

-- ---------------------------------------------------------------------------
-- Vouchers — business-scoped discount codes (Pricing Engine applies them).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_vouchers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id    UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  code           VARCHAR(32) NOT NULL UNIQUE,
  discount_type  VARCHAR(12) NOT NULL CHECK (discount_type IN ('free', 'fixed', 'percentage')),
  discount_value INTEGER,                               -- cents (fixed) or basis points (percentage)
  applies_to     JSONB,                                 -- service/category ids; NULL = everything
  single_use     BOOLEAN NOT NULL DEFAULT true,
  max_redemptions INTEGER,                              -- NULL = unlimited (ignored when single_use)
  redemption_count INTEGER NOT NULL DEFAULT 0,
  expires_at     DATE,
  status         VARCHAR(12) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'expired', 'void')),
  created_by     UUID REFERENCES usr_users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_vouchers_business ON pay_vouchers(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_vouchers_tenant ON pay_vouchers(tenant_id);

-- ---------------------------------------------------------------------------
-- Extend the existing customer payment ledger (migrations 043/044). These
-- columns distinguish real processed charges from manually-recorded ones and
-- link a transaction to its vault method, recurring enrollment, or invoice.
-- ---------------------------------------------------------------------------
ALTER TABLE pay_transactions
  ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_processed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES pay_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES mbr_enrollments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES pay_invoices(id) ON DELETE SET NULL;

-- Processed charges carry a provider reference; index it for reconciliation/lookup.
CREATE INDEX IF NOT EXISTS idx_pay_transactions_provider_reference
  ON pay_transactions(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_transactions_enrollment
  ON pay_transactions(enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_transactions_invoice
  ON pay_transactions(invoice_id) WHERE invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Link an enrollment to the stored method its recurring charge draws from.
-- ---------------------------------------------------------------------------
ALTER TABLE mbr_enrollments
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES pay_payment_methods(id) ON DELETE SET NULL;

COMMIT;
