import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
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

describe('Customer Communication Preferences API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Prefs Test Biz', 'prefs-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Prefs Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-PREF01', 'prefs-test@example.com', 'Prefs', 'Test', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Prefs'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Ensure default preferences exist
    await adminPool.query(
      'INSERT INTO cus_preferences (customer_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [CUSTOMER_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  it('GET /customers/:id/preferences returns defaults', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/customers/${CUSTOMER_ID}/preferences?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.email_marketing).toBe(false);
    expect(body.data.sms_marketing).toBe(false);
    expect(body.data.booking_reminders).toBe(true);
  });

  it('PUT /customers/:id/preferences updates preferences', async () => {
    const { statusCode, body } = await request(
      'PUT', `/api/v1/customers/${CUSTOMER_ID}/preferences?business_id=${BUSINESS_ID}`,
      { email_marketing: true, sms_marketing: true },
      ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.email_marketing).toBe(true);
    expect(body.data.sms_marketing).toBe(true);
    expect(body.data.booking_reminders).toBe(true); // unchanged
  });

  it('returns 404 for non-existent customer', async () => {
    const { statusCode } = await request(
      'GET', `/api/v1/customers/00000000-0000-0000-0000-999999999999/preferences?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );
    expect(statusCode).toBe(404);
  });

  it('requires business_id', async () => {
    const { statusCode } = await request(
      'GET', `/api/v1/customers/${CUSTOMER_ID}/preferences`,
      undefined, ownerToken,
    );
    expect(statusCode).toBe(400);
  });
});
