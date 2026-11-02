import crypto from 'crypto';
import { adminPool } from '../db/pool';
import { ColumnFilters, FilterableColumn, addColumnFilterConditions, columnValuesSql } from '../utils/column-filters';
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
      `INSERT INTO usr_audit_log (tenant_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, signature, previous_signature)
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
 * Write an entry to the audit log with HMAC chain integrity.
 * Unlike logAudit, this function throws on failure (fail-closed).
 * Used by security-critical paths like the Query Editor where audit
 * failure must block the operation.
 */
export async function logAuditStrict(entry: AuditEntry): Promise<void> {
  const signature = signEntry(entry, lastSignature);

  await adminPool.query(
    `INSERT INTO usr_audit_log (tenant_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, signature, previous_signature)
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
}

// The audit log's filterable columns (keys as the table's columns). Days are in UTC.
const AUDIT_COLUMNS: Record<string, FilterableColumn> = {
  created_at: { expr: 'a.created_at', kind: 'date' },
  action: { expr: 'a.action' },
  resource_type: { expr: 'a.resource_type' },
  user_email: { expr: 'a.user_id', label: '(SELECT u2.email FROM usr_users u2 WHERE u2.id::text = a.user_id::text)' },
  tenant_name: { expr: 'a.tenant_id', label: '(SELECT t2.name FROM sys_tenants t2 WHERE t2.id::text = a.tenant_id::text)' },
};

/** Every value of one audit log column (with counts) among the entries matching the other filters. */
export async function auditColumnValues(tenantId: string, column: string, columns: ColumnFilters) {
  const col = AUDIT_COLUMNS[column];
  if (!col || col.kind === 'date') return [];
  const conditions = ['a.tenant_id = $1']; const params: any[] = [tenantId];
  addColumnFilterConditions(columns, AUDIT_COLUMNS, conditions, params, "'UTC'", column);
  const { rows } = await adminPool.query(columnValuesSql(col, 'usr_audit_log a', conditions.join(' AND ')), params);
  return rows as Array<{ value: string; label: string; count: number }>;
}

/**
 * Query audit log with filters and pagination.
 * Joins users and tenants tables to return human-readable names.
 */
export async function queryAuditLog(
  tenantId: string,
  filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: string;
    endDate?: string;
    /** Column filters of the shared table (David, 2026-11-02). */
    columns?: ColumnFilters;
    page?: number;
    limit?: number;
  },
) {
  const conditions = ['a.tenant_id = $1'];
  const params: any[] = [tenantId];
  let paramIndex = 2;

  if (filters.userId) {
    conditions.push(`a.user_id = $${paramIndex++}`);
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`a.action ILIKE $${paramIndex++}`);
    params.push(`%${filters.action}%`);
  }
  if (filters.resourceType) {
    conditions.push(`a.resource_type = $${paramIndex++}`);
    params.push(filters.resourceType);
  }
  if (filters.startDate) {
    conditions.push(`a.created_at >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`a.created_at <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  if (filters.columns) { addColumnFilterConditions(filters.columns, AUDIT_COLUMNS, conditions, params, "'UTC'"); paramIndex = params.length + 1; }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 50, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT a.*, u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name, t.name as tenant_name
       FROM usr_audit_log a
       LEFT JOIN usr_users u ON a.user_id::uuid = u.id
       LEFT JOIN sys_tenants t ON a.tenant_id::uuid = t.id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset],
    ),
    adminPool.query(`SELECT COUNT(*) AS total FROM usr_audit_log a WHERE ${where}`, params),
  ]);

  return {
    entries: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Query the audit log for entries ABOUT a specific resource (e.g. all changes to
 * a given tenant), regardless of which tenant scope the acting user belonged to.
 * Used by the tenant Audit Trail, where a platform admin acts ON a tenant.
 * Returns paged, newest-first, with the acting user's name resolved.
 */
export async function queryResourceAudit(
  resourceType: string,
  resourceId: string,
  filters: { page?: number; limit?: number } = {},
) {
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 100);
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT a.id, a.action, a.resource_type, a.resource_id, a.details, a.created_at,
              u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name
       FROM usr_audit_log a
       LEFT JOIN usr_users u ON a.user_id::uuid = u.id
       WHERE a.resource_type = $1 AND a.resource_id = $2
       ORDER BY a.created_at DESC
       LIMIT $3 OFFSET $4`,
      [resourceType, resourceId, limit, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*) AS total FROM usr_audit_log WHERE resource_type = $1 AND resource_id = $2`,
      [resourceType, resourceId],
    ),
  ]);

  return {
    entries: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}
