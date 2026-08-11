import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';
import { jobRegistry } from './job-registry';

const POLL_INTERVAL_MS = 60_000; // Check every 60 seconds
const BATCH_SIZE = 5; // Pick up max 5 jobs per poll cycle
const INTER_JOB_DELAY_MS = 200; // 200ms pause between jobs
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — if a job is claimed longer, it's considered stale
const MAX_CONSECUTIVE_FAILURES = 5; // Disable job after 5 consecutive failures

let pollHandle: ReturnType<typeof setInterval> | null = null;
const instanceId = `worker-${process.pid}-${Date.now()}`;

/**
 * Start the job scheduler poller.
 * Checks the database every minute for jobs that are due and executes them.
 */
export function startJobScheduler(): void {
  if (pollHandle) {
    logger.warn('Job scheduler already running');
    return;
  }

  logger.info(`Job scheduler started (instance: ${instanceId}, poll: ${POLL_INTERVAL_MS}ms)`);

  // Start polling
  pollHandle = setInterval(pollAndExecute, POLL_INTERVAL_MS);

  // Also run once after a short startup delay
  setTimeout(pollAndExecute, 10_000);
}

/**
 * Stop the job scheduler.
 */
export function stopJobScheduler(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    logger.info('Job scheduler stopped');
  }
}


/**
 * Core poll cycle: find due jobs, claim them, execute one at a time.
 */
async function pollAndExecute(): Promise<void> {
  try {
    // Release stale claims (jobs that were claimed but never completed)
    await adminPool.query(
      `UPDATE sys_scheduled_jobs SET claimed_at = NULL, claimed_by = NULL, last_run_status = 'failed'
       WHERE claimed_at IS NOT NULL AND claimed_at < NOW() - INTERVAL '${CLAIM_TIMEOUT_MS} milliseconds'`,
    );

    // Pick up due jobs using SKIP LOCKED (non-blocking, no contention)
    const { rows: dueJobs } = await adminPool.query(
      `UPDATE sys_scheduled_jobs
       SET claimed_at = NOW(), claimed_by = $1, last_run_status = 'running'
       WHERE id IN (
         SELECT id FROM sys_scheduled_jobs
         WHERE enabled = true
           AND next_run_at <= NOW()
           AND claimed_at IS NULL
           AND consecutive_failures < $2
         ORDER BY next_run_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, business_id, tenant_id, job_type, config, schedule_time, schedule_timezone, frequency, day_of_week, day_of_month`,
      [instanceId, MAX_CONSECUTIVE_FAILURES, BATCH_SIZE],
    );

    if (dueJobs.length === 0) return;

    logger.info(`Job scheduler: picked up ${dueJobs.length} job(s)`);

    // Execute each job sequentially with delays between
    for (const job of dueJobs) {
      await executeJob(job);
      // Yield between jobs to avoid resource hogging
      await sleep(INTER_JOB_DELAY_MS);
    }
  } catch (err: any) {
    logger.error('Job scheduler poll error', { error: err.message });
  }
}

/**
 * Execute a single job, record results, calculate next run.
 */
