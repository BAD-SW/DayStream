-- Add last_billing_date to both tenants and businesses
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_billing_date DATE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_billing_date DATE;
