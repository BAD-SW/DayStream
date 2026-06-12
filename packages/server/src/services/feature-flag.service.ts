import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface FlagContext {
  tenantId: string;
  role?: string;
}

interface FlagRow {
  id: string;
  key: string;
  scope: string;
  enabled: boolean;
  percentage: number | null;
}

// In-memory cache for flags (refreshed every 5 minutes)
let flagCache: FlagRow[] | null = null;
let flagCacheExpiry = 0;
const FLAG_CACHE_TTL = 5 * 60 * 1000;

async function loadFlags(): Promise<FlagRow[]> {
  if (flagCache && Date.now() < flagCacheExpiry) {
    return flagCache;
  }
  const { rows } = await adminPool.query('SELECT id, key, scope, enabled, percentage FROM feature_flags');
  flagCache = rows;
  flagCacheExpiry = Date.now() + FLAG_CACHE_TTL;
  return rows;
}

/**
 * Deterministic hash for percentage-based evaluation.
 * Same tenant + flag always gets the same result.
 */
function deterministicHash(input: string): number {
  const hash = crypto.createHash('md5').update(input).digest();
  return hash.readUInt32BE(0) % 100;
}

/**
 * Check if a feature flag is enabled for the given context.
 */
export async function isFeatureEnabled(flagKey: string, context: FlagContext): Promise<boolean> {
  const flags = await loadFlags();
  const flag = flags.find((f) => f.key === flagKey);

  if (!flag) return false;

  switch (flag.scope) {
    case 'global':
      return flag.enabled;

    case 'tenant': {
      // Check for tenant-specific override
      const { rows } = await adminPool.query(
        'SELECT enabled FROM feature_flag_overrides WHERE flag_id = $1 AND tenant_id = $2',
        [flag.id, context.tenantId],
      );
      if (rows.length > 0) return rows[0].enabled;
      return flag.enabled;
    }

    case 'percentage': {
      if (!flag.percentage) return false;
      const hash = deterministicHash(context.tenantId + flagKey);
      return hash < flag.percentage;
    }

    default:
      return flag.enabled;
  }
}

/**
 * Get all feature flags evaluated for a tenant context.
 * Returns a key→boolean map suitable for sending to the frontend.
 */
export async function evaluateAllFlags(context: FlagContext): Promise<Record<string, boolean>> {
  const flags = await loadFlags();
  const result: Record<string, boolean> = {};

  for (const flag of flags) {
    result[flag.key] = await isFeatureEnabled(flag.key, context);
  }

  return result;
}

/**
 * Invalidate the flag cache (call after flag updates).
 */
export function invalidateFlagCache(): void {
  flagCache = null;
  flagCacheExpiry = 0;
}
