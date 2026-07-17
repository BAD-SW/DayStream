-- Migration 057: Allow walk-in bookings without a customer account.

BEGIN;

ALTER TABLE apt_bookings ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS walk_in_name VARCHAR(100);

COMMIT;
