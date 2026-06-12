import { pool } from '../db/pool';
import { logger } from '../middleware/logger';
import { logAudit } from './audit.service';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

/**
 * Get a configuration value for a tenant.
 * Checks cache → tenant override → system default.
 */
export async function getConfig(tenantId: string, key: string): Promise<unknown> {
  // Check cache
  const cached = cache.get(cacheKey(tenantId, key));
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Check tenant override
  const { rows: overrideRows } = await pool.query(
    `SELECT tc.value, cd.data_type FROM tenant_configurations tc
     JOIN configuration_definitions cd ON cd.key = tc.key
     WHERE tc.tenant_id = $1 AND tc.key = $2`,
    [tenantId, key],
  );

  if (overrideRows.length > 0) {
    const parsed = parseValue(overrideRows[0].value, overrideRows[0].data_type);
    cache.set(cacheKey(tenantId, key), { value: parsed, expiresAt: Date.now() + CACHE_TTL });
    return parsed;
  }

  // Fall back to default
  const { rows: defaultRows } = await pool.query(
    'SELECT default_value, data_type FROM configuration_definitions WHERE key = $1',
    [key],
  );

  if (defaultRows.length === 0) {
    return undefined;
  }

  const parsed = parseValue(defaultRows[0].default_value, defaultRows[0].data_type);
  cache.set(cacheKey(tenantId, key), { value: parsed, expiresAt: Date.now() + CACHE_TTL });
  return parsed;
}

/**
 * Set a configuration value for a tenant.
 */
export async function setConfig(
  tenantId: string, key: string, value: unknown, userId: string,
): Promise<void> {
  // Validate the key exists
  const { rows: defRows } = await pool.query(
    'SELECT data_type FROM configuration_definitions WHERE key = $1',
    [key],
  );
  if (defRows.length === 0) {
    throw new Error(`Configuration key "${key}" does not exist`);
  }

  const stringValue = String(value);

  // Upsert tenant override
  await pool.query(
    `INSERT INTO tenant_configurations (tenant_id, key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, updated_by = $4, updated_at = NOW()`,
    [tenantId, key, stringValue, userId],
  );

  // Invalidate cache
  cache.delete(cacheKey(tenantId, key));

  // Audit log
  await logAudit({
    tenantId,
    userId,
    action: 'config.updated',
    resourceType: 'configuration',
    details: { key, value },
  });

  logger.info('Configuration updated', { tenantId, key, userId });
}

/**
 * Get all configuration for a tenant (defaults merged with overrides).
 */
export async function getAllConfig(tenantId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT cd.key, cd.data_type, cd.category, cd.description,
            COALESCE(tc.value, cd.default_value) AS value
     FROM configuration_definitions cd
     LEFT JOIN tenant_configurations tc ON tc.key = cd.key AND tc.tenant_id = $1
     ORDER BY cd.category, cd.key`,
    [tenantId],
  );

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = parseValue(row.value, row.data_type);
  }
  return result;
}

/**
 * Invalidate cache for a tenant (all keys or a specific key).
 */
export function invalidateCache(tenantId: string, key?: string): void {
  if (key) {
    cache.delete(cacheKey(tenantId, key));
  } else {
    for (const k of cache.keys()) {
      if (k.startsWith(`${tenantId}:`)) {
        cache.delete(k);
      }
    }
  }
}

function parseValue(value: string, dataType: string): unknown {
  switch (dataType) {
    case 'boolean': return value === 'true';
    case 'number': return Number(value);
    case 'json': try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}
