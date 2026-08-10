-- Add pending_plan_id for deferred downgrades (applied at next billing cycle)

BEGIN;

ALTER TABLE mbr_enrollments ADD COLUMN IF NOT EXISTS pending_plan_id UUID REFERENCES mbr_plans(id) ON DELETE SET NULL;

COMMIT;
