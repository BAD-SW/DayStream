-- Global population density lookup for H3 hexagons
-- Data source: Kontur Population (https://data.humdata.org/dataset/kontur-population-dataset)
-- Resolution 8 hexagons with population counts
-- Import script: packages/server/scripts/import-population.ts

BEGIN;

CREATE TABLE IF NOT EXISTS prp_population_lookup (
  h3_index VARCHAR(15) PRIMARY KEY,
  population INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pop_lookup_population ON prp_population_lookup(population) WHERE population > 0;

-- Add is_searchable flag to territory hexagons
ALTER TABLE prp_tenant_territories ADD COLUMN IF NOT EXISTS is_searchable BOOLEAN NOT NULL DEFAULT true;

COMMIT;
