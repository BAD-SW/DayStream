import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, adminPool } from '../src/db/pool';
import { tenantQuery } from '../src/db/tenant-query';

const TENANT_A = '00000000-0000-0000-0000-000000000001'; // seed tenant
const TENANT_B_ID = '00000000-0000-0000-0000-000000000099';

describe('Tenant Isolation (RLS)', () => {
  beforeAll(async () => {
    // Use admin pool for test setup (bypasses RLS)
    await adminPool.query(
      `INSERT INTO sys_tenants (id, name, slug, status) VALUES ($1, 'Isolation Test Tenant', 'isolation-test', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_B_ID],
    );
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ('00000000-0000-0000-0000-000000000099', $1, 'user@tenantb.test', 'Tenant', 'B', 'hash', 'customer', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_B_ID],
    );
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM usr_users WHERE tenant_id = $1', [TENANT_B_ID]);
    await adminPool.query('DELETE FROM sys_tenants WHERE id = $1', [TENANT_B_ID]);
  });

  it('tenantQuery returns only rows for the specified tenant', async () => {
    const result = await tenantQuery(TENANT_A, 'SELECT * FROM usr_users WHERE tenant_id = $1', [TENANT_A]);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.tenant_id).toBe(TENANT_A);
    }
  });

  it('tenantQuery with tenant A cannot see tenant B users', async () => {
    const result = await tenantQuery(TENANT_A, 'SELECT * FROM usr_users');
    const tenantBRows = result.rows.filter((r) => r.tenant_id === TENANT_B_ID);
    expect(tenantBRows.length).toBe(0);
  });

  it('tenantQuery with tenant B cannot see tenant A users', async () => {
    const result = await tenantQuery(TENANT_B_ID, 'SELECT * FROM usr_users');
    const tenantARows = result.rows.filter((r) => r.tenant_id === TENANT_A);
    expect(tenantARows.length).toBe(0);
  });

  it('tenantQuery with tenant B only sees its own users', async () => {
    const result = await tenantQuery(TENANT_B_ID, 'SELECT * FROM usr_users');
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.tenant_id).toBe(TENANT_B_ID);
    }
  });
});
