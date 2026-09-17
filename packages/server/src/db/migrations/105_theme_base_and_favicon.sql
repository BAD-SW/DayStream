-- Extend the existing brand.* theme cascade (104_theme_cascade.sql) with three more
-- fields the Theme Setup work surfaced as gaps: a selectable base palette (Classic —
-- the current look, vs. Bold Business — a professional blue SaaS palette), a favicon
-- override, and a title/heading text color. Same system -> tenant -> business cascade
-- as the existing color/font fields; NULL at tenant/business level means "inherit".
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
    ('brand.base_theme', 'branding', 'string', 'classic', 'Base palette: classic or bold-business'),
    ('brand.favicon_url', 'branding', 'string', '', 'Browser tab icon URL'),
    ('brand.title_color', 'branding', 'string', '', 'Heading/title text color')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE sys_businesses
  ADD COLUMN IF NOT EXISTS base_theme VARCHAR(20) CHECK (base_theme IN ('classic', 'bold-business')),
  ADD COLUMN IF NOT EXISTS favicon_url TEXT,
  ADD COLUMN IF NOT EXISTS title_color VARCHAR(7);
