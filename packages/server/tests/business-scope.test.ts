import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

/**
 * A request names the business it acts on (`business_id`). The server must check that the
 * caller may reach that business: until this was added, any signed-in user could read and
 * change another tenant's customers, services and bookings by passing that business's id.
 */
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SEED_BUSINESS_ID = '00000000-0000-0000-0000-000000000002';
const BUSINESS_OWNER = '00000000-0000-0000-0000-000000000010'; // works for the seeded business
const TENANT_OWNER = '00000000-0000-0000-0000-000000000021';
const SYSTEM_ADMIN = '00000000-0000-0000-0000-000000000020';
const PERMS = ['customers:*', 'services:*', 'bookings:*', 'settings:*', 'staff:*'];

let SIBLING_BUSINESS_ID: string;
let OTHER_TENANT_ID: string;
let OTHER_TENANT_BUSINESS_ID: string;
let OTHER_CUSTOMER_ID: string;
let ownerToken: string;
let tenantToken: string;
let systemToken: string;

function request(method: string, path: string, body?: any, token?: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        hostname: 'localhost', port: address.port, path, method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          server.close();
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(responseData) }); }
          catch { resolve({ statusCode: res.statusCode!, body: responseData }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Business scope of a request', () => {
  beforeAll(async () => {
    const { rows: sibling } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Scope Test Biz', 'scope-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [TENANT_ID],
    );
    SIBLING_BUSINESS_ID = sibling[0].id;

    const { rows: tenant } = await adminPool.query(
      `INSERT INTO sys_tenants (name, slug, status) VALUES ('Scope Test Tenant', 'scope-test-tenant', 'active')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    OTHER_TENANT_ID = tenant[0].id;
    const { rows: other } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Scope Other Tenant Test Biz', 'scope-other-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [OTHER_TENANT_ID],
    );
    OTHER_TENANT_BUSINESS_ID = other[0].id;
    const { rows: customer } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name)
       VALUES ($1, $2, 'CUST-SCOPE-1', 'scope-victim@example.com', 'Untouched', 'Person')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Untouched' RETURNING id`,
      [OTHER_TENANT_ID, OTHER_TENANT_BUSINESS_ID],
    );
    OTHER_CUSTOMER_ID = customer[0].id;

    ownerToken = authService.generateAccessToken(BUSINESS_OWNER, TENANT_ID, 'Business Owner', PERMS);
    tenantToken = authService.generateAccessToken(TENANT_OWNER, TENANT_ID, 'Tenant Owner', ['*:*']);
    systemToken = authService.generateAccessToken(SYSTEM_ADMIN, TENANT_ID, 'Super Admin', ['*:*']);
  });

  it('a business user reaches their own business', async () => {
    const res = await request('GET', `/api/v1/customers?business_id=${SEED_BUSINESS_ID}`, undefined, ownerToken);
    expect(res.statusCode).toBe(200);
  });

  it('a business user cannot read a business of another tenant', async () => {
    for (const path of ['/api/v1/customers', '/api/v1/services', '/api/v1/bookings', `/api/v1/customers/${OTHER_CUSTOMER_ID}`]) {
      const res = await request('GET', `${path}?business_id=${OTHER_TENANT_BUSINESS_ID}`, undefined, ownerToken);
      expect(res.statusCode, path).toBe(403);
      expect(res.body.code).toBe('BUSINESS_FORBIDDEN');
    }
  });

  it('a business user cannot change a record of another tenant', async () => {
    const inQuery = await request('PUT', `/api/v1/customers/${OTHER_CUSTOMER_ID}?business_id=${OTHER_TENANT_BUSINESS_ID}`, { first_name: 'Changed' }, ownerToken);
    expect(inQuery.statusCode).toBe(403);
    const inBody = await request('POST', '/api/v1/customers', { first_name: 'Planted', email: 'planted@example.com', business_id: OTHER_TENANT_BUSINESS_ID }, ownerToken);
    expect(inBody.statusCode).toBe(403);
    const { rows } = await adminPool.query('SELECT first_name FROM cus_customers WHERE id = $1', [OTHER_CUSTOMER_ID]);
    expect(rows[0].first_name).toBe('Untouched');
    const { rows: planted } = await adminPool.query(`SELECT 1 FROM cus_customers WHERE business_id = $1 AND email = 'planted@example.com'`, [OTHER_TENANT_BUSINESS_ID]);
    expect(planted.length).toBe(0);
  });

  it('a business user cannot reach a sibling business of the same tenant', async () => {
    for (const path of ['/api/v1/customers', '/api/v1/services', '/api/v1/bookings']) {
      const res = await request('GET', `${path}?business_id=${SIBLING_BUSINESS_ID}`, undefined, ownerToken);
      expect(res.statusCode, path).toBe(403);
    }
    const settings = await request('GET', `/api/v1/admin/businesses/${SIBLING_BUSINESS_ID}/settings`, undefined, ownerToken);
    expect(settings.statusCode).toBe(403);
  });

  it('a tenant user reaches every business of their tenant, and none of another', async () => {
    const own = await request('GET', `/api/v1/customers?business_id=${SIBLING_BUSINESS_ID}`, undefined, tenantToken);
    expect(own.statusCode).toBe(200);
    const other = await request('GET', `/api/v1/customers?business_id=${OTHER_TENANT_BUSINESS_ID}`, undefined, tenantToken);
    expect(other.statusCode).toBe(403);
  });

  it('a tenant user cannot move into another tenant with the context header', async () => {
    // The header is for system users only. Tenant owners hold "*:*" within their tenant, which
    // used to be enough to make the header work for them as well.
    const res = await request('GET', `/api/v1/customers?business_id=${OTHER_TENANT_BUSINESS_ID}`, undefined, tenantToken, { 'X-Context-Tenant-Id': OTHER_TENANT_ID });
    expect(res.statusCode).toBe(403);
  });

  it('a system user may look into any tenant', async () => {
    const res = await request('GET', `/api/v1/customers?business_id=${OTHER_TENANT_BUSINESS_ID}`, undefined, systemToken, { 'X-Context-Tenant-Id': OTHER_TENANT_ID });
    expect(res.statusCode).toBe(200);
  });

  it('a business that does not exist is refused, not treated as empty', async () => {
    const res = await request('GET', '/api/v1/customers?business_id=11111111-1111-4111-8111-111111111111', undefined, ownerToken);
    expect(res.statusCode).toBe(403);
  });
});

