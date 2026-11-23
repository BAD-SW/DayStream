-- Spec 51, gap 18 (owner, 23 Nov 2026): an appointment's history is kept in the database while it
-- is recent, and moved to file storage (the S3 bucket, or the local folder in development) once
-- the appointment is long past, so the table does not grow without end. One JSON file per
-- appointment; the History section reads both, so nothing looks different.
BEGIN;
ALTER TABLE apt_bookings
  ADD COLUMN IF NOT EXISTS history_archive_path TEXT,
  ADD COLUMN IF NOT EXISTS history_archived_at TIMESTAMPTZ;

-- Archiving may remove the rows it has copied (app.history_archive = 'on', for that one
-- transaction, after the file is written and read back); nothing else may change entries.
CREATE OR REPLACE FUNCTION apt_booking_history_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND current_setting('app.history_archive', true) = 'on' THEN RETURN OLD; END IF;
  IF current_setting('app.history_anonymise', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An appointment''s history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

-- Daily, in small batches: appointments whose end is more than 12 months ago (config.months),
-- up to 500 a run (config.batch).
INSERT INTO sys_scheduled_jobs (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at, config)
VALUES ('platform', NULL, NULL, 'booking_history_archive', '03:00', 'UTC', 'daily', true, NOW(), '{"months": 12, "batch": 500}'::jsonb)
ON CONFLICT (job_type) WHERE scope_level = 'platform' DO NOTHING;
COMMIT;
