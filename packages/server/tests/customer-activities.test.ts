import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as activityService from '../src/services/customer-activity.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
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

describe('Customer Activity Timeline API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Activity Test Biz', 'activity-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Activity Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-7001', 'activity-test@example.com', 'Activity', 'Test', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Activity'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );

    // Seed some activities
    await activityService.createActivity({ customerId: CUSTOMER_ID, businessId: BUSINESS_ID, activityType: 'booking', description: 'Booked: Swedish Massage', metadata: { service: 'massage' } });
    await activityService.createActivity({ customerId: CUSTOMER_ID, businessId: BUSINESS_ID, activityType: 'payment', description: 'Payment: €45.00', metadata: { amount: 4500 } });
    await activityService.createActivity({ customerId: CUSTOMER_ID, businessId: BUSINESS_ID, activityType: 'lifecycle', description: 'Stage: Lead → Trial', metadata: { from: 'lead', to: 'trial' } });
  });

  it('returns paginated activities', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/customers/${CUSTOMER_ID}/activities?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(3);
    expect(body.meta.total).toBeGreaterThanOrEqual(3);
    // Most recent first
    const dates = body.data.map((a: any) => new Date(a.created_at).getTime());
    expect(dates[0]).toBeGreaterThanOrEqual(dates[dates.length - 1]);
  });

  it('filters by activity type', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/customers/${CUSTOMER_ID}/activities?business_id=${BUSINESS_ID}&activity_type=booking`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.every((a: any) => a.activity_type === 'booking')).toBe(true);
  });

  it('supports pagination', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/customers/${CUSTOMER_ID}/activities?business_id=${BUSINESS_ID}&limit=1&page=1`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.meta.totalPages).toBeGreaterThanOrEqual(3);
  });

  it('requires business_id', async () => {
    const { statusCode } = await request(
      'GET', `/api/v1/customers/${CUSTOMER_ID}/activities`,
      undefined, ownerToken,
    );
    expect(statusCode).toBe(400);
  });
});
