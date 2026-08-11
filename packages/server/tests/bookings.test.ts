import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let CUSTOMER_ID: string;
let STAFF_ID: string;
let BOOKING_ID: string;
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

describe('Booking CRUD API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Booking CRUD Test Biz', 'booking-crud-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Booking CRUD Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM apt_bookings WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Create category + service + variant
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Booking Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, default_duration, buffer_after, min_advance_booking_hours, booking_type, max_capacity, created_by)
       VALUES ($1, $2, 'Booking Test Service', 'booking-test-service', 'active', 60, 15, 1, 'individual', 1, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    // Create staff
    STAFF_ID = '00000000-0000-0000-0000-000000000070';
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, business_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, $3, 'booking-staff@example.com', 'Booking', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Booking'`,
      [STAFF_ID, TENANT_ID, BUSINESS_ID],
    );
    await adminPool.query(
      `INSERT INTO svc_staff (service_id, user_id, is_primary) VALUES ($1, $2, true)
       ON CONFLICT (service_id, user_id, variant_id) DO NOTHING`,
      [SERVICE_ID, STAFF_ID],
    );

    // Create customer
    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-BK01', 'booking-cust@example.com', 'Booking', 'Customer', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Booking'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /api/v1/bookings — Create', () => {
    it('creates an individual booking', async () => {
      // Book 3 days from now at 14:00 UTC
      const bookingTime = new Date();
      bookingTime.setUTCDate(bookingTime.getUTCDate() + 3);
      bookingTime.setUTCHours(14, 0, 0, 0);

      const { statusCode, body } = await request('POST', '/api/v1/bookings', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        start_time: bookingTime.toISOString(),
        notes: 'Test booking',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('confirmed');
      expect(body.data.booking_reference).toMatch(/^BK-\d{4}-\d{4}$/);
      expect(body.data.booking_type).toBe('individual');
      expect(body.data.price).toBe(7500);
      expect(body.data.staff_id).toBe(STAFF_ID);
      BOOKING_ID = body.data.id;
    });

    it('auto-assigns staff when not provided', async () => {
      const bookingTime = new Date();
      bookingTime.setUTCDate(bookingTime.getUTCDate() + 4);
      bookingTime.setUTCHours(10, 0, 0, 0);

      const { statusCode, body } = await request('POST', '/api/v1/bookings', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        start_time: bookingTime.toISOString(),
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.staff_id).toBe(STAFF_ID); // auto-assigned
    });

    it('rejects staff conflict (double-booking)', async () => {
      // Try to book same staff, same time as first booking
      const bookingTime = new Date();
      bookingTime.setUTCDate(bookingTime.getUTCDate() + 3);
      bookingTime.setUTCHours(14, 0, 0, 0);

      const { statusCode, body } = await request('POST', '/api/v1/bookings', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        start_time: bookingTime.toISOString(),
      }, ownerToken);

      expect(statusCode).toBe(409);
      expect(body.error).toContain('conflict');
    });

    it('rejects customer conflict', async () => {
      // Customer already booked at +4 days 10:00, try overlapping time with different staff
      // Since there's only one staff, use override to skip staff conflict and hit customer conflict
      const bookingTime = new Date();
      bookingTime.setUTCDate(bookingTime.getUTCDate() + 4);
      bookingTime.setUTCHours(10, 30, 0, 0); // overlaps with the 10:00-11:00 booking

      // Create a second staff member
      const staffId2 = '00000000-0000-0000-0000-000000000071';
      await adminPool.query(
        `INSERT INTO usr_users (id, tenant_id, business_id, email, first_name, last_name, password_hash, role, status)
         VALUES ($1, $2, $3, 'booking-staff2@example.com', 'Booking', 'Staff2', 'hashed', 'therapist', 'active')
         ON CONFLICT (id) DO UPDATE SET first_name = 'Booking'`,
        [staffId2, TENANT_ID, BUSINESS_ID],
      );
      await adminPool.query(
        `INSERT INTO svc_staff (service_id, user_id, is_primary) VALUES ($1, $2, false)
         ON CONFLICT (service_id, user_id, variant_id) DO NOTHING`,
        [SERVICE_ID, staffId2],
      );

      const { statusCode, body } = await request('POST', '/api/v1/bookings', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: staffId2, // different staff, so no staff conflict
        start_time: bookingTime.toISOString(),
      }, ownerToken);

      expect(statusCode).toBe(409);
      expect(body.error).toContain('Customer has a conflicting');
    });

    it('rejects booking within lead time (without override)', async () => {
      const tooSoon = new Date(Date.now() + 30 * 60 * 1000); // 30 min from now

      const { statusCode, body } = await request('POST', '/api/v1/bookings', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        start_time: tooSoon.toISOString(),
      }, ownerToken);

      expect(statusCode).toBe(409);
      expect(body.error).toContain('advance booking');
    });

    it('allows override_rules for staff-initiated booking', async () => {
      // Create a second customer to avoid conflict
      const { rows: cust2 } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-BK02', 'booking-cust2@example.com', 'Second', 'Customer', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Second'
         RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );

      const soonTime = new Date();
      soonTime.setUTCDate(soonTime.getUTCDate() + 5);
      soonTime.setUTCHours(16, 0, 0, 0);

      const { statusCode, body } = await request('POST', '/api/v1/bookings', {
        business_id: BUSINESS_ID,
        customer_id: cust2[0].id,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        start_time: soonTime.toISOString(),
        override_rules: true,
      }, ownerToken);

      expect(statusCode).toBe(201);
    });

    it('generates sequential booking references', async () => {
      const { rows } = await adminPool.query(
        'SELECT booking_reference FROM apt_bookings WHERE business_id = $1 ORDER BY created_at',
        [BUSINESS_ID],
      );

      const refs = rows.map((r: any) => r.booking_reference);
      expect(refs.length).toBeGreaterThanOrEqual(3);
      // All should follow BK-YYYY-NNNN pattern
      for (const ref of refs) {
        expect(ref).toMatch(/^BK-\d{4}-\d{4}$/);
      }
    });
  });

  describe('GET /api/v1/bookings — List', () => {
    it('lists bookings for a business', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
      expect(body.meta.total).toBeGreaterThanOrEqual(3);
      expect(body.data[0]).toHaveProperty('service_name');
      expect(body.data[0]).toHaveProperty('customer_first_name');
    });

    it('filters by status', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings?business_id=${BUSINESS_ID}&status=confirmed`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.every((b: any) => b.status === 'confirmed')).toBe(true);
    });

    it('filters by customer_id', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings?business_id=${BUSINESS_ID}&customer_id=${CUSTOMER_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.every((b: any) => b.customer_id === CUSTOMER_ID)).toBe(true);
    });
  });

  describe('GET /api/v1/bookings/:id — Detail', () => {
    it('returns booking with status history', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/${BOOKING_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(BOOKING_ID);
      expect(body.data).toHaveProperty('service_name');
      expect(body.data).toHaveProperty('variant_name');
      expect(body.data).toHaveProperty('customer_first_name');
      expect(body.data).toHaveProperty('staff_first_name');
      expect(body.data).toHaveProperty('status_history');
      expect(body.data.status_history.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-existent booking', async () => {
      const { statusCode } = await request(
        'GET', `/api/v1/bookings/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/bookings/:id — Update (edit-screen parity with booking creation)', () => {
    it('updates participant_count', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}?business_id=${BUSINESS_ID}`,
        { participant_count: 3 }, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.participant_count).toBe(3);

      // Confirm it persisted, not just echoed back in the response.
      const { body: refetched } = await request(
        'GET', `/api/v1/bookings/${BOOKING_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(refetched.data.participant_count).toBe(3);
    });

    it('converts a customer booking to a walk-in (customer_id cleared, walk_in_name set)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}?business_id=${BUSINESS_ID}`,
        { customer_id: null, walk_in_name: 'Drop-in Dana' }, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.customer_id).toBeNull();
      expect(body.data.walk_in_name).toBe('Drop-in Dana');
    });

    it('converts a walk-in booking back to a real customer (walk_in_name cleared)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}?business_id=${BUSINESS_ID}`,
        { customer_id: CUSTOMER_ID, walk_in_name: null }, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.customer_id).toBe(CUSTOMER_ID);
      expect(body.data.walk_in_name).toBeNull();
    });

    it('rejects a participant_count below 1', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/bookings/${BOOKING_ID}?business_id=${BUSINESS_ID}`,
        { participant_count: 0 }, ownerToken,
      );
      expect(statusCode).toBe(400);
    });
  });
});
