-- Migration 058: Add 'checked_in' as a valid booking status.
-- Also add a check-in timestamp and allow reset back to confirmed.

BEGIN;

-- Drop existing status constraint (may have different names depending on migration history)
DO $$
BEGIN
  -- Try known possible names
  ALTER TABLE apt_bookings DROP CONSTRAINT IF EXISTS apt_bookings_status_check;
  ALTER TABLE apt_bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  -- Also try to find and drop any check constraint on the status column
  EXECUTE (
    SELECT 'ALTER TABLE apt_bookings DROP CONSTRAINT ' || conname
    FROM pg_constraint
    WHERE conrelid = 'apt_bookings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  -- ignore if no constraint found
  NULL;
END $$;

-- Add updated constraint with checked_in
ALTER TABLE apt_bookings ADD CONSTRAINT apt_bookings_status_check 
  CHECK (status IN ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'));

-- Add checked_in_at timestamp
ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

COMMIT;
