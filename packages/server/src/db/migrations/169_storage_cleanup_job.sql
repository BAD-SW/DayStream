-- Migration 169: retry job for files that could not be removed (spec 51, gap 1).
--
-- When a customer is anonymised or deleted, their folder in file storage is removed. If storage
-- cannot be reached at that moment, the folder is queued in sys_storage_cleanup (migration 168).
-- One platform sweep every 15 minutes retries the queue, so a temporary outage never leaves
-- files behind. It does nothing (and costs one cheap query) when the queue is empty.

BEGIN;

INSERT INTO sys_scheduled_jobs (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at)
VALUES ('platform', NULL, NULL, 'storage_cleanup', '00:00', 'UTC', 'every_15min', true, NOW())
ON CONFLICT (job_type) WHERE scope_level = 'platform' DO NOTHING;

COMMIT;
