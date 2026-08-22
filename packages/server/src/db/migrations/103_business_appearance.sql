-- Per-business appearance/theming (ui-guidelines-and-theming.md §7).
-- logo_url and primary_color already exist on sys_businesses (migration 006).
ALTER TABLE sys_businesses
  ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7),
  ADD COLUMN IF NOT EXISTS font_family VARCHAR(50),
  ADD COLUMN IF NOT EXISTS base_font_size SMALLINT DEFAULT 15;
