-- Add H3 resolution as a system configuration setting

BEGIN;

INSERT INTO sys_system_configurations (category, config_data, updated_at)
VALUES ('prospects', '{"h3_resolution": 5}', NOW())
ON CONFLICT (category) DO UPDATE SET config_data = sys_system_configurations.config_data || '{"h3_resolution": 5}', updated_at = NOW();

COMMIT;
