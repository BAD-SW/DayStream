-- Migration 055: Add variant_ids and location_ids to promotions for finer-grained targeting.

BEGIN;

ALTER TABLE prm_promotions ADD COLUMN IF NOT EXISTS variant_ids UUID[];
ALTER TABLE prm_promotions ADD COLUMN IF NOT EXISTS location_ids UUID[];

COMMIT;
