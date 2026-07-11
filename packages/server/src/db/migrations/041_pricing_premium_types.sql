-- Migration 041: Allow premium pricing adjustment types on pricing rules.
-- Expands discount_type to support: percentage, fixed, premium_percentage, premium_fixed

BEGIN;

-- Update the CHECK constraint on pri_rules
ALTER TABLE pri_rules DROP CONSTRAINT IF EXISTS pricing_rules_discount_type_check;
ALTER TABLE pri_rules ADD CONSTRAINT pricing_rules_discount_type_check
  CHECK (discount_type IN ('percentage', 'fixed', 'premium_percentage', 'premium_fixed'));

-- Also widen the column to accommodate longer type names
ALTER TABLE pri_rules ALTER COLUMN discount_type TYPE VARCHAR(20);

COMMIT;
