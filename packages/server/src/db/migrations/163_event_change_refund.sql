-- Changing a published event (David, 2026-11-04, decision 14, the proposal by market standard).
--
-- Changes to a published event stay live. When its date, time or place changes while people are
-- registered, each of them may cancel for a full refund for a number of days, even when the
-- business's normal cancellation rules would not allow it. `events.change_refund_days` sets how
-- many (default 7); `evt_events.change_refund_until` holds the end of that window for the event
-- (never later than its start).

BEGIN;

ALTER TABLE evt_events ADD COLUMN IF NOT EXISTS change_refund_until TIMESTAMPTZ;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('events.change_refund_days', 'booking', 'number', '7',
        'Days during which people registered for an event can cancel for a full refund after its date, time or place changed')
ON CONFLICT (key) DO NOTHING;

COMMIT;
