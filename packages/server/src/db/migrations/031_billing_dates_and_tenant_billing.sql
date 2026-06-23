-- Add billing fields to tenants table (tenant pays DayStream)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_frequency VARCHAR(20) DEFAULT 'monthly'
    CHECK (billing_frequency IN ('monthly', 'quarterly', 'semi-annual', 'annual'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_amount INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_method VARCHAR(50) DEFAULT 'tbd';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS next_billing_date DATE;

-- Add signup and next billing date to businesses table (business pays tenant)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS signup_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS next_billing_date DATE;
