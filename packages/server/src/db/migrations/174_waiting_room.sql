-- Spec 51, gap 3: virtual waiting room. When staff said "ready for you", and when the session started.
BEGIN;
ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
COMMIT;