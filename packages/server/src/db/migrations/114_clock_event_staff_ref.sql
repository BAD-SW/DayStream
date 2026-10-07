-- Stamp the staff number onto each clock event as an audit snapshot.
--
-- Events are already keyed to the immutable user_id (so an email change never
-- orphans history), but recording the staff_ref as-of the punch makes the clock
-- record self-describing for compliance/audit even if the staff profile is
-- later edited. Nullable: pre-existing rows and events with no resolvable
-- profile simply carry NULL.
BEGIN;

ALTER TABLE clk_events
  ADD COLUMN IF NOT EXISTS staff_ref VARCHAR(20);

COMMIT;
