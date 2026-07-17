-- Migration 061: Drop the legacy 'bookings_status_check' constraint.
-- This constraint was carried over from when the table was named 'bookings'.
-- It does not include 'checked_in' and blocks check-in transitions.
-- The correct constraint is 'apt_bookings_status_check' (added in 059).

ALTER TABLE apt_bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
