-- Fix: system-scope themes must be platform-wide (visible to every tenant), not scoped
-- to whichever tenant the creating system admin happens to be homed under. 106's
-- NOT NULL tenant_id made every row — including scope='system' ones — invisible outside
-- the creator's own tenant, so "apply at system scope" silently had no effect for any
-- other tenant's businesses.
BEGIN;

ALTER TABLE cfg_themes ALTER COLUMN tenant_id DROP NOT NULL;

-- Recreate the name-uniqueness index treating all system-scope (tenant_id IS NULL) rows
-- as sharing one identity, so duplicate system-theme names are still rejected — a plain
-- NULL-based unique index would otherwise let every NULL be "distinct" from every other.
DROP INDEX IF EXISTS cfg_themes_name_uidx;
CREATE UNIQUE INDEX cfg_themes_name_uidx
  ON cfg_themes (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), scope, scope_id, name)
  WHERE deleted_at IS NULL;

COMMIT;
