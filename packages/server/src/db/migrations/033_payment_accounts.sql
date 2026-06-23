-- Payment account details for tenants (receiving from businesses + paying DayStream)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receiving_bank_name VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receiving_account_holder VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receiving_account_number VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receiving_routing_number VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receiving_iban VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receiving_swift VARCHAR(20);

-- How the tenant pays DayStream (debit source)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_bank_name VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_account_holder VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_account_number VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_routing_number VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_iban VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_card_last4 VARCHAR(4);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_card_brand VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_card_exp VARCHAR(7);

-- Payment account details for businesses (how they pay their tenant)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_bank_name VARCHAR(255);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_account_holder VARCHAR(255);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_account_number VARCHAR(100);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_routing_number VARCHAR(100);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_iban VARCHAR(50);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_card_last4 VARCHAR(4);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_card_brand VARCHAR(20);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_card_exp VARCHAR(7);

-- Update billing_method check to include the new options
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_billing_method_check;
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_billing_method_check;
