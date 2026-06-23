-- Add billing fields to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_frequency VARCHAR(20) DEFAULT 'monthly'
    CHECK (billing_frequency IN ('monthly', 'quarterly', 'semi-annual', 'annual'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_amount INTEGER DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_method VARCHAR(50) DEFAULT 'tbd';
