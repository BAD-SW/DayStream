import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import { pool } from '../src/db/pool';
import * as authService from '../src/services/auth.service';

// Helper to make HTTP requests to the app
function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: address.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ statusCode: res.statusCode!, body: JSON.parse(responseData) });
          } catch {
            resolve({ statusCode: res.statusCode!, body: responseData });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Tenant Provisioning API', () => {
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  let adminToken: string;

  beforeAll(async () => {
    // Generate a super admin token for testing
    adminToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', // owner user
      TENANT_ID,
      'Super Admin',
      ['*:*'],
    );
  });

  it('creates a new tenant with owner', async () => {
    const slug = `test-tenant-${Date.now()}`;
    const { statusCode, body } = await request('POST', '/api/v1/admin/tenants', {
      name: 'Test Provisioning Tenant',
      slug,
      owner_email: `owner-${Date.now()}@test.example`,
      owner_first_name: 'Jane',
      owner_last_name: 'Doe',
      owner_password: 'Str0ngP@ss!xyz',
      currency: 'USD',
      timezone: 'America/New_York',
    }, adminToken);

    expect(statusCode).toBe(201);
    expect(body.data.tenant.name).toBe('Test Provisioning Tenant');
    expect(body.data.tenant.slug).toBe(slug);
    expect(body.data.tenant.currency).toBe('USD');
    expect(body.data.owner.email).toContain('@test.example');

    // Clean up
    await pool.query('DELETE FROM user_roles WHERE tenant_id = $1', [body.data.tenant.id]);
    await pool.query('DELETE FROM roles WHERE tenant_id = $1', [body.data.tenant.id]);
    await pool.query('DELETE FROM users WHERE tenant_id = $1', [body.data.tenant.id]);
    await pool.query('DELETE FROM tenants WHERE id = $1', [body.data.tenant.id]);
  });

  it('rejects duplicate slug', async () => {
    // 'transcend' already exists from seed
    const { statusCode, body } = await request('POST', '/api/v1/admin/tenants', {
      name: 'Duplicate Test',
      slug: 'transcend',
      owner_email: 'dup@test.example',
      owner_first_name: 'Test',
      owner_last_name: 'User',
      owner_password: 'Str0ngP@ss!xyz',
    }, adminToken);

    expect(statusCode).toBe(409);
    expect(body.code).toBe('SLUG_EXISTS');
  });

  it('requires super admin permission', async () => {
    // Generate a non-admin token
    const staffToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000012',
      TENANT_ID,
      'Staff',
      ['bookings:read'],
    );

    const { statusCode } = await request('POST', '/api/v1/admin/tenants', {
      name: 'Unauthorized',
      slug: 'unauthorized',
      owner_email: 'unauth@test.example',
      owner_first_name: 'No',
      owner_last_name: 'Access',
      owner_password: 'Str0ngP@ss!xyz',
    }, staffToken);

    expect(statusCode).toBe(403);
  });

  it('lists all tenants', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/admin/tenants', undefined, adminToken);
    expect(statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('slug');
  });

  it('gets tenant by ID', async () => {
    const { statusCode, body } = await request('GET', `/api/v1/admin/tenants/${TENANT_ID}`, undefined, adminToken);
    expect(statusCode).toBe(200);
    expect(body.data.id).toBe(TENANT_ID);
    expect(body.data.name).toBe('Transcend Health Mallorca');
  });

  it('returns 401 without token', async () => {
    const { statusCode } = await request('GET', '/api/v1/admin/tenants');
    expect(statusCode).toBe(401);
  });
});
