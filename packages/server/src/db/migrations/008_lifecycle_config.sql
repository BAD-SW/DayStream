-- Phase 05: Lifecycle Tracking configuration keys
-- Seed lifecycle transition rule defaults into configuration_definitions

INSERT INTO configuration_definitions (key, category, data_type, default_value, description) VALUES
    ('lifecycle.trial_after_bookings', 'lifecycle', 'number', '1', 'Number of bookings to transition Lead → Trial'),
    ('lifecycle.active_after_visits', 'lifecycle', 'number', '3', 'Number of attended visits to transition Trial → Active'),
    ('lifecycle.at_risk_days', 'lifecycle', 'number', '30', 'Days of inactivity before Active → At-Risk'),
    ('lifecycle.churned_days', 'lifecycle', 'number', '90', 'Days of inactivity before At-Risk → Churned')
ON CONFLICT (key) DO NOTHING;
