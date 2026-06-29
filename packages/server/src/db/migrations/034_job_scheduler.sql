-- Job Scheduler: database-driven, timezone-aware, per-business job scheduling

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL,
  -- Schedule configuration
  schedule_time TIME NOT NULL DEFAULT '02:00',
  schedule_timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  frequency VARCHAR(20) NOT NULL DEFAULT 'daily'
    CHECK (frequency IN ('every_15min', 'hourly', 'daily', 'weekly', 'monthly')),
  day_of_week INT, -- 0-6 for weekly jobs
  day_of_month INT, -- 1-31 for monthly jobs
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Execution tracking
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(20) DEFAULT 'pending'
    CHECK (last_run_status IN ('pending', 'running', 'success', 'failed')),
  last_run_duration_ms INT,
  last_error TEXT,
  consecutive_failures INT NOT NULL DEFAULT 0,
  -- Concurrency control
  claimed_at TIMESTAMPTZ,
  claimed_by VARCHAR(100),
  -- Metadata
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_business ON scheduled_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type ON scheduled_jobs(job_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_jobs_unique ON scheduled_jobs(business_id, job_type);

-- Job execution history (lightweight, for observability)
CREATE TABLE IF NOT EXISTS job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  business_id UUID NOT NULL,
  job_type VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  duration_ms INT,
  result JSONB,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_executions_job ON job_executions(job_id);
CREATE INDEX IF NOT EXISTS idx_job_executions_started ON job_executions(started_at DESC);
