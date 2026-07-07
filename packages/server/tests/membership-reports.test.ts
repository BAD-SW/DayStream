import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let ownerToken: string;

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

describe('Membership Reports API', () => {
  beforeAll(async () => {
    // Use a business that already has memberships from prior tests
    const { rows } = await adminPool.query(
      `SELECT id FROM sys_businesses WHERE tenant_id = $1 AND slug = 'membership-test-biz'`,
      [TENANT_ID],
    );
    BUSINESS_ID = rows.length > 0 ? rows[0].id : '00000000-0000-0000-0000-000000000001';

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  it('GET /memberships/reports/summary returns metrics', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/memberships/reports/summary?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data).toHaveProperty('total_active');
    expect(body.data).toHaveProperty('new_this_month');
    expect(body.data).toHaveProperty('cancelled_this_month');
    expect(body.data).toHaveProperty('renewal_rate');
    expect(body.data).toHaveProperty('by_type');
    expect(body.data).toHaveProperty('by_plan');
    expect(typeof body.data.total_active).toBe('number');
  });

  it('GET /memberships/reports/churn returns cancellation data', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/memberships/reports/churn?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data).toHaveProperty('cancellations');
    expect(body.data).toHaveProperty('average_duration_days');
    expect(body.data).toHaveProperty('total_churned');
  });

  it('GET /memberships/reports/credits returns utilization', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/memberships/reports/credits?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data).toHaveProperty('total_allocated');
    expect(body.data).toHaveProperty('total_deducted');
    expect(body.data).toHaveProperty('total_expired');
    expect(body.data).toHaveProperty('utilization_rate');
    expect(typeof body.data.utilization_rate).toBe('number');
  });
});
