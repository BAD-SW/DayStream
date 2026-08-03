-- Add resource_ids column to svc_availability_rules
-- Allows availability rules to be scoped to specific resources

BEGIN;

ALTER TABLE svc_availability_rules ADD COLUMN IF NOT EXISTS resource_ids UUID[] DEFAULT NULL;

COMMIT;
