-- Phase 07: Booking engine configuration keys

INSERT INTO configuration_definitions (key, category, data_type, default_value, description) VALUES
    ('booking.no_show_window_minutes', 'booking', 'number', '15', 'Minutes after start time before auto no-show'),
    ('booking.hold_duration_seconds', 'booking', 'number', '300', 'Seconds a slot is held during booking flow'),
    ('booking.reminder_hours', 'booking', 'json', '[24, 2]', 'Hours before appointment to send reminders'),
    ('booking.max_active_per_customer', 'booking', 'number', '10', 'Maximum active bookings per customer'),
    ('booking.waitlist_max_size', 'booking', 'number', '5', 'Maximum waitlist entries per session'),
    ('booking.waitlist_confirm_hours', 'booking', 'number', '2', 'Hours given to confirm a waitlist promotion'),
    ('booking.auto_confirm', 'booking', 'boolean', 'true', 'Auto-confirm bookings (no payment required)')
ON CONFLICT (key) DO NOTHING;