describe('Platform-only endpoints', () => {
  // Tenant owners hold '*:*' within their tenant. That used to open every endpoint guarded by
  // requirePermission('*:*'): all tenants, all users, platform configuration, platform billing,
  // and the query editor, which reads the whole database.
  const platformOnly: Array<[string, string, any?]> = [
    ['GET', '/api/v1/admin/tenants'],
    ['GET', '/api/v1/admin/users'],
    ['GET', '/api/v1/admin/reports/system-kpis'],
    ['GET', '/api/v1/admin/system-config/email'],
    ['GET', '/api/v1/admin/system-config/api-keys'],
    ['GET', '/api/v1/pay/platform-billing-schedule'],
    ['GET', '/api/v1/prospects/territories'],
    ['GET', '/api/v1/query-editor/schema'],
    ['POST', '/api/v1/query-editor/execute', { sql: 'select count(*) from usr_users' }],
  ];

  it('are refused to a tenant owner', async () => {
    for (const [method, path, body] of platformOnly) {
      const res = await request(method, path, body, tenantToken);
      expect(res.statusCode, method + ' ' + path).toBe(403);
    }
  });

  it('are refused to a business owner even if their token claimed every permission', async () => {
    const inflated = authService.generateAccessToken(BUSINESS_OWNER, TENANT_ID, 'Business Owner', ['*:*']);
    for (const [method, path, body] of platformOnly) {
      const res = await request(method, path, body, inflated);
      expect(res.statusCode, method + ' ' + path).toBe(403);
    }
  });

  it('are open to platform staff', async () => {
    for (const path of ['/api/v1/admin/tenants', '/api/v1/admin/users', '/api/v1/query-editor/schema']) {
      const res = await request('GET', path, undefined, systemToken);
      expect(res.statusCode, path).toBe(200);
    }
  });
});
