-- Migration 070: Staff-location assignments.
-- Tracks which staff members can work at each location.
-- Used by the scheduler to filter the staff dropdown by location.

CREATE TABLE IF NOT EXISTS sys_location_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES stf_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(location_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_location_staff_location ON sys_location_staff(location_id);
CREATE INDEX IF NOT EXISTS idx_location_staff_staff ON sys_location_staff(staff_id);
