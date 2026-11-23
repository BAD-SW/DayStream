-- Spec 51, gap 14 (design 14.1): tips. A tip is charged with the sale but is not a sale: it is
-- held as money owed to staff (2700 Tips Payable) until it is handed over (cash) or paid in
-- payroll (electronic tips).
BEGIN;

ALTER TABLE fin_orders
  ADD COLUMN IF NOT EXISTS tip_amount INTEGER NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  ADD COLUMN IF NOT EXISTS tip_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_refunded_cents >= 0),
  -- a split set by hand before payment: [{ "user_id": ..., "amount_cents": ... }]
  ADD COLUMN IF NOT EXISTS tip_split JSONB;

-- Each staff member's share of a paid tip.
CREATE TABLE IF NOT EXISTS fin_tip_shares (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  business_id    UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  order_id       UUID NOT NULL REFERENCES fin_orders(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES usr_users(id),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  -- handed over or paid in payroll so far; what is owed is amount - refunded - paid (below zero when a
  -- tip was refunded after it was paid: the next pay run takes it off)
  paid_cents     INTEGER NOT NULL DEFAULT 0,
  -- card, direct debit, wallet or gift card: paid through payroll; else handed over at the time
  electronic     BOOLEAN NOT NULL,
  status         VARCHAR(12) NOT NULL CHECK (status IN ('owed', 'handed_over', 'paid')),
  pay_period_id  UUID REFERENCES fin_pay_periods(id) ON DELETE SET NULL,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_fin_tip_shares_user ON fin_tip_shares (business_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fin_tip_shares_period ON fin_tip_shares (pay_period_id) WHERE pay_period_id IS NOT NULL;

ALTER TABLE fin_tip_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_tip_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fin_tip_shares ON fin_tip_shares FOR ALL TO daystream_app
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY admin_full_access_fin_tip_shares ON fin_tip_shares FOR ALL TO CURRENT_USER USING (true);
GRANT SELECT, INSERT, UPDATE ON fin_tip_shares TO daystream_app;

-- Settings (a business value overrides the default).
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
  ('tips.enabled', 'billing', 'boolean', 'false', 'Tips: customers may add a tip at Checkout'),
  ('tips.percentages', 'billing', 'json', '[10,15,20]', 'Tips: the three suggested percentages'),
  ('tips.on_manual', 'billing', 'boolean', 'true', 'Tips: a tip may be added to cash and other manual payments (false: card payments only)'),
  ('tips.split', 'billing', 'string', 'value', 'Tips: shared between the staff on the order by the value of their services (value) or evenly (even)')
ON CONFLICT (key) DO NOTHING;

-- 2700 Tips Payable for every business with a chart of accounts, and for new businesses.
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '2700', 'Tips Payable', 'liability', true
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '1000', 'Assets', 'asset', true),
        (p_business_id, '1100', 'Cash & Bank', 'asset', true),
        (p_business_id, '1200', 'Accounts Receivable', 'asset', true),
        (p_business_id, '1300', 'Inventory', 'asset', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '2000', 'Liabilities', 'liability', true),
        (p_business_id, '2100', 'Accounts Payable', 'liability', true),
        (p_business_id, '2200', 'Payroll Payable', 'liability', true),
        (p_business_id, '2300', 'Tax Payable', 'liability', true),
        (p_business_id, '2400', 'Deferred Revenue', 'liability', true),
        (p_business_id, '2500', 'Customer Deposits', 'liability', true),
        (p_business_id, '2600', 'Gift Card Liability', 'liability', true),
        (p_business_id, '2700', 'Tips Payable', 'liability', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '3000', 'Equity', 'equity', true),
        (p_business_id, '3900', 'Opening Balance Equity', 'equity', true)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '4000', 'Revenue', 'revenue', true),
        (p_business_id, '4100', 'Service Revenue', 'revenue', true),
        (p_business_id, '4200', 'Membership Revenue', 'revenue', true),
        (p_business_id, '4300', 'Product Revenue', 'revenue', false),
        (p_business_id, '4400', 'Gift Card Revenue', 'revenue', false),
        (p_business_id, '4500', 'Package Revenue', 'revenue', false),
        (p_business_id, '4600', 'No-Show Fee Revenue', 'revenue', false),
        (p_business_id, '4700', 'Event Revenue', 'revenue', false),
        (p_business_id, '4900', 'Discounts & Adjustments', 'revenue', false)
    ON CONFLICT (business_id, code) DO NOTHING;

    INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
        (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true),
        (p_business_id, '5100', 'Inventory Adjustments', 'expense', true)
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
