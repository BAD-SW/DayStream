-- Renewal reminder lead time (spec 10-payment-platform, Renewal Reminder template).
--
-- A membership renewal reminder (membership.renewal_reminder) is sent a
-- configurable number of days BEFORE a renewal, per business, as part of the daily
-- billing_process run. The lead time is stored in sys_business_configurations under
-- `renewal_reminder.days_before` (0 disables). Because sys_business_configurations.key
-- has a FK to sys_configuration_definitions(key), the key must be registered here
-- before it can be written (same pattern as 131 invoicing.enabled, 145 retry params,
-- 147 gift_card.tax_enabled).

BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('renewal_reminder.days_before', 'billing', 'number', '5',
        'Membership Renewals: how many days before a renewal to email the customer a reminder (0 disables the reminder)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
