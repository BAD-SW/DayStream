-- Add Deferred Revenue liability account for packages and memberships

BEGIN;

-- Add to existing businesses
INSERT INTO fin_chart_of_accounts (business_id, code, name, account_type, is_system)
SELECT b.id, '2400', 'Deferred Revenue', 'liability', true
FROM sys_businesses b
WHERE EXISTS (SELECT 1 FROM fin_chart_of_accounts WHERE business_id = b.id)
ON CONFLICT (business_id, code) DO NOTHING;

COMMIT;
