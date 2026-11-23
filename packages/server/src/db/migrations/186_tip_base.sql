-- Spec 51, gap 14 (owner, 22 Nov 2026): a suggested tip percentage is worked out on the total
-- before tax (the default) or after tax, as the business chooses.
BEGIN;
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
  ('tips.base', 'billing', 'string', 'before_tax', 'Tips: suggested percentages are of the total before tax (before_tax) or including tax (after_tax)')
ON CONFLICT (key) DO NOTHING;
COMMIT;