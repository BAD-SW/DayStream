import { logger } from '../middleware/logger';

/**
 * System-email queue drainer.
 *
 * A lightweight interval poller (separate from the calendar job-scheduler, which
 * runs date-scheduled daily jobs) that drains apt_notification_queue frequently so
 * transactional mail goes out promptly. Dispatch, claim safety, rate limiting, and
 * retry/backoff all live in processNotificationQueue; this just invokes it on a
 * cadence. Non-overlapping: a slow run won't stack with the next tick.
 */

const DEFAULT_INTERVAL_MS = 60_000;   // drain once a minute

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;   // don't overlap a still-running drain
  running = true;
  try {
    const { processNotificationQueue } = await import('../services/booking-notifications.service');
    await processNotificationQueue();
  } catch (err: any) {
    logger.error('Email queue drain failed', { error: err?.message || err });
  } finally {
    running = false;
  }
}

/** Start the email-queue drainer (idempotent). */
export function startEmailQueueScheduler(intervalMs?: number): void {
  if (intervalHandle) {
    logger.warn('Email queue scheduler already running');
    return;
  }
  const interval = intervalMs
    || parseInt(process.env.EMAIL_QUEUE_INTERVAL_MS || '', 10) || DEFAULT_INTERVAL_MS;
  logger.info(`Email queue scheduler started (interval: ${interval}ms)`);
  intervalHandle = setInterval(tick, interval);
}

/** Stop the email-queue drainer. */
export function stopEmailQueueScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Email queue scheduler stopped');
  }
}
