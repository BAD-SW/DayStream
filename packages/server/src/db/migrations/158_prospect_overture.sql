-- Migration 158: Overture-primary prospect redesign (spec 31).
-- Additive and non-breaking: the existing Google engine keeps working. New columns/config
-- support Overture discovery, local confidence, fit signals/score, and territory valuation.

BEGIN;

-- 1. prp_prospects: allow 'overture' source + add Overture/fit columns.
--    Rebuild the source CHECK to include 'overture' (old CHECK only allowed api/manual).
ALTER TABLE prp_prospects DROP CONSTRAINT IF EXISTS prp_prospects_source_check;
ALTER TABLE prp_prospects ADD CONSTRAINT prp_prospects_source_check
  CHECK (source IN ('api', 'manual', 'overture'));

-- Stable external id from the source (Overture place id) for dedup/update on re-run.
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS external_id VARCHAR(300);

-- Source data-quality confidence (e.g. Overture's score 0..1). Stored, used LOCALLY only —
-- never a fetch-time filter. NULL for non-Overture rows.
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3);

-- Raw fit signals kept for learning (has_phone, has_website, has_social, multi_location,
-- review_count, address_complete, matched_category, etc.). Never discarded.
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS fit_signals JSONB NOT NULL DEFAULT '{}';

-- DayStream-owned Fit Score (0..100) and derived tier. Distinct from `confidence`.
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS fit_score INTEGER;
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS fit_tier VARCHAR(16)
  CHECK (fit_tier IS NULL OR fit_tier IN ('strong', 'moderate', 'weak'));

-- Reversible inclusion classification (active vs held), independent of is_active.
-- 'included' = shown as an active prospect; 'held' = retained but filtered out locally
-- (by confidence threshold or the operator contact-completeness filter). Never a delete.
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS inclusion VARCHAR(16) NOT NULL DEFAULT 'included'
  CHECK (inclusion IN ('included', 'held'));
-- When held, why (for transparency/learning): 'confidence' | 'contact' | 'manual'.
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS hold_reason VARCHAR(20);

-- Which source(s) contributed this reconciled record (e.g. ['overture'], ['overture','manual']).
ALTER TABLE prp_prospects ADD COLUMN IF NOT EXISTS contributing_sources TEXT[] NOT NULL DEFAULT '{}';

-- Dedup/update key for Overture rows: (tenant_id, external_id). Partial unique so it does
-- not collide with Google rows (which use google_place_id) or manual rows (no external id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_prp_prospects_external
  ON prp_prospects(tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prp_prospects_fit ON prp_prospects(tenant_id, fit_tier);
CREATE INDEX IF NOT EXISTS idx_prp_prospects_inclusion ON prp_prospects(tenant_id, inclusion);

-- 2. prp_category_mappings: add the Overture taxonomy mapping alongside the Google strings.
--    overture_taxonomy holds the curated taxonomy/basic_category values for this category.
ALTER TABLE prp_category_mappings ADD COLUMN IF NOT EXISTS overture_taxonomy TEXT[] NOT NULL DEFAULT '{}';

-- Seed Overture taxonomy for the existing active categories (curated; extend via admin UI).
UPDATE prp_category_mappings SET overture_taxonomy = ARRAY['spa','day_spa','medical_spa','sauna','wellness_service','cryotherapy']
  WHERE ui_category_name = 'Spas & Recovery Centers';
UPDATE prp_category_mappings SET overture_taxonomy = ARRAY['massage','massage_therapy','physical_therapy','physiotherapist']
  WHERE ui_category_name = 'Massage Therapy';
UPDATE prp_category_mappings SET overture_taxonomy = ARRAY['beauty_salon','hair_salon','nail_salon','barber','hairdresser','personal_or_beauty_service']
  WHERE ui_category_name = 'Beauty & Hair';

-- 3. prp_generation_log: record which engine produced the run (google vs overture) +
--    whether the result was truncated/partial. Additive, defaulted.
ALTER TABLE prp_generation_log ADD COLUMN IF NOT EXISTS engine VARCHAR(16) NOT NULL DEFAULT 'google';
ALTER TABLE prp_generation_log ADD COLUMN IF NOT EXISTS held_count INTEGER NOT NULL DEFAULT 0;

-- 4. Feature flag: select the Overture engine per tenant (off by default — additive rollout).
INSERT INTO sys_feature_flags (key, description, scope, enabled)
VALUES ('feature.prospects_overture', 'Use Overture Maps as the prospect discovery source (vs Google Places)', 'tenant', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
