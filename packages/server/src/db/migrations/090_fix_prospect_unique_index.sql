-- Fix: replace partial unique index with a regular unique constraint for ON CONFLICT to work

BEGIN;

DROP INDEX IF EXISTS idx_prp_prospects_unique_place;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prp_prospects_unique_place ON prp_prospects(tenant_id, google_place_id);

COMMIT;
