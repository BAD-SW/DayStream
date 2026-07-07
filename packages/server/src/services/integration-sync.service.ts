import { adminPool } from '../db/pool';

/**
 * Get all integration connections for a tenant.
 */
export async function getConnections(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM int_connections WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a new integration connection.
 */
export async function createConnection(tenantId: string, input: {
  userId?: string;
  integrationType: string;
  provider: string;
  config?: Record<string, any>;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO int_connections (tenant_id, user_id, integration_type, provider, config)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, input.userId || null, input.integrationType, input.provider, JSON.stringify(input.config || {})],
  );
  return rows[0];
}

/**
 * Disconnect (soft-delete) an integration connection.
 */
export async function disconnectConnection(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE int_connections SET status = 'disconnected', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId],
  );
  return rows[0] || null;
}

/**
 * Get sync log entries for a connection.
 */
export async function getSyncLog(connectionId: string, limit = 50) {
  const { rows } = await adminPool.query(
    `SELECT * FROM int_sync_log WHERE connection_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [connectionId, limit],
  );
  return rows;
}

/**
 * Log a sync operation.
 */
export async function logSync(connectionId: string, input: {
  operation: string;
  direction: 'outbound' | 'inbound';
  resourceType?: string;
  resourceId?: string;
  status: 'success' | 'failed' | 'retrying';
  errorMessage?: string;
  details?: Record<string, any>;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO int_sync_log (connection_id, operation, direction, resource_type, resource_id, status, error_message, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      connectionId,
      input.operation,
      input.direction,
      input.resourceType || null,
      input.resourceId || null,
      input.status,
      input.errorMessage || null,
      input.details ? JSON.stringify(input.details) : null,
    ],
  );
  return rows[0];
}

/**
 * Trigger a sync for a connection (placeholder — logs the attempt).
 */
export async function triggerSync(connectionId: string) {
  await logSync(connectionId, {
    operation: 'sync_triggered',
    direction: 'outbound',
    status: 'success',
    details: { triggeredAt: new Date().toISOString() },
  });

  await adminPool.query(
    `UPDATE int_connections SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [connectionId],
  );

  return { triggered: true, connectionId };
}

/**
 * Handle a sync failure — increments error_count and pauses if threshold reached.
 */
export async function handleSyncFailure(connectionId: string, error: string) {
  const { rows } = await adminPool.query(
    `UPDATE int_connections
     SET error_count = error_count + 1, last_error = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [connectionId, error],
  );

  const connection = rows[0];
  if (!connection) return null;

  // Pause connection if error threshold reached
  if (connection.error_count >= 5) {
    await adminPool.query(
      `UPDATE int_connections SET status = 'error', updated_at = NOW() WHERE id = $1`,
      [connectionId],
    );
  }

  await logSync(connectionId, {
    operation: 'sync_failure',
    direction: 'inbound',
    status: 'failed',
    errorMessage: error,
  });

  return connection;
}
