-- Track revenue recognition per enrollment to support incremental processing

BEGIN;

CREATE TABLE IF NOT EXISTS fin_revenue_recognized (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES mbr_enrollments(id) ON DELETE CASCADE,
  amount_recognized INTEGER NOT NULL DEFAULT 0,
  days_recognized INTEGER NOT NULL DEFAULT 0,
  last_recognized_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enrollment_id)
);

CREATE INDEX IF NOT EXISTS idx_fin_revenue_recognized_business ON fin_revenue_recognized(business_id);

COMMIT;
