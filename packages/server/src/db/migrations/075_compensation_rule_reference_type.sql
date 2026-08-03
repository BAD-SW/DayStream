-- Refactor compensation rules to support multiple offering types (service, product, membership, package)
-- Replaces single service_id with reference_type + reference_ids array

BEGIN;

-- Add new columns
ALTER TABLE fin_compensation_rules ADD COLUMN IF NOT EXISTS reference_type VARCHAR(20)
    CHECK (reference_type IN ('service', 'product', 'membership', 'package'));
ALTER TABLE fin_compensation_rules ADD COLUMN IF NOT EXISTS reference_ids UUID[] DEFAULT NULL;

-- Migrate existing service_id data
UPDATE fin_compensation_rules
SET reference_type = 'service', reference_ids = ARRAY[service_id]
WHERE service_id IS NOT NULL;

-- Drop the old service_id column and its FK constraint
ALTER TABLE fin_compensation_rules DROP COLUMN IF EXISTS service_id;

-- Index for lookups by reference type
CREATE INDEX IF NOT EXISTS idx_compensation_rules_ref_type ON fin_compensation_rules(reference_type);

COMMIT;
