-- Spec 51, gap 14 (owner, 23 Nov 2026): the tip at Checkout is a slider, like a kiosk, from no tip
-- up to a highest percentage, starting at a default the business chooses. It replaces the three
-- suggested percentages (tips.percentages); a business's middle one becomes its default.
BEGIN;
INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description) VALUES
  ('tips.default_percent', 'billing', 'number', '15', 'Tips: the percentage the tip slider starts at'),
  ('tips.max_percent', 'billing', 'number', '30', 'Tips: the highest percentage on the tip slider')
ON CONFLICT (key) DO NOTHING;

INSERT INTO sys_business_configurations (business_id, key, value, updated_by, updated_at)
SELECT c.business_id, 'tips.default_percent', ((c.value::jsonb) ->> 1), c.updated_by, NOW()
  FROM sys_business_configurations c
 WHERE c.key = 'tips.percentages' AND jsonb_typeof(c.value::jsonb) = 'array' AND jsonb_array_length(c.value::jsonb) = 3
ON CONFLICT (business_id, key) DO NOTHING;

DELETE FROM sys_business_configurations WHERE key = 'tips.percentages';
DELETE FROM sys_configuration_definitions WHERE key = 'tips.percentages';
COMMIT;
