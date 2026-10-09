-- Migration 125: Geocoding/boundary cache (spec phase 10 / prospects territory).
--
-- Territory resolution calls the public Nominatim (OpenStreetMap) service, which
-- rate-limits to ~1 req/sec and returns HTTP 429 under real use. That throttling
-- was silently degrading precise boundaries (counties, named regions) into
-- "approximate" rectangles. To make territory definition reliable and
-- contract-grade, we cache resolved results so repeat lookups never re-hit the
-- live service (administrative boundaries don't change).
--
-- Two caches:
--   - search:  a query string -> the candidate list (jsonb)
--   - lookup:  an osm ref (e.g. "relation/123") -> its boundary (jsonb)
--
-- App-level isolation (see db/pool.ts) — no RLS. Platform-wide reference data.

BEGIN;

CREATE TABLE IF NOT EXISTS prp_geo_cache (
  cache_key   TEXT PRIMARY KEY,          -- e.g. 'search:walton county, florida' or 'lookup:relation/123'
  kind        VARCHAR(10) NOT NULL CHECK (kind IN ('search', 'lookup')),
  payload     JSONB NOT NULL,            -- candidate list (search) or boundary (lookup)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
