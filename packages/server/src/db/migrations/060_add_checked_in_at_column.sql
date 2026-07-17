-- Migration 060: Ensure checked_in_at column exists.
-- Migration 058 may have rolled back before creating this column.

ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
