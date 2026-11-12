-- Navy is the default look (David, 5 November 2026, THE-12). Classic and Bold Business stay
-- selectable; businesses and organisations that chose a theme keep it.
--
-- The platform-level built-in pointer decides the look of every scope that has no theme of its
-- own. It is set to Navy here; a platform custom theme (theme.system_active_theme_id), if one is
-- set, still comes first, as before. The code's own fallback is Navy too (theme.service.ts).

BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('theme.system_active_built_in_theme', 'branding', 'string', 'navy', 'Explicit built-in theme id chosen at system scope; blank falls through to the Navy default')
ON CONFLICT (key) DO UPDATE SET default_value = 'navy', description = EXCLUDED.description;

COMMIT;
