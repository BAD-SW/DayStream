-- Track paused days to discount from next billing cycle

BEGIN;

ALTER TABLE mbr_enrollments ADD COLUMN IF NOT EXISTS paused_days_credit INTEGER NOT NULL DEFAULT 0;

COMMIT;
