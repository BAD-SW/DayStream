-- Migration 124: Store a territory's COMPONENT areas (spec phase 10 / prospects).
--
-- A franchise territory may be composed of several named administrative areas
-- (e.g. "Florida Panhandle" = Escambia + Santa Rosa + Okaloosa + Walton counties).
-- The union of their boundaries is tiled into prp_tenant_territories (unchanged,
-- so prospect search is unaffected), but a contract needs to enumerate EXACTLY
-- which areas are included. We persist that component list here.
--
-- Each component: { id, label, kind, lat, lng } (the osm ref + display name + area
-- kind + center). The geometry itself is not stored (it's re-tileable from the
-- hexes); the list is the human/contract-facing definition.
--
-- App-level tenant isolation (see db/pool.ts) — no RLS.

BEGIN;

ALTER TABLE sys_tenants
  ADD COLUMN IF NOT EXISTS territory_components JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
