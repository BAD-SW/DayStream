import { PoolClient } from 'pg';
import { queryPool } from './query-pool';
import { logger } from '../../middleware/logger';

/**
 * Query Executor for the Query Editor.
 *
 * Executes validated SQL queries within tenant-scoped sessions with resource limits.
 * Enforces: statement_timeout, RLS context, row limits, user concurrency, and cancellation.
 */

export interface QueryExecutionRequest {
  sql: string;
  tenantId: string;
  userId: string;
  timeoutMs?: number; // default: 30000
  maxRows?: number; // default: 10000
}

export interface QueryExecutionResult {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  totalRowCount?: number;
  executionTimeMs: number;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  error?: string;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ROWS = 10000;

/** PostgreSQL error code for query_canceled (statement_timeout or pg_cancel_backend) */
const PG_QUERY_CANCELED = '57014';

/**
 * Tracks active queries per user.
 * Key: userId, Value: { client, pid } for cancellation support.
 */
interface ActiveQuery {
  client: PoolClient;
  pid: number;
}

const activeQueries = new Map<string, ActiveQuery>();

export class QueryExecutor {
  /**
   * Execute a validated SQL query within the tenant context.
   *
   * Flow:
   * 1. Acquire connection from queryPool (reject if pool exhausted)
   * 2. Check user concurrency (reject if user already has active query)
   * 3. SET LOCAL statement_timeout
   * 4. SET LOCAL app.current_tenant_id
   * 5. SET LOCAL app.current_user_id
   * 6. Execute query with LIMIT wrapper to detect truncation
   * 7. Detect truncation (maxRows+1 rows returned)
   * 8. Measure execution time
   * 9. On timeout (PG error code '57014'), return status='timeout'
   * 10. Release connection back to pool in a clean state
   */
  async execute(request: QueryExecutionRequest): Promise<QueryExecutionResult> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRows = request.maxRows ?? DEFAULT_MAX_ROWS;

