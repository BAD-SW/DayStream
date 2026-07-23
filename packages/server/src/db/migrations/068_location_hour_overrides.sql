-- Migration 068: Location hour overrides (holidays, special hours).
-- Allows date-specific overrides to normal operating hours.

CREATE TABLE IF NOT EXISTS sys_location_hour_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  label VARCHAR(200),
  is_closed BOOLEAN NOT NULL DEFAULT false,
  open_time TIME,
  close_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(location_id, override_date)
);

CREATE INDEX IF NOT EXISTS idx_location_hour_overrides_location ON sys_location_hour_overrides(location_id, override_date);
