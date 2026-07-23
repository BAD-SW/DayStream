-- Migration 069: Staff Schedule.
-- Tracks actual scheduled shifts for staff members.
-- Sits between availability (when they CAN work) and bookings (appointments).

BEGIN;

-- Recurring weekly schedule templates
CREATE TABLE IF NOT EXISTS stf_schedule_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES stf_profiles(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL DEFAULT 'Default',
  effective_from DATE NOT NULL,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_templates_business ON stf_schedule_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_schedule_templates_staff ON stf_schedule_templates(staff_id, is_active);

-- Template slots (recurring weekly pattern)
CREATE TABLE IF NOT EXISTS stf_schedule_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES stf_schedule_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location_id UUID REFERENCES sys_locations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_template_slots_template ON stf_schedule_template_slots(template_id);

-- Individual schedule entries (actual shifts - generated from templates or ad hoc)
CREATE TABLE IF NOT EXISTS stf_schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES stf_profiles(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location_id UUID REFERENCES sys_locations(id) ON DELETE SET NULL,
  entry_type VARCHAR(20) NOT NULL DEFAULT 'shift',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(staff_id, schedule_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_business_date ON stf_schedule_entries(business_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_staff_date ON stf_schedule_entries(staff_id, schedule_date);

COMMENT ON COLUMN stf_schedule_entries.entry_type IS 'shift = working, day_off = explicitly off, training = non-bookable';

COMMIT;
