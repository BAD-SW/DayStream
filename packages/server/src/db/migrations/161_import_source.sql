-- Migration 161: allow 'import' as a provenance source on memberships and package purchases
-- (spec 50, Wave 2). Migrated records are created directly by the import engine rather than
-- through the admin/widget sale paths, so they need their own source value — otherwise they
-- would be indistinguishable from records a staff member created by hand.
-- Additive: existing rows keep 'admin' / 'widget'.

BEGIN;

ALTER TABLE mbr_enrollments DROP CONSTRAINT IF EXISTS mbr_enrollments_source_check;
ALTER TABLE mbr_enrollments
  ADD CONSTRAINT mbr_enrollments_source_check CHECK (source IN ('admin', 'widget', 'import'));

ALTER TABLE pkg_purchases DROP CONSTRAINT IF EXISTS pkg_purchases_source_check;
ALTER TABLE pkg_purchases
  ADD CONSTRAINT pkg_purchases_source_check CHECK (source IN ('admin', 'widget', 'import'));

COMMIT;
