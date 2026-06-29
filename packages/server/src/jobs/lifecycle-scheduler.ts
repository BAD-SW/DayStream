import { evaluateScheduledTransitions } from '../services/customer-lifecycle.service';
import { logger } from '../middleware/logger';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the lifecycle evaluation scheduled job.
 * Runs evaluateScheduledTransitions at the configured interval (default: daily).
 */
export function startLifecycleScheduler(intervalMs?: number): void {
  const interval = intervalMs || parseInt(process.env.LIFECYCLE_EVAL_INTERVAL_MS || '', 10) || DEFAULT_INTERVAL_MS;

  if (intervalHandle) {
    logger.warn('Lifecycle scheduler already running');
    return;
  }

  logger.info(`Starting lifecycle scheduler (interval: ${interval}ms)`);

  // Schedule recurring runs (no auto-run on startup to avoid unwanted transitions during development)
  intervalHandle = setInterval(async () => {
    try {
      const result = await evaluateScheduledTransitions();
      logger.info('Scheduled lifecycle evaluation complete', result);
    } catch (err: any) {
      logger.error('Scheduled lifecycle evaluation failed', { error: err.message });
    }
  }, interval);
}

/**
 * Stop the lifecycle evaluation scheduled job.
 */
export function stopLifecycleScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Lifecycle scheduler stopped');
  }
}

/**
 * Run lifecycle evaluation once (for manual/CLI invocation).
 */
export async function runOnce(): Promise<void> {
  logger.info('Running one-time lifecycle evaluation...');
  const result = await evaluateScheduledTransitions();
  logger.info('Lifecycle evaluation complete', result);
}

// If invoked directly as a script: run once and exit
if (require.main === module) {
  runOnce()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
