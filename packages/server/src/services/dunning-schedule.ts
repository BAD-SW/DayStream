import { adminPool } from '../db/pool';

/**
 * Dunning retry schedule (spec 10-payment-platform, Requirement C6.2).
 *
 * The configurable per-business retry schedule, kept in its own module so both
 * the renewal path (which opens the first attempt) and the dunning path (which
 * drives subsequent retries) can read it without importing each other.
 *
 * Stored under the business config key `dunning.retry_days` as either a JSON array
 * or a comma-separated list of day-offsets after the original failure (e.g.
 * `[1,3,7]`). The number of entries is the maximum number of retries before the
 * membership is expired. Falls back to the platform default when unset/invalid.
 */
export const DEFAULT_RETRY_DAYS = [1, 3, 7];

export async function getRetrySchedule(businessId: string): Promise<number[]> {
  const { rows } = await adminPool.query(
    `SELECT value FROM sys_business_configurations WHERE business_id = $1 AND key = 'dunning.retry_days'`,
    [businessId],
  );
  const raw = rows[0]?.value;
  if (!raw) return DEFAULT_RETRY_DAYS;
  try {
    const parsed = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(',').map((s: string) => s.trim());
    const days = (parsed as unknown[])
      .map((v) => parseInt(String(v), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return days.length > 0 ? days : DEFAULT_RETRY_DAYS;
  } catch {
    return DEFAULT_RETRY_DAYS;
  }
}
