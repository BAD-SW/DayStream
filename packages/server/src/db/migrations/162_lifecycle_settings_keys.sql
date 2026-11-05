-- Settings → Customer Lifecycle could not be saved (THE-22 test, David 2026-11-04: "Not saved:
-- Customer Lifecycle (Failed to save lifecycle config)"). The save writes four business settings,
-- and every business setting must have a definition; two of the four had none, so the whole save
-- failed whatever the values were. This adds the two missing definitions.

BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('lifecycle.enabled', 'lifecycle', 'boolean', 'true',
        'Customers move between lifecycle stages automatically based on inactivity'),
       ('lifecycle.run_time', 'lifecycle', 'string', '02:00',
        'Time of day (HH:MM, server timezone) when the lifecycle evaluation runs')
ON CONFLICT (key) DO NOTHING;

COMMIT;
