import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as lifecycleService from '../src/services/booking-lifecycle.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let BOOKING_ID: string;
let BOOKING_ID_2: string;
let BOOKING_ID_3: string;
let CUSTOMER_ID: string;
let STAFF_ID: string;
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

describe('Booking Lifecycle', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Lifecycle BK Test Biz', 'lifecycle-bk-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Lifecycle BK Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Create service infrastructure
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'LC BK Cat')
       ON CONFLICT (business_id, name, parent_id) DO UPDATE SET name = 'LC BK Cat' RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, default_duration, booking_type, created_by)
       VALUES ($1, $2, 'LC BK Service', 'lc-bk-service', 'active', 60, 'individual', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, slug) DO UPDATE SET name = 'LC BK Service' RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    const serviceId = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active')
       ON CONFLICT DO NOTHING RETURNING id`,
      [serviceId],
    );
    const variantId = varRows.length > 0 ? varRows[0].id : (await adminPool.query(
      "SELECT id FROM svc_variants WHERE service_id = $1 LIMIT 1", [serviceId]
    )).rows[0].id;

    STAFF_ID = '00000000-0000-0000-0000-000000000080';
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'lc-bk-staff@example.com', 'LC', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'LC'`,
      [STAFF_ID, TENANT_ID],
    );

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-LCBK', 'lc-bk-cust@example.com', 'LC', 'Customer', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'LC'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Create test bookings directly
    const baseTime = new Date();
    baseTime.setUTCDate(baseTime.getUTCDate() + 10);

    // Booking 1: confirmed (for full lifecycle test)
    const t1 = new Date(baseTime); t1.setUTCHours(10, 0, 0, 0);
    const { rows: bk1 } = await adminPool.query(
      `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'BK-LC-0001', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, booking_reference) DO UPDATE SET status = 'confirmed'
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, serviceId, variantId, STAFF_ID, t1.toISOString(), new Date(t1.getTime() + 60*60*1000).toISOString()],
    );
    BOOKING_ID = bk1[0].id;

    // Booking 2: confirmed (for cancel test)
    const t2 = new Date(baseTime); t2.setUTCHours(12, 0, 0, 0);
    const { rows: bk2 } = await adminPool.query(
      `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'BK-LC-0002', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, booking_reference) DO UPDATE SET status = 'confirmed'
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, serviceId, variantId, STAFF_ID, t2.toISOString(), new Date(t2.getTime() + 60*60*1000).toISOString()],
    );
    BOOKING_ID_2 = bk2[0].id;

    // Booking 3: confirmed, start time in the past (for no-show test)
    const pastTime = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    const { rows: bk3 } = await adminPool.query(
      `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'BK-LC-0003', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, booking_reference) DO UPDATE SET status = 'confirmed', start_time = $6
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, serviceId, variantId, STAFF_ID, pastTime.toISOString(), new Date(pastTime.getTime() + 60*60*1000).toISOString()],
    );
    BOOKING_ID_3 = bk3[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('Valid transitions', () => {
    it('confirmed → in_progress (check-in)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}/check-in?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('in_progress');
    });

    it('in_progress → completed', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}/complete?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('completed');
    });

    it('confirmed → cancelled (with reason)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID_2}/cancel?business_id=${BUSINESS_ID}`,
        { reason: 'Customer requested' },
        ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('cancelled');
      expect(body.data.cancellation_reason).toBe('Customer requested');
      expect(body.data.cancellation_fee).toBeDefined();
    });
  });

  describe('Invalid transitions', () => {
    it('completed → confirmed is rejected', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}/confirm?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.error).toContain('Cannot transition');
    });

    it('cancelled → in_progress is rejected', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID_2}/check-in?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.error).toContain('Cannot transition');
    });
  });

  describe('No-show', () => {
    it('confirmed → no_show (manual)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID_3}/no-show?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('no_show');
    });

    it('auto no-show job processes past bookings', async () => {
      // Create another past booking
      const pastTime = new Date(Date.now() - 20 * 60 * 1000);
      await adminPool.query(
        `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
         VALUES ($1, $2,
           (SELECT id FROM svc_services WHERE business_id = $1 LIMIT 1),
           (SELECT sv.id FROM svc_variants sv JOIN svc_services s ON s.id = sv.service_id WHERE s.business_id = $1 LIMIT 1),
           $3, $4, $5, 'confirmed', 'BK-LC-0004', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, booking_reference) DO UPDATE SET status = 'confirmed', start_time = $4`,
        [BUSINESS_ID, CUSTOMER_ID, STAFF_ID, pastTime.toISOString(), new Date(pastTime.getTime() + 60*60*1000).toISOString()],
      );

      const result = await lifecycleService.evaluateNoShows(15);
      expect(result.processed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reschedule', () => {
    it('reschedules a booking to a new time', async () => {
      // Create a fresh confirmed booking
      const futureTime = new Date();
      futureTime.setUTCDate(futureTime.getUTCDate() + 12);
      futureTime.setUTCHours(9, 0, 0, 0);
      const { rows: bk } = await adminPool.query(
        `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
         VALUES ($1, $2,
           (SELECT id FROM svc_services WHERE business_id = $1 LIMIT 1),
           (SELECT sv.id FROM svc_variants sv JOIN svc_services s ON s.id = sv.service_id WHERE s.business_id = $1 LIMIT 1),
           $3, $4, $5, 'confirmed', 'BK-LC-0005', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, booking_reference) DO UPDATE SET status = 'confirmed', start_time = $4
         RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID, STAFF_ID, futureTime.toISOString(), new Date(futureTime.getTime() + 60*60*1000).toISOString()],
      );

      const newTime = new Date(futureTime);
      newTime.setUTCHours(15, 0, 0, 0);

      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${bk[0].id}/reschedule?business_id=${BUSINESS_ID}`,
        { start_time: newTime.toISOString() },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(new Date(body.data.start_time).getUTCHours()).toBe(15);
    });

    it('rejects reschedule with staff conflict', async () => {
      // The booking at +10 days 10:00 was completed, but +12 days 15:00 exists
      // Try rescheduling to that time — should conflict
      const conflictTime = new Date();
      conflictTime.setUTCDate(conflictTime.getUTCDate() + 12);
      conflictTime.setUTCHours(15, 0, 0, 0);

      // Create another booking to reschedule
      const otherTime = new Date();
      otherTime.setUTCDate(otherTime.getUTCDate() + 13);
      otherTime.setUTCHours(11, 0, 0, 0);
      const { rows: bk } = await adminPool.query(
        `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
         VALUES ($1, $2,
           (SELECT id FROM svc_services WHERE business_id = $1 LIMIT 1),
           (SELECT sv.id FROM svc_variants sv JOIN svc_services s ON s.id = sv.service_id WHERE s.business_id = $1 LIMIT 1),
           $3, $4, $5, 'confirmed', 'BK-LC-0006', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, booking_reference) DO UPDATE SET status = 'confirmed'
         RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID, STAFF_ID, otherTime.toISOString(), new Date(otherTime.getTime() + 60*60*1000).toISOString()],
      );

      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${bk[0].id}/reschedule?business_id=${BUSINESS_ID}`,
        { start_time: conflictTime.toISOString() },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('conflict');
    });
  });
});
