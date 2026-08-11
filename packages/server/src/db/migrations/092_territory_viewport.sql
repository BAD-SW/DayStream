-- Store geocoded viewport bounds for territory coverage map display

BEGIN;

ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_viewport_ne_lat DOUBLE PRECISION;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_viewport_ne_lng DOUBLE PRECISION;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_viewport_sw_lat DOUBLE PRECISION;
ALTER TABLE sys_tenants ADD COLUMN IF NOT EXISTS territory_viewport_sw_lng DOUBLE PRECISION;

COMMIT;
