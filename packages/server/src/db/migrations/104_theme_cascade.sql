-- Complete the brand.* theme cascade: platform default (sys_configuration_definitions.default_value)
-- -> tenant override (sys_tenant_configurations) -> business override (sys_businesses columns).
-- The tenant/system layers already existed for primary_color/logo_url (003_core_platform.sql);
-- add the 3 fields the business Appearance panel also has (103_business_appearance.sql) so all
-- three levels manage the same field set.
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
    ('brand.secondary_color', 'branding', 'string', '#4A7FB5', 'Secondary accent color'),
    ('brand.font_family', 'branding', 'string', 'System Default', 'Base font family'),
    ('brand.base_font_size', 'branding', 'number', '15', 'Base font size in px')
ON CONFLICT (key) DO NOTHING;

-- Remove the forced defaults so an unset business-level color/size genuinely means
-- "inherit from tenant/platform" rather than "coincidentally matches the old hardcoded default."
-- Existing rows keep whatever concrete value they already have — no visible change for them.
ALTER TABLE sys_businesses ALTER COLUMN primary_color DROP DEFAULT;
ALTER TABLE sys_businesses ALTER COLUMN base_font_size DROP DEFAULT;
