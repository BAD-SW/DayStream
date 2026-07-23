-- Migration 067: Location operating hours.
-- Each location can define its hours of operation per day of week.
-- Used by the staff scheduling calendar to display working vs non-working hours.

CREATE TABLE IF NOT EXISTS sys_location_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  is_closed BOOLEAN NOT NULL DEFAULT false,
  open_time TIME,
  close_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(location_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_location_hours_location ON sys_location_hours(location_id);
