import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let STAFF_USER_ID: string;
let STAFF_USER_ID_2: string;
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

describe('Service Staff Assignment API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Staff Assign Test Biz', 'staff-assign-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Staff Assign Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM service_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Create category + service + variant
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Staff Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO services (business_id, category_id, name, slug, created_by)
       VALUES ($1, $2, 'Staff Test Service', 'staff-test-service', '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO service_variants (service_id, name, duration, price) VALUES ($1, '60 min', 60, 7500) RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    // Create staff users
    const { rows: staff1 } = await adminPool.query(
      `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ('00000000-0000-0000-0000-000000000050', $1, 'staff1-assign@example.com', 'Sarah', 'Therapist', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Sarah'
       RETURNING id`,
      [TENANT_ID],
    );
    STAFF_USER_ID = staff1[0].id;

    const { rows: staff2 } = await adminPool.query(
      `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ('00000000-0000-0000-0000-000000000051', $1, 'staff2-assign@example.com', 'Mike', 'Trainer', 'hashed', 'trainer', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Mike'
       RETURNING id`,
      [TENANT_ID],
    );
    STAFF_USER_ID_2 = staff2[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /services/:id/staff', () => {
    it('assigns staff to a service', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/staff`,
        { user_id: STAFF_USER_ID, is_primary: true },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.user_id).toBe(STAFF_USER_ID);
      expect(body.data.is_primary).toBe(true);
      expect(body.data.variant_id).toBeNull();
    });

    it('assigns staff to a specific variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/staff`,
        { user_id: STAFF_USER_ID_2, variant_id: VARIANT_ID, is_primary: false },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.variant_id).toBe(VARIANT_ID);
    });

    it('rejects duplicate assignment', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/staff`,
        { user_id: STAFF_USER_ID },
        ownerToken,
      );

      expect(statusCode).toBe(409);
      expect(body.code).toBe('DUPLICATE');
    });
  });

  describe('GET /services/:id/staff', () => {
    it('lists assigned staff with user details', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/${SERVICE_ID}/staff`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(2);
      // Primary first
      expect(body.data[0].is_primary).toBe(true);
      expect(body.data[0].first_name).toBe('Sarah');
      expect(body.data[1].first_name).toBe('Mike');
    });
  });

  describe('DELETE /services/:id/staff/:userId', () => {
    it('removes a variant-specific assignment', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/staff/${STAFF_USER_ID_2}?variant_id=${VARIANT_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.removed).toBe(true);
    });

    it('removes a general assignment', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/staff/${STAFF_USER_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.removed).toBe(true);
    });

    it('returns 404 for non-existent assignment', async () => {
      const { statusCode } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/staff/00000000-0000-0000-0000-999999999999`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });
});
