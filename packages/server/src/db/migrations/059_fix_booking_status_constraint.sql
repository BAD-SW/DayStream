-- Migration 059: Fix booking status constraint to include 'checked_in'.
-- Migration 058 may have failed to drop the original constraint due to naming.

BEGIN;

-- Drop any existing check constraint on status column
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'apt_bookings'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE apt_bookings DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

-- Add correct constraint
ALTER TABLE apt_bookings ADD CONSTRAINT apt_bookings_status_check 
  CHECK (status IN ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'));

-- Ensure checked_in_at column exists (may have been lost if 058 rolled back)
ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

COMMIT;
