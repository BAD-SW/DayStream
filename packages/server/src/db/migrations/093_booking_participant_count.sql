-- Migration 093: Add participant_count to apt_bookings.
-- Persisted (not just a creation-time validation parameter) so that later overlap-based
-- capacity checks know how many spots an existing booking actually occupies.
-- See .kiro/specs/32-smart-booking-flow/design-Claude.md.

ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS participant_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE apt_bookings ADD CONSTRAINT apt_bookings_participant_count_check CHECK (participant_count >= 1);

COMMENT ON COLUMN apt_bookings.participant_count IS 'Number of participants this booking occupies on its resource, for capacity overlap checks';
