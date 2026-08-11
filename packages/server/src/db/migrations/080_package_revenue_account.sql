-- Add Package Revenue account to chart of accounts seed function

BEGIN;

-- Add to existing businesses that have chart of accounts
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '4500', 'Package Revenue', 'revenue', false
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

-- Also add Discounts contra-revenue account
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '4900', 'Discounts & Adjustments', 'revenue', false
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

-- Update seed function for new businesses
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
        (p_business_id, '2400', 'Deferred Revenue', 'liability', true)
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
