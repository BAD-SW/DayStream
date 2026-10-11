-- Migration 131: Customer account credit / unapplied payments.
--
-- Problem this fixes: a customer payment with NO linkage to earned work (no
-- booking, no membership enrollment, no invoice) is money received but not yet
-- earned. Section C was crediting it to 4100 Service Revenue, which overstates
-- revenue. Correct treatment: it is a LIABILITY (the business owes the customer
-- goods/services or a refund) until it is applied to something earned.
--
-- This migration adds:
--   1. A chart-of-accounts liability account `2500 Customer Deposits` so the
--      journal can credit it instead of revenue.
--   2. `pay_account_credits` — a per-customer ledger of unapplied credit, with a
--      running remaining balance. A bare payment creates a row here; applying the
--      credit to an invoice draws it down (liability -> revenue at that point).
--
-- Money is stored as INTEGER cents throughout.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Customer Deposits liability account (2500) for existing businesses that
--    already have a chart of accounts, and in the seed function for new ones.
-- ---------------------------------------------------------------------------
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '2500', 'Customer Deposits', 'liability', true
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Customer account-credit ledger.
--
-- Each row is an unapplied (or partly-applied) credit held for a customer at a
-- business. `remaining_cents` is the live, drawable balance; a customer's total
-- available credit is SUM(remaining_cents) over rows WHERE status = 'available'.
--
-- Scope follows the pay_transactions shape (business-scoped; business_id resolves
-- the tenant) but we also carry tenant_id explicitly to match the brand-new
-- Section C tables and keep tenant filtering cheap.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_account_credits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES sys_tenants(id) ON DELETE CASCADE,
  business_id      UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES cus_customers(id) ON DELETE CASCADE,
  -- The payment that funded this credit (the bare "payment on account").
  source_transaction_id UUID REFERENCES pay_transactions(id) ON DELETE SET NULL,
  currency         VARCHAR(3) NOT NULL DEFAULT 'USD',
  original_cents   INTEGER NOT NULL CHECK (original_cents > 0),
  remaining_cents  INTEGER NOT NULL CHECK (remaining_cents >= 0),
  status           VARCHAR(12) NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available', 'applied', 'refunded')),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_account_credits_customer
  ON pay_account_credits(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_pay_account_credits_available
  ON pay_account_credits(business_id, customer_id) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_pay_account_credits_source
  ON pay_account_credits(source_transaction_id) WHERE source_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Applications of account credit against invoices — an audit trail of how a
--    credit was drawn down. One credit can be split across invoices; one invoice
--    can be settled from several credits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pay_account_credit_applications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id        UUID NOT NULL REFERENCES pay_account_credits(id) ON DELETE CASCADE,
  invoice_id       UUID REFERENCES pay_invoices(id) ON DELETE SET NULL,
  transaction_id   UUID REFERENCES pay_transactions(id) ON DELETE SET NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  applied_by       UUID REFERENCES usr_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_credit_apps_credit ON pay_account_credit_applications(credit_id);
CREATE INDEX IF NOT EXISTS idx_pay_credit_apps_invoice ON pay_account_credit_applications(invoice_id);

-- ---------------------------------------------------------------------------
-- 3b. Applying account credit records a non-processed ledger row with the
--     synthetic method 'account_credit'. Widen the method CHECK to allow it
--     (prior set from migration 128).
-- ---------------------------------------------------------------------------
ALTER TABLE pay_transactions DROP CONSTRAINT IF EXISTS pay_transactions_payment_method_check;

ALTER TABLE pay_transactions
  ADD CONSTRAINT pay_transactions_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'bank_transfer', 'bank_draw', 'check',
    'gift_card', 'google_pay', 'apple_pay', 'account_credit', 'other'
  ));

-- ---------------------------------------------------------------------------
-- 3c. Register the 'invoicing.enabled' config definition.
--     setInvoicingEnabled (invoice.service.ts) writes this key into
--     sys_business_configurations, which has a FK to
--     sys_configuration_definitions(key). The key was never registered, so the
--     Invoicing toggle fails with a FK violation. Register it here. Default off.
-- ---------------------------------------------------------------------------
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('invoicing.enabled', 'billing', 'boolean', 'false', 'Whether this business issues payable invoices to customers')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Add 2500 Customer Deposits to the seed function so NEW businesses get it.
--    (Body mirrors migration 080's definition, with the 2500 account added to
--    the liabilities block.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '1000', 'Assets', 'asset', true),
        (p_business_id, '1100', 'Cash & Bank', 'asset', true),
        (p_business_id, '1200', 'Accounts Receivable', 'asset', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '2000', 'Liabilities', 'liability', true),
        (p_business_id, '2100', 'Accounts Payable', 'liability', true),
        (p_business_id, '2200', 'Payroll Payable', 'liability', true),
        (p_business_id, '2300', 'Tax Payable', 'liability', true),
        (p_business_id, '2400', 'Deferred Revenue', 'liability', true),
        (p_business_id, '2500', 'Customer Deposits', 'liability', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '4000', 'Revenue', 'revenue', true),
        (p_business_id, '4100', 'Service Revenue', 'revenue', true),
        (p_business_id, '4200', 'Membership Revenue', 'revenue', true),
        (p_business_id, '4300', 'Product Revenue', 'revenue', false),
        (p_business_id, '4400', 'Gift Card Revenue', 'revenue', false),
        (p_business_id, '4500', 'Package Revenue', 'revenue', false),
        (p_business_id, '4900', 'Discounts & Adjustments', 'revenue', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '6000', 'Operating Expenses', 'expense', true),
        (p_business_id, '6100', 'Rent & Occupancy', 'expense', false),
        (p_business_id, '6200', 'Utilities', 'expense', false),
        (p_business_id, '6300', 'Insurance', 'expense', false),
        (p_business_id, '6400', 'Marketing & Advertising', 'expense', false),
        (p_business_id, '6500', 'Supplies & Consumables', 'expense', false),
        (p_business_id, '6600', 'Equipment & Maintenance', 'expense', false),
        (p_business_id, '6700', 'Software & Technology', 'expense', false),
        (p_business_id, '6800', 'Professional Services', 'expense', false),
        (p_business_id, '6900', 'Other Operating Expenses', 'expense', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '7000', 'Payroll Expenses', 'expense', true),
        (p_business_id, '7100', 'Wages & Salaries', 'expense', true),
        (p_business_id, '7200', 'Commissions', 'expense', false),
        (p_business_id, '7300', 'Contractor Payments', 'expense', false),
        (p_business_id, '7400', 'Payroll Taxes (Employer)', 'expense', false),
        (p_business_id, '7500', 'Benefits & Insurance (Employer)', 'expense', false)
    ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMIT;
