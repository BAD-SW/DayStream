-- Migration 071: Add scheduling_mode to sys_businesses.
-- Determines whether the booking engine uses staff schedule entries or availability patterns.
-- 'schedule' = use stf_schedule_entries (the scheduler)
-- 'availability' = use stf_availability_patterns (staff profile patterns)

ALTER TABLE sys_businesses ADD COLUMN IF NOT EXISTS scheduling_mode VARCHAR(20) NOT NULL DEFAULT 'availability';

COMMENT ON COLUMN sys_businesses.scheduling_mode IS 'schedule = use staff schedule entries, availability = use staff availability patterns';