    // Step 1: Check user concurrency before acquiring connection
    if (activeQueries.has(request.userId)) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        executionTimeMs: 0,
        status: 'error',
        error: 'CONCURRENT_LIMIT: You already have a query running. Wait for it to complete or cancel it.',
      };
    }

    // Step 2: Acquire connection from pool
    let client: PoolClient;
    try {
      client = await queryPool.connect();
    } catch (err: any) {
      logger.error('Failed to acquire query pool connection', { error: err.message });
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        executionTimeMs: 0,
        status: 'error',
        error: 'CAPACITY_REACHED: System is at capacity. Please retry in a moment.',
      };
    }

    // Get the backend PID for cancellation support
    let pid: number;
    try {
      const pidResult = await client.query('SELECT pg_backend_pid() AS pid');
      pid = pidResult.rows[0].pid;
    } catch (err: any) {
      client.release();
      logger.error('Failed to get backend PID', { error: err.message });
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        executionTimeMs: 0,
        status: 'error',
        error: 'Failed to initialize query session.',
      };
    }

    // Register active query for concurrency tracking and cancellation
    activeQueries.set(request.userId, { client, pid });

    const startTime = Date.now();

    try {
      // Step 3: Begin transaction and set LOCAL parameters
      await client.query('BEGIN');

      // Set statement_timeout
      await client.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);

      // Step 4: Set tenant and user context for RLS
      await client.query(`SET LOCAL app.current_tenant_id = '${request.tenantId}'`);
      await client.query(`SET LOCAL app.current_user_id = '${request.userId}'`);

      // Step 5: Execute query with LIMIT wrapper to detect truncation
      // We request maxRows + 1 to detect if there are more rows than the limit
      const wrappedSql = `SELECT * FROM (${request.sql}) AS __query_result LIMIT ${maxRows + 1}`;

      const result = await client.query(wrappedSql);

      const executionTimeMs = Date.now() - startTime;

      // Step 6: Extract column metadata from query result
      const columns: ColumnMeta[] = (result.fields || []).map((field) => ({
        name: field.name,
        dataType: mapDataTypeOid(field.dataTypeID),
      }));

      // Step 7: Detect truncation
      const truncated = result.rows.length > maxRows;
      const rows = truncated ? result.rows.slice(0, maxRows) : result.rows;

      // Commit the read-only transaction to cleanly release the connection
      await client.query('COMMIT');

      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        totalRowCount: truncated ? undefined : rows.length,
        executionTimeMs,
        status: 'success',
      };
    } catch (err: any) {
      const executionTimeMs = Date.now() - startTime;

      // Rollback to clean up the connection state
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors — connection will be discarded by pool
      }

      // Step 8: Handle timeout (PostgreSQL error code '57014')
      if (err.code === PG_QUERY_CANCELED) {
        // Distinguish between cancellation and timeout
        // If the user explicitly cancelled, the activeQueries entry may already be removed
        const wasCancelled = !activeQueries.has(request.userId);

        return {
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          executionTimeMs,
          status: wasCancelled ? 'cancelled' : 'timeout',
        };
      }

      // Generic query error
      logger.error('Query execution error', {
        userId: request.userId,
        tenantId: request.tenantId,
        error: err.message,
        code: err.code,
      });

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        executionTimeMs,
        status: 'error',
        error: sanitizeErrorMessage(err.message),
      };
    } finally {
      // Step 9: Release connection and clean up active query tracking
      activeQueries.delete(request.userId);
      client.release();
    }
  }

  /**
   * Cancel the active query for a given user.
   * Uses pg_cancel_backend to send a cancel signal to the running query.
   *
   * @returns true if cancellation was requested, false if no active query found
   */
  async cancel(userId: string): Promise<boolean> {
    const active = activeQueries.get(userId);
    if (!active) {
      return false;
    }

    try {
      // Remove from active queries before cancelling so the error handler
      // can distinguish between user cancellation and timeout
      activeQueries.delete(userId);

      // Use a separate connection to send the cancel signal
      const cancelClient = await queryPool.connect();
      try {
        await cancelClient.query('SELECT pg_cancel_backend($1)', [active.pid]);
      } finally {
        cancelClient.release();
      }

      logger.info('Query cancelled', { userId, pid: active.pid });
      return true;
    } catch (err: any) {
      logger.error('Failed to cancel query', {
        userId,
        pid: active.pid,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Check if a user currently has an active query.
   */
  hasActiveQuery(userId: string): boolean {
    return activeQueries.has(userId);
  }
}

/**
 * Map PostgreSQL data type OIDs to human-readable type names.
 * Common types only — falls back to 'unknown' for unrecognized OIDs.
 */
function mapDataTypeOid(oid: number): string {
  const oidMap: Record<number, string> = {
    16: 'boolean',
    20: 'bigint',
    21: 'smallint',
    23: 'integer',
    25: 'text',
    700: 'real',
    701: 'double precision',
    1043: 'varchar',
    1082: 'date',
    1114: 'timestamp',
    1184: 'timestamptz',
    1700: 'numeric',
    2950: 'uuid',
    3802: 'jsonb',
    114: 'json',
    1009: 'text[]',
    1015: 'varchar[]',
    1016: 'bigint[]',
    1007: 'integer[]',
  };

  return oidMap[oid] || 'unknown';
}

/**
 * Sanitize PostgreSQL error messages to avoid leaking internal details.
 * Removes file paths, internal function names, and stack trace information.
 */
function sanitizeErrorMessage(message: string): string {
  if (!message) return 'An unexpected error occurred.';

  // Remove file paths (e.g., /path/to/file.c:123)
  let sanitized = message.replace(/\/[\w/.-]+\.[a-z]+:\d+/g, '');

  // Remove internal function references
  sanitized = sanitized.replace(/\bat \w+\(\)/g, '');

  // Trim excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized || 'An unexpected error occurred.';
}
