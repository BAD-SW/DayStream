-- Convert day_of_week from single INT to INT[] to support multiple days for weekly schedules

BEGIN;

ALTER TABLE sys_scheduled_jobs
  ALTER COLUMN day_of_week TYPE INT[]
  USING CASE WHEN day_of_week IS NOT NULL THEN ARRAY[day_of_week] ELSE NULL END;

COMMIT;
