-- Migration 160: store a territory's estimated population (spec 31 follow-up).
-- A modeled estimate (summed from the Kontur population grid over the territory's H3 hexes),
-- used to gauge territory size before running a prospect search and to feed valuation/pricing.
-- Per-component population lives in the existing territory_components JSONB (schemaless, no
-- migration needed); this adds the aggregate total for the whole territory.

BEGIN;

ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_population INTEGER;

COMMIT;
