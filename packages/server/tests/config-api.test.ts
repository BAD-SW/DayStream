import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

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

describe('Configuration API', () => {
  let ownerToken: string;

  beforeAll(() => {
    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010',
      TENANT_ID,
      'Business Owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  it('GET /api/v1/admin/config lists all configuration', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/admin/config', undefined, ownerToken);
    expect(statusCode).toBe(200);
    expect(body.data).toHaveProperty('brand.primary_color');
    expect(body.data).toHaveProperty('feature.online_booking');
  });

  it('GET /api/v1/admin/config/:key returns specific value', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/admin/config/brand.primary_color', undefined, ownerToken);
    expect(statusCode).toBe(200);
    expect(body.data.key).toBe('brand.primary_color');
    expect(body.data.value).toBeDefined();
  });

  it('PUT /api/v1/admin/config/:key updates value', async () => {
    const { statusCode, body } = await request('PUT', '/api/v1/admin/config/brand.primary_color', { value: '#FF0000' }, ownerToken);
    expect(statusCode).toBe(200);
    expect(body.data.value).toBe('#FF0000');

    // Verify it persisted
    const { body: getBody } = await request('GET', '/api/v1/admin/config/brand.primary_color', undefined, ownerToken);
    expect(getBody.data.value).toBe('#FF0000');

    // Reset
    await request('PUT', '/api/v1/admin/config/brand.primary_color', { value: '#C9A96E' }, ownerToken);
  });

  it('returns 404 for unknown key', async () => {
    const { statusCode } = await request('GET', '/api/v1/admin/config/nonexistent.key', undefined, ownerToken);
    expect(statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { statusCode } = await request('GET', '/api/v1/admin/config');
    expect(statusCode).toBe(401);
  });
});

describe('Feature Flag API', () => {
  let ownerToken: string;
  let adminToken: string;

  beforeAll(() => {
    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010',
      TENANT_ID,
      'Business Owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
    adminToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010',
      TENANT_ID,
      'Super Admin',
      ['*:*'],
    );
  });

  it('GET /api/v1/admin/feature-flags returns evaluated flags', async () => {
    const { statusCode, body } = await request('GET', '/api/v1/admin/feature-flags', undefined, ownerToken);
    expect(statusCode).toBe(200);
    expect(body.data).toHaveProperty('feature.online_booking');
  });

  it('PUT /api/v1/admin/feature-flags/:key updates global flag (admin only)', async () => {
    const { statusCode, body } = await request(
      'PUT', '/api/v1/admin/feature-flags/feature.loyalty_points',
      { enabled: true }, adminToken,
    );
    expect(statusCode).toBe(200);
    expect(body.data.enabled).toBe(true);

    // Reset
    await request('PUT', '/api/v1/admin/feature-flags/feature.loyalty_points', { enabled: false }, adminToken);
  });

  it('PUT /api/v1/admin/feature-flags/:key/override sets tenant override', async () => {
    const { statusCode, body } = await request(
      'PUT', '/api/v1/admin/feature-flags/feature.two_way_sms/override',
      { enabled: true }, ownerToken,
    );
    expect(statusCode).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.scope).toBe('tenant');
  });

  it('rejects global flag update from non-admin', async () => {
    const { statusCode } = await request(
      'PUT', '/api/v1/admin/feature-flags/feature.loyalty_points',
      { enabled: true }, ownerToken,
    );
    expect(statusCode).toBe(403);
  });
});
