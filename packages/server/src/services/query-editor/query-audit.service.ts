import { logAuditStrict } from '../audit.service';
import { logger } from '../../middleware/logger';

/**
 * Query editor audit event types.
 */
export type QueryAuditAction =
  | 'query_execute'
  | 'query_validate_reject'
  | 'query_cancel'
  | 'query_timeout'
  | 'query_access_granted'
  | 'query_access_denied';

/**
 * Represents an audit event for query editor operations.
 * IMPORTANT: Never include actual row data — only metadata like row count, column count.
 */
export interface QueryAuditEvent {
  userId: string;
  tenantId: string;
  action: QueryAuditAction;
  queryText?: string;
  executionTimeMs?: number;
  rowCount?: number;
  status?: string;
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Strips any potential result data from metadata to ensure only safe
 * metadata (counts, timing, status) is stored in audit entries.
 */
function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  // Only allow known safe metadata keys
  const safeKeys = [
    'rowCount',
    'columnCount',
    'executionTimeMs',
    'truncated',
    'status',
    'elapsedTimeMs',
    'cause',
    'rejectionReason',
    'violatedRule',
    'queryLength',
    'ipAddress',
    'userAgent',
  ];

  const sanitized: Record<string, unknown> = {};
  for (const key of safeKeys) {
    if (key in metadata) {
      sanitized[key] = metadata[key];
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * QueryAuditService wraps the platform AuditService with query-editor-specific
 * methods. It enforces fail-closed semantics: if an audit write fails, the error
 * propagates so the caller can reject the query.
 *
 * Requirements covered:
 * - 1.4: Log every access attempt (granted/denied)
 * - 11.1: Log executions with user_id, tenant_id, query text, duration, row count, status
 * - 11.2: Log validation rejections with user_id, tenant_id, query text, rejection reason
 * - 11.3: Log cancellations/timeouts with elapsed time and cause
 * - 11.4: Never store actual result data (only metadata)
 * - 11.5: Follow HMAC signature format from Phase 02
 * - 11.6: Support filtering by query editor activity
 * - 11.7: Fail-closed — reject query if audit write fails
 */
export class QueryAuditService {
  /**
   * Log a query execution event. Called after a query completes (success, error, timeout).
   * Throws if audit write fails (fail-closed per Requirement 11.7).
   */
  async logExecution(event: QueryAuditEvent): Promise<void> {
    this.assertNoResultData(event);

    const details: Record<string, unknown> = {
      queryText: event.queryText,
      executionTimeMs: event.executionTimeMs,
      rowCount: event.rowCount,
      status: event.status,
      ...sanitizeMetadata(event.metadata),
    };

    await this.writeAuditEntry({
      tenantId: event.tenantId,
      userId: event.userId,
      action: event.action,
      resourceType: 'query_editor',
      details,
    });
  }

  /**
   * Log a statement validation rejection.
   * Throws if audit write fails (fail-closed per Requirement 11.7).
   */
  async logValidationRejection(event: QueryAuditEvent): Promise<void> {
    this.assertNoResultData(event);

    const details: Record<string, unknown> = {
      queryText: event.queryText,
      rejectionReason: event.rejectionReason,
      ...sanitizeMetadata(event.metadata),
    };

    await this.writeAuditEntry({
      tenantId: event.tenantId,
      userId: event.userId,
      action: 'query_validate_reject',
      resourceType: 'query_editor',
      details,
    });
  }

  /**
   * Log an access attempt (granted or denied).
   * Throws if audit write fails (fail-closed per Requirement 11.7).
   */
  async logAccess(event: QueryAuditEvent): Promise<void> {
    this.assertNoResultData(event);

    const details: Record<string, unknown> = {
      ...sanitizeMetadata(event.metadata),
    };

    await this.writeAuditEntry({
      tenantId: event.tenantId,
      userId: event.userId,
      action: event.action,
      resourceType: 'query_editor',
      details,
    });
  }

  /**
   * Log a query cancellation or timeout event.
   * Throws if audit write fails (fail-closed per Requirement 11.7).
   */
  async logCancellation(event: QueryAuditEvent): Promise<void> {
    this.assertNoResultData(event);

    const details: Record<string, unknown> = {
      queryText: event.queryText,
      elapsedTimeMs: event.executionTimeMs,
      cause: event.action === 'query_timeout' ? 'timeout' : 'user_cancellation',
      ...sanitizeMetadata(event.metadata),
    };

    await this.writeAuditEntry({
      tenantId: event.tenantId,
      userId: event.userId,
      action: event.action,
      resourceType: 'query_editor',
      details,
    });
  }

  /**
   * Write an audit entry using the platform AuditService.
   * FAIL-CLOSED: If the write fails, the error is thrown (not swallowed)
   * so the calling code can reject the query execution.
   *
   * This overrides the default AuditService behavior which silently logs failures.
   */
  private async writeAuditEntry(entry: {
    tenantId: string;
    userId: string;
    action: string;
    resourceType: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      await logAuditStrict({
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        details: entry.details,
      });
    } catch (error: any) {
      logger.error('Query audit write failed (fail-closed)', {
        action: entry.action,
        userId: entry.userId,
        tenantId: entry.tenantId,
        error: error.message,
      });
      throw new Error(`Audit logging failed: unable to process query at this time`);
    }
  }

  /**
   * Safety check: ensure no actual result data (rows) is included in the event.
   * Only metadata (row count, column count, timing) is permitted.
   */
  private assertNoResultData(event: QueryAuditEvent): void {
    if (event.metadata) {
      const forbidden = ['rows', 'data', 'results', 'resultSet', 'result_data'];
      for (const key of forbidden) {
        if (key in event.metadata) {
          logger.warn('Attempted to include result data in audit entry — stripped', {
            action: event.action,
            forbiddenKey: key,
          });
          delete event.metadata[key];
        }
      }
    }
  }
}
