-- Spec 51, gap 18 (owner, 23 Nov 2026): moving long-past appointment history to file storage runs
-- once per tenant, at the time the tenant chooses in its own time zone (not one run for the whole
-- platform, which would land in some businesses' opening hours; not per business, which would be
-- forgotten). It processes every business of the tenant. Each tenant starts with the job on, at
-- 03:00 in the tenant's time zone (else the one most of its businesses use), after 12 months; the
-- tenant can change it on its Processes page.
BEGIN;
DELETE FROM sys_scheduled_jobs WHERE job_type = 'booking_history_archive' AND scope_level = 'platform';

-- The first run: the next 03:00 in that time zone (the scheduler keeps it there after each run).
INSERT INTO sys_scheduled_jobs (scope_level, business_id, tenant_id, job_type, schedule_time, schedule_timezone, frequency, enabled, next_run_at, config)
SELECT 'tenant', NULL, x.id, 'booking_history_archive', '03:00', x.tz, 'daily', true,
       CASE WHEN (date_trunc('day', NOW() AT TIME ZONE x.tz) + TIME '03:00') > (NOW() AT TIME ZONE x.tz)
            THEN (date_trunc('day', NOW() AT TIME ZONE x.tz) + TIME '03:00') AT TIME ZONE x.tz
            ELSE (date_trunc('day', NOW() AT TIME ZONE x.tz) + INTERVAL '1 day' + TIME '03:00') AT TIME ZONE x.tz END,
       '{"months": 12, "batch": 500}'::jsonb
  FROM (SELECT t.id, COALESCE(NULLIF(t.timezone, ''), (SELECT b.timezone FROM sys_businesses b WHERE b.tenant_id = t.id AND b.timezone IS NOT NULL
                                GROUP BY b.timezone ORDER BY COUNT(*) DESC, b.timezone LIMIT 1), 'UTC') AS tz
          FROM sys_tenants t) x
ON CONFLICT (tenant_id, job_type) WHERE scope_level = 'tenant' DO NOTHING;
COMMIT;
