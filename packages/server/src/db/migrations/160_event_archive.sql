-- Deleting an event archives it (David, 2026-10-28): it leaves the event lists and the
-- customers' screens, and can be restored. Only an event with no registrations and nobody
-- waiting can be deleted; an event with registrations is cancelled first.
ALTER TABLE evt_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE evt_events ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES usr_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_evt_events_not_deleted ON evt_events (tenant_id, start_time) WHERE deleted_at IS NULL;
