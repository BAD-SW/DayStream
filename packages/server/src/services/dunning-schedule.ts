import { adminPool } from '../db/pool';

/**
 * Membership renewal retry parameters (spec 10-payment-platform, Requirement C6/C6a).
 *
 * When a membership renewal charge fails, the enrollment goes to `renewing` and is
 * retried automatically as part of the Membership Renewals process. The retry
 * behaviour is configured PER BUSINESS as:
 *   - retry COUNT          — the maximum number of automatic retries, and
 *   - retry INTERVAL DAYS  — the number of days between retries (and before the first).
 *
 * e.g. count=3, interval=2 → retry on day 2, day 4, day 6 after the failure, then
 * expire the enrollment if still failing.
 *
 * Stored in business configuration under:
 *   - `dunning.retry_count`
 *   - `dunning.retry_interval_days`
 *
 * Backward compatibility: the earlier model stored a day-offset array under
 * `dunning.retry_days` (e.g. `[1,3,7]`). If the count/interval keys are unset but a
 * legacy offset array exists, it is honoured. The platform default is 3 retries, 3
 * days apart (equivalent to the old `[3,6,9]`-style cadence).
 */
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_INTERVAL_DAYS = 3;
/** Legacy default offset array, kept so older callers/tests still resolve a schedule. */
export const DEFAULT_RETRY_DAYS = [1, 3, 7];

export interface RetryParams {
  count: number;            // max automatic retries
  intervalDays: number;     // days between retries
}

async function getConfig(businessId: string, key: string): Promise<string | null> {
  const { rows } = await adminPool.query(
    `SELECT value FROM sys_business_configurations WHERE business_id = $1 AND key = $2`,
    [businessId, key],
  );
  const v = rows[0]?.value;
  return v == null ? null : String(v);
}

/**
 * The business's configured retry parameters (count + interval days). Falls back to
 * the platform default, deriving from a legacy `dunning.retry_days` array if that is
 * the only thing set.
 */
export async function getRetryParams(businessId: string): Promise<RetryParams> {
  const [countRaw, intervalRaw] = await Promise.all([
    getConfig(businessId, 'dunning.retry_count'),
    getConfig(businessId, 'dunning.retry_interval_days'),
  ]);

  const count = parseInt(String(countRaw), 10);
  const interval = parseInt(String(intervalRaw), 10);
  if (Number.isFinite(count) && count > 0 && Number.isFinite(interval) && interval > 0) {
    return { count, intervalDays: interval };
  }

  // Legacy fallback: derive from a stored day-offset array if present.
  const legacy = await getLegacyOffsets(businessId);
  if (legacy) {
    const gaps = legacy.slice(1).map((d, i) => d - legacy[i]).filter((g) => g > 0);
    const avgGap = gaps.length ? Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : legacy[0] || DEFAULT_RETRY_INTERVAL_DAYS;
    return { count: legacy.length, intervalDays: avgGap };
  }

  return { count: DEFAULT_RETRY_COUNT, intervalDays: DEFAULT_RETRY_INTERVAL_DAYS };
}

/** Persist the retry parameters for a business. */
export async function saveRetryParams(businessId: string, params: RetryParams): Promise<RetryParams> {
  const count = Math.max(1, Math.min(10, Math.floor(params.count)));
  const intervalDays = Math.max(1, Math.min(90, Math.floor(params.intervalDays)));
  for (const [key, value] of [
    ['dunning.retry_count', String(count)],
    ['dunning.retry_interval_days', String(intervalDays)],
  ] as const) {
    await adminPool.query(
      `INSERT INTO sys_business_configurations (business_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (business_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [businessId, key, value],
    );
  }
  return { count, intervalDays };
}

async function getLegacyOffsets(businessId: string): Promise<number[] | null> {
  const raw = await getConfig(businessId, 'dunning.retry_days');
  if (!raw) return null;
  try {
    const parsed = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(',').map((s) => s.trim());
    const days = (parsed as unknown[])
      .map((v) => parseInt(String(v), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

/**
 * The retry schedule as day-offsets after the original failure (e.g. count=3,
 * interval=2 → [2,4,6]). The number of entries is the max retries before expiry.
 * A legacy `dunning.retry_days` array, if set, is used verbatim.
 *
 * Kept so the renewal path (opens attempt #1) and the dunning path (schedules
 * subsequent retries / decides exhaustion) share one source of truth.
 */
export async function getRetrySchedule(businessId: string): Promise<number[]> {
  const legacy = await getLegacyOffsets(businessId);
  // Honor an explicit legacy array ONLY when count/interval aren't configured.
  const [countRaw, intervalRaw] = await Promise.all([
    getConfig(businessId, 'dunning.retry_count'),
    getConfig(businessId, 'dunning.retry_interval_days'),
  ]);
  const hasNew = countRaw != null && intervalRaw != null;
  if (legacy && !hasNew) return legacy;

  const { count, intervalDays } = await getRetryParams(businessId);
  return Array.from({ length: count }, (_, i) => intervalDays * (i + 1));
}
