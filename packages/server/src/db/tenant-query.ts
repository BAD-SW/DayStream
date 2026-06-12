import { pool } from './pool';
import { QueryResult } from 'pg';

/**
 * Execute a query scoped to a tenant.
 * Sets the PostgreSQL session variable for RLS, executes the query,
 * then resets the variable before releasing the client back to the pool.
 */
export async function tenantQuery(
  tenantId: string,
  text: string,
  values?: unknown[],
): Promise<QueryResult> {
  const client = await pool.connect();
  try {
    await client.query(`SET app.current_tenant_id = '${tenantId}'`);
    const result = await client.query(text, values);
    return result;
  } finally {
    await client.query("RESET app.current_tenant_id").catch(() => {});
    client.release();
  }
}

/**
 * Execute multiple queries within a transaction, scoped to a tenant.
 */
export async function tenantTransaction<T>(
  tenantId: string,
  fn: (query: (text: string, values?: unknown[]) => Promise<QueryResult>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET app.current_tenant_id = '${tenantId}'`);
    await client.query('BEGIN');
    const result = await fn((text, values) => client.query(text, values));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query("RESET app.current_tenant_id").catch(() => {});
    client.release();
  }
}
