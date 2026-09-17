-- Fix: applying a built-in theme (Bold Business / Classic) only ever cleared the custom-
-- theme pointer, which means "inherit from the level above" — indistinguishable from
-- never having applied anything. There was no way to record "this scope explicitly
-- wants Classic" as opposed to "this scope has no opinion." Add a sibling pointer that
-- stores an explicit built-in choice; resolution checks custom -> explicit built-in ->
-- inherit up, at each level.
BEGIN;

ALTER TABLE sys_businesses
  ADD COLUMN IF NOT EXISTS active_built_in_theme VARCHAR(20) CHECK (active_built_in_theme IN ('bold-business', 'classic'));

ALTER TABLE sys_tenants
  ADD COLUMN IF NOT EXISTS active_built_in_theme VARCHAR(20) CHECK (active_built_in_theme IN ('bold-business', 'classic'));

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('theme.system_active_built_in_theme', 'branding', 'string', '', 'Explicit built-in theme id chosen at system scope; blank falls through to the Bold Business hardcoded default')
ON CONFLICT (key) DO NOTHING;

COMMIT;
