-- Store territory boundary polygon as GeoJSON for accurate coverage map display

BEGIN;

ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_geojson JSONB;

COMMIT;
