import { adminPool } from '../../db/pool';
import { logger } from '../../middleware/logger';

const MAX_QUERY_TEXT_LENGTH = 10_000;
const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_PURGE_DAYS = 90;

export interface QueryHistoryEntry {
  id: string;
  userId: string;
  tenantId: string;
  queryText: string;
  executionTimeMs: number;
  rowCount: number;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  createdAt: string;
}

type RecordInput = Omit<QueryHistoryEntry, 'id' | 'createdAt'>;

export class QueryHistoryService {
  /**
   * Record a query history entry.
   * Truncates queryText to 10,000 characters if it exceeds that length.
   */
  async record(entry: RecordInput): Promise<void> {
    const truncatedText =
      entry.queryText.length > MAX_QUERY_TEXT_LENGTH
        ? entry.queryText.slice(0, MAX_QUERY_TEXT_LENGTH)
        : entry.queryText;

    try {
      await adminPool.query(
        `INSERT INTO sys_query_history (tenant_id, user_id, query_text, execution_time_ms, row_count, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.tenantId,
          entry.userId,
          truncatedText,
          entry.executionTimeMs,
          entry.rowCount,
          entry.status,
        ],
      );
    } catch (err: any) {
      logger.error('Failed to record query history', { error: err.message });
      throw err;
    }
  }

  /**
   * List query history entries for a user within a tenant.
   * Returns the most recent entries (default 100), optionally filtered
   * by case-insensitive substring search on query text.
   */
  async list(
    userId: string,
    tenantId: string,
    options: { search?: string; limit?: number } = {},
  ): Promise<QueryHistoryEntry[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT);
    const conditions = ['user_id = $1', 'tenant_id = $2'];
    const params: unknown[] = [userId, tenantId];
    let paramIndex = 3;

    if (options.search) {
      conditions.push(`query_text ILIKE $${paramIndex}`);
      params.push(`%${options.search}%`);
      paramIndex++;
    }

    params.push(limit);

    const where = conditions.join(' AND ');
    const { rows } = await adminPool.query(
      `SELECT id, user_id, tenant_id, query_text, execution_time_ms, row_count, status, created_at
       FROM sys_query_history
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIndex}`,
      params,
    );

    return rows.map(mapRowToEntry);
  }

  /**
   * Purge history entries older than the specified number of days.
   * Returns the number of deleted entries.
   */
  async purgeOlderThan(days: number = DEFAULT_PURGE_DAYS): Promise<number> {
    const { rowCount } = await adminPool.query(
      `DELETE FROM sys_query_history WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [days],
    );

    logger.info('Purged query history entries', { days, deletedCount: rowCount });
    return rowCount ?? 0;
  }
}

function mapRowToEntry(row: any): QueryHistoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    queryText: row.query_text,
    executionTimeMs: row.execution_time_ms,
    rowCount: row.row_count,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
