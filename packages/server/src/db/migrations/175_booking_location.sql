-- Migration 175: the location of a booking (calendar location filter, hub design; David's yes of 11 Nov 2026).
-- Existing bookings get the business's primary location; new ones store the location chosen when booking.
ALTER TABLE apt_bookings ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES sys_locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_apt_bookings_location ON apt_bookings(location_id, start_time);
UPDATE apt_bookings b SET location_id = (
  SELECT l.id FROM sys_locations l WHERE l.business_id = b.business_id ORDER BY l.is_primary DESC, l.created_at LIMIT 1
) WHERE b.location_id IS NULL;
