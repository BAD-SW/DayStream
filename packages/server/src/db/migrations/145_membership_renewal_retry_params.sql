-- Membership Renewals — failed-renewal retry parameters (spec 10, Requirement C6/C6a).
--
-- When a membership renewal charge fails, the enrollment moves to the new
-- 'renewing' status and is retried automatically as part of the Membership
-- Renewals process. The retry behaviour is configured PER BUSINESS as a retry
-- COUNT and an INTERVAL in days. These are stored in sys_business_configurations,
-- whose `key` has a FK to sys_configuration_definitions(key) — so the keys must be
-- registered here before they can be written (same pattern as 131 invoicing.enabled).
--
-- (The earlier 'dunning.retry_days' key was never registered; the count/interval
-- model supersedes it. Registered too, for backward-compatible reads.)

BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES
    ('dunning.retry_count', 'billing', 'number', '3', 'Membership Renewals: maximum automatic retries for a failed renewal before the membership expires'),
    ('dunning.retry_interval_days', 'billing', 'number', '3', 'Membership Renewals: number of days between automatic retries of a failed renewal'),
    ('dunning.retry_days', 'billing', 'string', '', 'Legacy day-offset retry schedule (JSON/CSV); superseded by dunning.retry_count + dunning.retry_interval_days')
ON CONFLICT (key) DO NOTHING;

COMMIT;
