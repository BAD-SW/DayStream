import { adminPool } from '../db/pool';
import crypto from 'crypto';

/**
 * Get all API keys for a tenant (returns prefix only, never full key).
 */
export async function getApiKeys(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT id, tenant_id, name, key_prefix, scopes, rate_limit, is_active,
            last_used_at, expires_at, created_by, created_at
     FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a new API key. Returns the full key ONCE — it cannot be retrieved again.
 */
export async function createApiKey(tenantId: string, input: {
  name: string;
  scopes?: string[];
  rateLimit?: number;
  createdBy?: string;
}) {
  const rawKey = `dsk_live_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  const { rows } = await adminPool.query(
    `INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, rate_limit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, key_prefix, scopes, rate_limit, created_at`,
    [
      tenantId,
      input.name,
      keyHash,
      keyPrefix,
      JSON.stringify(input.scopes || ['*']),
      input.rateLimit || 1000,
      input.createdBy || null,
    ],
  );

  return { ...rows[0], key: rawKey };
}

/**
 * Delete an API key.
 */
export async function deleteApiKey(id: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Validate an API key. Returns tenant info and scopes, or null if invalid.
 */
export async function validateApiKey(rawKey: string) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const { rows } = await adminPool.query(
    `SELECT id, tenant_id, scopes, rate_limit, is_active, expires_at
     FROM api_keys WHERE key_hash = $1`,
    [keyHash],
  );

  if (rows.length === 0) return null;

  const key = rows[0];
  if (!key.is_active) return null;
  if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

  await recordUsage(key.id);

  return { tenantId: key.tenant_id, scopes: key.scopes, rateLimit: key.rate_limit };
}

/**
 * Record API key usage timestamp.
 */
export async function recordUsage(keyId: string) {
  await adminPool.query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    [keyId],
  );
}