async function executeJob(job: any): Promise<void> {
  const startTime = Date.now();
  let executionId: string | null = null;

  try {
    // Record execution start
    const { rows } = await adminPool.query(
      `INSERT INTO sys_job_executions (job_id, business_id, job_type, started_at, status)
       VALUES ($1, $2, $3, NOW(), 'running') RETURNING id`,
      [job.id, job.business_id, job.job_type],
    );
    executionId = rows[0]?.id;

    // Get the handler from the registry
    const handler = jobRegistry[job.job_type];
    if (!handler) {
      throw new Error(`Unknown job type: ${job.job_type}`);
    }

    // Execute the handler
    const result = await handler({
      businessId: job.business_id,
      tenantId: job.tenant_id,
      config: job.config || {},
    });

    const durationMs = Date.now() - startTime;

    // Mark success
    const nextRun = calculateNextRun(job);
    await adminPool.query(
      `UPDATE sys_scheduled_jobs
       SET last_run_at = NOW(), last_run_status = 'success', last_run_duration_ms = $1,
           last_error = NULL, consecutive_failures = 0,
           claimed_at = NULL, claimed_by = NULL,
           next_run_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [durationMs, nextRun, job.id],
    );

    // Update execution record
    if (executionId) {
      await adminPool.query(
        `UPDATE sys_job_executions SET completed_at = NOW(), status = 'success', duration_ms = $1, result = $2 WHERE id = $3`,
        [durationMs, JSON.stringify(result || {}), executionId],
      );
    }

    logger.info(`Job complete: ${job.job_type} for business ${job.business_id} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - startTime;

    // Mark failure
    const nextRun = calculateNextRun(job);
    await adminPool.query(
      `UPDATE sys_scheduled_jobs
       SET last_run_at = NOW(), last_run_status = 'failed', last_run_duration_ms = $1,
           last_error = $2, consecutive_failures = consecutive_failures + 1,
           claimed_at = NULL, claimed_by = NULL,
           next_run_at = $3, updated_at = NOW()
       WHERE id = $4`,
      [durationMs, err.message, nextRun, job.id],
    ).catch(() => {});

    // Update execution record
    if (executionId) {
      await adminPool.query(
        `UPDATE sys_job_executions SET completed_at = NOW(), status = 'failed', duration_ms = $1, error = $2 WHERE id = $3`,
        [durationMs, err.message, executionId],
      ).catch(() => {});
    }

    logger.error(`Job failed: ${job.job_type} for business ${job.business_id}`, { error: err.message });
  }
}


/**
 * Calculate the next run time based on the job's schedule and timezone.
 * Handles timezone-aware scheduling so "2 AM" means 2 AM in the business's timezone.
 */
function calculateNextRun(job: any): string {
  const tz = job.schedule_timezone || 'UTC';
  const time = job.schedule_time || '02:00';
  const frequency = job.frequency || 'daily';
  const [hours, minutes] = time.split(':').map(Number);

  const now = new Date();

  // Get current time in the business's timezone
  const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  
  let nextRun: Date;

  if (frequency === 'every_15min') {
    // Next 15-minute mark
    nextRun = new Date(now.getTime() + 15 * 60 * 1000);
  } else if (frequency === 'hourly') {
    // Next hour at the specified minutes
    nextRun = new Date(nowInTz);
    nextRun.setMinutes(minutes, 0, 0);
    if (nextRun <= nowInTz) nextRun.setHours(nextRun.getHours() + 1);
  } else if (frequency === 'daily') {
    // Tomorrow at the specified time
    nextRun = new Date(nowInTz);
    nextRun.setHours(hours, minutes, 0, 0);
    if (nextRun <= nowInTz) nextRun.setDate(nextRun.getDate() + 1);
  } else if (frequency === 'weekly') {
    // Next occurrence of any of the specified days
    nextRun = new Date(nowInTz);
    nextRun.setHours(hours, minutes, 0, 0);
    const targetDays: number[] = Array.isArray(job.day_of_week) ? job.day_of_week : [job.day_of_week ?? 1];
    // Find the smallest positive offset to a target day
    let minOffset = 8;
    for (const targetDay of targetDays) {
      let offset = (targetDay - nextRun.getDay() + 7) % 7;
      if (offset === 0 && nextRun <= nowInTz) offset = 7;
      if (offset < minOffset) minOffset = offset;
    }
    if (minOffset === 0 && nextRun > nowInTz) { /* today, still in the future */ }
    else nextRun.setDate(nextRun.getDate() + (minOffset || 1));
  } else if (frequency === 'monthly') {
    // Next occurrence of the specified day of month (-1 = last day)
    nextRun = new Date(nowInTz);
    nextRun.setHours(hours, minutes, 0, 0);
    const targetDay = job.day_of_month ?? 1;
    if (targetDay === -1) {
      // Last day of current month
      nextRun.setMonth(nextRun.getMonth() + 1, 0); // day 0 = last day of previous month
      if (nextRun <= nowInTz) {
        // Move to last day of next month
        nextRun.setMonth(nextRun.getMonth() + 2, 0);
      }
    } else {
      nextRun.setDate(targetDay);
      if (nextRun <= nowInTz) nextRun.setMonth(nextRun.getMonth() + 1);
    }
  } else {
    // Fallback: tomorrow
    nextRun = new Date(nowInTz);
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setHours(hours, minutes, 0, 0);
  }

  // Convert back to UTC for storage
  // Calculate offset between local and timezone
  const utcOffset = now.getTime() - nowInTz.getTime();
  const nextRunUtc = new Date(nextRun.getTime() + utcOffset);

  return nextRunUtc.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
