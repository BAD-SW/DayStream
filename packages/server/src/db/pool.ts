import pg from 'pg';
import { config } from '../config';

const { Pool } = pg;

// Managed hosts (Neon, etc.) hand out one connection string that requires SSL; local
// Postgres uses discrete DB_HOST/PORT/USER/PASSWORD/NAME and no SSL. RLS-based per-role
// connections were removed post-migration-#43 (tenant isolation is application-level
// now), so DATABASE_URL is used identically for both pools below — there's no remaining
// reason for `pool` and `adminPool` to authenticate differently when one is supplied.
const baseOptions = config.databaseUrl
  ? { connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } }
  : { host: config.db.host, port: config.db.port, database: config.db.database };

/**
 * Main application pool.
 * Uses DB_APP_USER/DB_APP_PASSWORD if set (non-superuser role for RLS enforcement).
 * Falls back to DB_USER/DB_PASSWORD for backwards compatibility.
 */
export const pool = new Pool({
  ...baseOptions,
  ...(config.databaseUrl ? {} : {
    user: process.env.DB_APP_USER || config.db.user,
    password: process.env.DB_APP_PASSWORD || config.db.password,
  }),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

/**
 * Admin pool — uses the superuser credentials for migrations and seeds.
 * Only use this in scripts, never in request handlers.
 */
export const adminPool = new Pool({
  ...baseOptions,
  ...(config.databaseUrl ? {} : { user: config.db.user, password: config.db.password }),
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
