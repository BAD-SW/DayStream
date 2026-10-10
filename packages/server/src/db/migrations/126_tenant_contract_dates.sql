-- Migration 126: Replace the legacy tenant-level recurring-billing fields with
-- contract date fields (spec phase 10 / payment platform).
--
-- The original tenant billing model (migration 031) stored how DayStream charges a
-- tenant directly on sys_tenants: billing_frequency, billing_amount, billing_method,
-- signup_date, next_billing_date. That model was superseded by the Billing Plan
-- system (migrations 121/122: pay_tenant_billing_plans + pay_tenant_billing_accounts),
-- where every tenant is billed monthly and plan terms live in their own tables. The
-- five sys_tenants columns are now unused and misleading on the tenant Settings tab.
--
-- This migration drops those five columns and introduces two contract dates used for
-- future reporting on the tenant profile.
--
-- NOT touched (intentionally kept):
--   - sys_tenants.last_billing_date and payment_* columns (payment method on file).
--   - The same-named columns on sys_businesses (business-pays-tenant billing) — a
--     separate, still-active model.

BEGIN;

-- Drop the legacy billing-frequency CHECK constraint (added in migration 031) before
-- dropping its column.
ALTER TABLE sys_tenants DROP CONSTRAINT IF EXISTS tenants_billing_frequency_check;

ALTER TABLE sys_tenants DROP COLUMN IF EXISTS billing_frequency;
ALTER TABLE sys_tenants DROP COLUMN IF EXISTS billing_amount;
ALTER TABLE sys_tenants DROP COLUMN IF EXISTS billing_method;
ALTER TABLE sys_tenants DROP COLUMN IF EXISTS signup_date;
ALTER TABLE sys_tenants DROP COLUMN IF EXISTS next_billing_date;

-- Contract dates for reporting (nullable — set per tenant as contracts are signed).
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS contract_start_date DATE;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS contract_expire_date DATE;

COMMIT;
