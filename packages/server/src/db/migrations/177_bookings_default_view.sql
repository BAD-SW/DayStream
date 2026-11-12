-- Which screen Bookings opens on for staff (spec 51, gap 3): the calendar or the list with the
-- Waiting list. The business chooses a default (Settings > System); each staff member may choose
-- differently on their profile. NULL on the profile means "use the business setting".
BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('bookings.default_view', 'booking', 'string', 'calendar',
        'The screen Bookings opens on for staff: calendar or list (with the Waiting list).')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE stf_profiles
  ADD COLUMN IF NOT EXISTS bookings_default_view VARCHAR(10)
    CHECK (bookings_default_view IN ('calendar', 'list'));

COMMIT;
