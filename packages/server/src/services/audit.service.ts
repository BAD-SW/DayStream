import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

interface AuditEntry {
  tenantId: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

let lastSignature: string | null = null;

function getAuditKey(): string {
  return process.env.AUDIT_SIGNING_KEY || process.env.JWT_SECRET || 'dev-audit-key';
}

function signEntry(entry: AuditEntry, previousSignature: string | null): string {
  const payload = JSON.stringify({ ...entry, previous_signature: previousSignature });
  return crypto.createHmac('sha256', getAuditKey()).update(payload).digest('hex');
}

/**
 * Write an entry to the audit log with HMAC chain integrity.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const signature = signEntry(entry, lastSignature);

    await adminPool.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, signature, previous_signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.tenantId,
        entry.userId || null,
        entry.action,
        entry.resourceType || null,
        entry.resourceId || null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress || null,
        entry.userAgent || null,
        signature,
        lastSignature,
      ],
    );

    lastSignature = signature;
  } catch (err: any) {
    // Audit logging failures must not impact request processing
    logger.error('Audit log write failed', { error: err.message, action: entry.action });
  }
}

/**
 * Query audit log with filters and pagination.
 */
export async function queryAuditLog(
  tenantId: string,
  filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  },
) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let paramIndex = 2;

  if (filters.userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(filters.action);
  }
  if (filters.resourceType) {
    conditions.push(`resource_type = $${paramIndex++}`);
    params.push(filters.resourceType);
  }
  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 50, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset],
    ),
    pool.query(`SELECT COUNT(*) AS total FROM audit_log WHERE ${where}`, params),
  ]);

  return {
    entries: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}
