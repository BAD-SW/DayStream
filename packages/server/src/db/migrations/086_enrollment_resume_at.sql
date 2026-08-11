-- Add resume_at column to track when a paused membership should auto-resume

BEGIN;

ALTER TABLE mbr_enrollments ADD COLUMN IF NOT EXISTS resume_at DATE;

CREATE INDEX IF NOT EXISTS idx_mbr_enrollments_resume ON mbr_enrollments(resume_at) WHERE status = 'paused' AND resume_at IS NOT NULL;

COMMIT;
