-- Migration 134: provision the automatic payment-reconciliation job.
--
-- Finalizing async (bank-draw) customer charges is a background correctness
-- mechanism, not a billing action, so it does NOT belong on the per-business
-- daily billing_process run. It needs to happen on its own, frequently, and
-- without any per-business setup.
--
-- One PLATFORM-scoped job (scope_level='platform', no tenant/business) runs every
-- 15 minutes and sweeps EVERY business that has a pending processed charge
-- (payment_reconciliation handler -> reconcileAllPendingPayments). This way a
-- business never has to configure anything: as soon as it has a pending bank
-- draw, the next sweep picks it up. Bank debits settle over days, so a 15-minute
-- cadence makes a cleared debit visible in DayStream well within the hour while
-- keeping provider API load trivial.
--
-- The platform unique index on job_type (migration 117) guarantees at most one
-- such job; ON CONFLICT DO NOTHING keeps this migration safe to re-run.

BEGIN;

INSERT INTO sys_scheduled_jobs
  (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone,
   frequency, enabled, next_run_at)
VALUES
  ('platform', NULL, NULL, 'payment_reconciliation', '00:00', 'UTC',
   'every_15min', true, NOW())
ON CONFLICT (job_type) WHERE scope_level = 'platform' DO NOTHING;

COMMIT;
