-- Migration 040: Add variant, location, and staff scoping to service availability rules.
-- An availability rule can now optionally be scoped to specific variants, locations, and/or staff.
-- If these arrays are NULL/empty, the rule applies globally to the service (current behavior).

BEGIN;

ALTER TABLE svc_availability_rules ADD COLUMN IF NOT EXISTS variant_ids UUID[] DEFAULT NULL;
ALTER TABLE svc_availability_rules ADD COLUMN IF NOT EXISTS location_ids UUID[] DEFAULT NULL;
ALTER TABLE svc_availability_rules ADD COLUMN IF NOT EXISTS staff_ids UUID[] DEFAULT NULL;

COMMIT;
