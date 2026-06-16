import pg from 'pg';
import { config } from '../../config';

const { Pool } = pg;

/**
 * Dedicated read-only connection pool for the Query Editor.
 * Uses the `daystream_query_reader` role with SELECT-only privileges.
 * Separate from the main application pool to prevent resource contention
 * and enforce read-only access at the database level.
 *
 * Environment variables (with fallbacks):
 * - DB_QUERY_HOST → DB_HOST
 * - DB_QUERY_PORT → DB_PORT
 * - DB_QUERY_USER → 'daystream_query_reader'
 * - DB_QUERY_PASSWORD → 'daystream_query_reader_dev'
 * - DB_QUERY_NAME → DB_NAME
 * - DB_QUERY_POOL_MAX → 5
 */
export const queryPool = new Pool({
  host: process.env.DB_QUERY_HOST || config.db.host,
  port: parseInt(process.env.DB_QUERY_PORT || String(config.db.port), 10),
  user: process.env.DB_QUERY_USER || 'daystream_query_reader',
  password: process.env.DB_QUERY_PASSWORD || 'daystream_query_reader_dev',
  database: process.env.DB_QUERY_NAME || config.db.database,
  max: parseInt(process.env.DB_QUERY_POOL_MAX || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

queryPool.on('error', (err) => {
  console.error('Unexpected query pool error:', err.message);
});
