import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as rulesService from '../src/services/booking-rules.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let CUSTOMER_ID: string;
let STAFF_ID: string;
let BOOKING_ID: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any; headers?: any }> {
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
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(responseData), headers: res.headers }); }
          catch { resolve({ statusCode: res.statusCode!, body: responseData, headers: res.headers }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Calendar & Rules APIs', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'CalRules Test Biz', 'calrules-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'CalRules Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM apt_bookings WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'CalRules Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, default_duration, min_advance_booking_hours, max_advance_booking_days, booking_type, created_by)
       VALUES ($1, $2, 'CalRules Service', 'calrules-service', 'active', 60, 2, 30, 'individual', '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    STAFF_ID = '00000000-0000-0000-0000-000000000097';
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'calrules-staff@example.com', 'Cal', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Cal'`,
      [STAFF_ID, TENANT_ID],
    );

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-CR01', 'calrules-cust@example.com', 'Cal', 'Customer', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Cal'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Create bookings for calendar test
    const today = new Date();
    today.setUTCHours(10, 0, 0, 0);
    const todayEnd = new Date(today.getTime() + 60 * 60 * 1000);

    const { rows: bk } = await adminPool.query(
      `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'BK-CR-0001', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, booking_reference) DO UPDATE SET start_time = $6, end_time = $7
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, SERVICE_ID, VARIANT_ID, STAFF_ID, today.toISOString(), todayEnd.toISOString()],
    );
    BOOKING_ID = bk[0].id;

    // Second booking tomorrow
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(14, 0, 0, 0);
    await adminPool.query(
      `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'BK-CR-0002', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, booking_reference) DO NOTHING`,
      [BUSINESS_ID, CUSTOMER_ID, SERVICE_ID, VARIANT_ID, STAFF_ID, tomorrow.toISOString(), new Date(tomorrow.getTime() + 60*60*1000).toISOString()],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Calendar ====================

  describe('GET /bookings/calendar — Day view', () => {
    it('returns bookings for today', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${today}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.view).toBe('day');
      expect(body.data.bookings.length).toBeGreaterThanOrEqual(1);
      expect(body.data.bookings[0]).toHaveProperty('service_name');
      expect(body.data.bookings[0]).toHaveProperty('customer_name');
      expect(body.data.bookings[0]).toHaveProperty('staff_name');
      expect(body.data.bookings[0]).toHaveProperty('status');
    });
  });

  describe('GET /bookings/calendar — Week view', () => {
    it('returns bookings for this week', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=week&date=${today}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.view).toBe('week');
      expect(body.data.bookings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /bookings/calendar — Month view', () => {
    it('returns daily counts', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=month&date=${today}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.view).toBe('month');
      expect(body.data.days.length).toBeGreaterThanOrEqual(1);
      expect(body.data.days[0]).toHaveProperty('date');
      expect(body.data.days[0]).toHaveProperty('count');
    });
  });

  describe('GET /bookings/calendar — Staff filter', () => {
    it('filters by staff_id', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=week&date=${today}&staff_id=${STAFF_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      // All returned bookings should be for this staff
      for (const bk of body.data.bookings) {
        expect(bk.staff_name).toContain('Cal');
      }
    });
  });

  // ==================== iCal ====================

  describe('GET /bookings/:id/ical', () => {
    it('returns an iCal file', async () => {
      const { statusCode, body, headers } = await request(
        'GET', `/api/v1/bookings/${BOOKING_ID}/ical?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(headers?.['content-type']).toContain('text/calendar');
      expect(typeof body).toBe('string');
      expect(body).toContain('BEGIN:VCALENDAR');
      expect(body).toContain('BK-CR-0001');
    });
  });

  // ==================== Booking Rules ====================

  describe('GET /bookings/rules', () => {
    it('returns rules summary for a service', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/rules?business_id=${BUSINESS_ID}&service_id=${SERVICE_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.min_advance_booking_hours).toBe(2);
      expect(body.data.max_advance_booking_days).toBe(30);
    });
  });

  describe('Rules validation service', () => {
    it('validates lead time', async () => {
      const tooSoon = new Date(Date.now() + 30 * 60 * 1000); // 30 min from now
      const result = await rulesService.validateBookingRules({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        startTime: tooSoon,
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes('advance booking'))).toBe(true);
    });

    it('validates max advance booking', async () => {
      const tooFar = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
      const result = await rulesService.validateBookingRules({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        startTime: tooFar,
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((v) => v.includes('30 days'))).toBe(true);
    });

    it('allows valid booking time', async () => {
      const validTime = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
      const result = await rulesService.validateBookingRules({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        startTime: validTime,
      });

      expect(result.allowed).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it('staff override bypasses all rules', async () => {
      const tooSoon = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
      const result = await rulesService.validateBookingRules({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        startTime: tooSoon,
        isStaffOverride: true,
      });

      expect(result.allowed).toBe(true);
    });
  });
});
