import pg from 'pg';
import { config } from '../config';

const { Pool } = pg;

/**
 * Main application pool.
 * Uses DB_APP_USER/DB_APP_PASSWORD if set (non-superuser role for RLS enforcement).
 * Falls back to DB_USER/DB_PASSWORD for backwards compatibility.
 */
export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: process.env.DB_APP_USER || config.db.user,
  password: process.env.DB_APP_PASSWORD || config.db.password,
  database: config.db.database,
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
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
