-- Add lat/lng to prospects for distance calculation

BEGIN;

ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

COMMIT;
