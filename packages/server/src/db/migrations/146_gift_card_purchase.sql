-- Gift cards sold through checkout (spec 10, Requirement C7 — "Model B").
--
-- A gift card is now PURCHASED as an order line item (like a product), funded by a
-- real payment at checkout. On order completion the server creates the funded
-- pay_gift_cards row. Accounting: the purchase credits a Gift Card Liability (we
-- owe that value back), not revenue; redemption later moves liability -> revenue.
--
-- This migration:
--   1. Adds 'gift_card' to the fin_order_items.item_type CHECK (mirrors 107).
--   2. Adds the '2600 Gift Card Liability' account (seed fn + backfill).
--   3. Adds recipient columns on the gift-card order line + a funding-order link
--      on pay_gift_cards.

BEGIN;

-- 1. Allow 'gift_card' as an order line item type ------------------------------
ALTER TABLE fin_order_items DROP CONSTRAINT IF EXISTS fin_order_items_item_type_check;
ALTER TABLE fin_order_items
  ADD CONSTRAINT fin_order_items_item_type_check
  CHECK (item_type IN ('service', 'product', 'membership', 'package', 'no_show_fee', 'gift_card'));

-- 2a. Recipient details carried on a gift-card order line (nullable; only used by
--     gift_card lines). Read at completion to populate the created gift card.
ALTER TABLE fin_order_items
  ADD COLUMN IF NOT EXISTS gift_recipient_name  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS gift_recipient_email VARCHAR(255);

-- 2b. Link a created gift card back to the order that funded it (audit/trace).
ALTER TABLE pay_gift_cards
  ADD COLUMN IF NOT EXISTS funded_by_order_id UUID REFERENCES fin_orders(id) ON DELETE SET NULL;

-- 3. Gift Card Liability account (2600). Add to existing businesses, then rebuild
--    the seed function so new businesses get it too. (4400 Gift Card Revenue
--    already exists for the redemption revenue side.)
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '2600', 'Gift Card Liability', 'liability', true
  FROM sys_businesses b
 WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts c WHERE c.business_id = b.id AND c.code = '1100')
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
        (p_business_id, '2500', 'Customer Deposits', 'liability', true),
        (p_business_id, '2600', 'Gift Card Liability', 'liability', true)
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
