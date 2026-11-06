-- Saved custom themes become Navy-based (David, 6 November 2026, THE-12 c).
--
-- A custom theme stores only what it changes on top of its base theme (the token delta, see
-- stripDefaultTokens in themeTokens.ts). Moving its base to Navy keeps every colour and font
-- change the business made; whatever it did not change now comes from Navy, including the dark
-- version. Classic and Bold Business stay available as built-in themes.

BEGIN;

UPDATE cfg_themes
   SET base_theme = 'navy', updated_at = NOW()
 WHERE base_theme IN ('classic', 'bold-business')
   AND deleted_at IS NULL;

COMMIT;
