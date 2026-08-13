-- Add payroll frequency and reference date to business settings

BEGIN;

ALTER TABLE sys_businesses ADD COLUMN IF NOT EXISTS pay_frequency VARCHAR(20) DEFAULT 'monthly'
  CHECK (pay_frequency IN ('weekly', 'biweekly', 'semi_monthly', 'monthly'));
ALTER TABLE sys_businesses ADD COLUMN IF NOT EXISTS pay_period_start_date DATE;

COMMIT;
