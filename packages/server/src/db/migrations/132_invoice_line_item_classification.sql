-- Migration 132: classify invoice line items for correct revenue recognition.
--
-- Invoicing (Section C) stored only description/quantity/price/amount per line, so
-- paying an invoice (settle or applying account credit) had no way to know WHICH
-- revenue account each line earns. The books were crediting everything to 4100
-- Service Revenue, which is wrong for product/membership/package/no-show lines.
--
-- This migration gives each invoice line the same classification the POS order
-- path already uses (fin_order_items.item_type), so invoice payment can split
-- revenue to the right account (4100/4200/4300/4500/4600), defer memberships &
-- packages to 2400 Deferred Revenue, and keep tax on 2300 Tax Payable.
--
-- Also stores tax per line (the issue service already computes it per line but
-- only persisted the invoice-level total), so the per-line split is exact.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Per-line classification + tax. item_type mirrors fin_order_items
--    (migrations 076 / 107). Default 'service' is the safe fallback and matches
--    how untyped lines were implicitly treated (credited to 4100).
-- ---------------------------------------------------------------------------
ALTER TABLE pay_invoice_line_items
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) NOT NULL DEFAULT 'service'
    CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee')),
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;

-- Existing rows: leave as 'service' (the historical implicit treatment) and
-- tax_cents 0 (per-line tax wasn't tracked before; invoice-level total stands).

-- ---------------------------------------------------------------------------
-- 2. Repair the seed_chart_of_accounts function. Migration 131 rebuilt this
--    function from an older (080-era) body and inadvertently dropped the
--    '4600 No-Show Fee Revenue' account that migration 106 had added, so brand-new
--    businesses created after 131 would be missing 4600. Restore it (and keep the
--    2500 Customer Deposits account 131 correctly added).
--
--    Backfill 4600 for any existing business that is missing it as well.
-- ---------------------------------------------------------------------------
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '4600', 'No-Show Fee Revenue', 'revenue', false
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

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
        (p_business_id, '4600', 'No-Show Fee Revenue', 'revenue', false),
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
