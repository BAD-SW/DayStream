-- Add city column to prospects for filtering/sorting

BEGIN;

ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS city VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_prp_prospects_city ON prp_prospects(tenant_id, city);

COMMIT;
