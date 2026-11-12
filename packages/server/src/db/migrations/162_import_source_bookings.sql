-- Migration 162: allow 'import' as a provenance source on bookings (spec 50, Wave 3).
-- Future appointments brought across by the data-migration engine are inserted directly
-- into apt_bookings rather than through the admin/widget booking path, so they need their
-- own source value to stay distinguishable from staff- or widget-created bookings.
-- Additive, mirrors 161_import_source.sql: existing rows keep 'admin' / 'widget'.

BEGIN;

ALTER TABLE apt_bookings DROP CONSTRAINT IF EXISTS apt_bookings_source_check;
ALTER TABLE apt_bookings
  ADD CONSTRAINT apt_bookings_source_check CHECK (source IN ('admin', 'widget', 'import'));

COMMIT;
