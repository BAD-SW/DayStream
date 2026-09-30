-- Navy base theme (Linear THE-6): a third built-in base palette alongside Classic and
-- Bold Business. The base-theme columns added in 105/106/108 each carry an inline CHECK
-- that only allows 'classic' | 'bold-business', so they are widened here. The inline
-- constraints were auto-named by Postgres, so they are looked up by column rather than
-- dropped by a guessed name, then re-added under explicit names.
BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'c'
      AND (
        (c.conrelid = 'sys_businesses'::regclass AND a.attname IN ('base_theme', 'active_built_in_theme'))
        OR (c.conrelid = 'sys_tenants'::regclass AND a.attname = 'active_built_in_theme')
        OR (c.conrelid = 'cfg_themes'::regclass AND a.attname = 'base_theme')
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE sys_businesses
  ADD CONSTRAINT sys_businesses_base_theme_check
    CHECK (base_theme IN ('classic', 'bold-business', 'navy')),
  ADD CONSTRAINT sys_businesses_active_built_in_theme_check
    CHECK (active_built_in_theme IN ('classic', 'bold-business', 'navy'));

ALTER TABLE sys_tenants
  ADD CONSTRAINT sys_tenants_active_built_in_theme_check
    CHECK (active_built_in_theme IN ('classic', 'bold-business', 'navy'));

ALTER TABLE cfg_themes
  ADD CONSTRAINT cfg_themes_base_theme_check
    CHECK (base_theme IN ('classic', 'bold-business', 'navy'));

UPDATE sys_configuration_definitions
SET description = 'Base palette: classic, bold-business or navy'
WHERE key = 'brand.base_theme';

COMMIT;
