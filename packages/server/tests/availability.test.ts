import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as availabilityService from '../src/services/availability.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
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

describe('Availability Engine', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Availability Test Biz', 'availability-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Availability Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM bookings WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM slot_holds WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM service_categories WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM staff_schedules WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM staff_time_off WHERE business_id = $1', [BUSINESS_ID]);

    // Create category + service + variant
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Avail Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO services (business_id, category_id, name, slug, status, default_duration, buffer_before, buffer_after, min_advance_booking_hours, max_advance_booking_days, online_booking_enabled, created_by)
       VALUES ($1, $2, 'Avail Test Service', 'avail-test-service', 'active', 60, 0, 15, 2, 30, true, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO service_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    // Create a staff user
    STAFF_ID = '00000000-0000-0000-0000-000000000060';
    await adminPool.query(
      `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'avail-staff@example.com', 'Avail', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Avail'`,
      [STAFF_ID, TENANT_ID],
    );

    // Assign staff to service
    await adminPool.query(
      `INSERT INTO service_staff (service_id, user_id, is_primary) VALUES ($1, $2, true)
       ON CONFLICT (service_id, user_id, variant_id) DO NOTHING`,
      [SERVICE_ID, STAFF_ID],
    );

    // Create staff schedule: Mon-Fri 9:00-17:00
    for (let day = 1; day <= 5; day++) {
      await adminPool.query(
        `INSERT INTO staff_schedules (user_id, business_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, '09:00', '17:00')`,
        [STAFF_ID, BUSINESS_ID, day],
      );
    }

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('Service-level availability', () => {
    it('returns slots for available days', async () => {
      // Query next 7 days (should have weekday slots)
      const dateFrom = new Date();
      dateFrom.setUTCDate(dateFrom.getUTCDate() + 1);
      const dateTo = new Date(dateFrom);
      dateTo.setUTCDate(dateTo.getUTCDate() + 7);

      const slots = await availabilityService.getAvailableSlots({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
      });

      expect(slots.length).toBeGreaterThan(0);
      // Each slot should have 60-min duration
      expect(slots[0].duration).toBe(60);
      // Should have available staff
      expect(slots[0].available_staff.length).toBeGreaterThan(0);
      expect(slots[0].available_staff[0].first_name).toBe('Avail');
    });

    it('excludes slots blocked by existing bookings', async () => {
      // Create a test customer
      await adminPool.query(
        `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-AVAIL', 'avail-test-cust@example.com', 'Avail', 'Customer', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO NOTHING`,
        [TENANT_ID, BUSINESS_ID],
      );

      // Create a booking for tomorrow at 10:00
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(10, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow.getTime() + 60 * 60 * 1000);

      await adminPool.query(
        `INSERT INTO bookings (business_id, customer_id, service_id, variant_id, staff_id, start_time, end_time, status, booking_reference, booking_type, price, created_by)
         VALUES ($1, (SELECT id FROM customers WHERE business_id = $1 LIMIT 1), $2, $3, $4, $5, $6, 'confirmed', 'BK-TEST-0001', 'individual', 7500, '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, booking_reference) DO NOTHING`,
        [BUSINESS_ID, SERVICE_ID, VARIANT_ID, STAFF_ID, tomorrow.toISOString(), tomorrowEnd.toISOString()],
      );

      const dateFrom = tomorrow.toISOString().slice(0, 10);
      const dateTo = dateFrom;

      const slots = await availabilityService.getAvailableSlots({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        dateFrom,
        dateTo,
      });

      // The 10:00 slot should not be available (booked + 15 min buffer after)
      const tenAMSlot = slots.find((s) => {
        const d = new Date(s.start_time);
        return d.getUTCHours() === 10 && d.getUTCMinutes() === 0;
      });
      expect(tenAMSlot).toBeUndefined();
    });

    it('excludes slots during staff time off', async () => {
      // Add time off for day after tomorrow, all day
      const dayAfter = new Date();
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 2);
      dayAfter.setUTCHours(0, 0, 0, 0);
      const dayAfterEnd = new Date(dayAfter);
      dayAfterEnd.setUTCHours(23, 59, 59, 999);

      await adminPool.query(
        `INSERT INTO staff_time_off (user_id, business_id, start_time, end_time, reason)
         VALUES ($1, $2, $3, $4, 'Test time off')`,
        [STAFF_ID, BUSINESS_ID, dayAfter.toISOString(), dayAfterEnd.toISOString()],
      );

      const dateFrom = dayAfter.toISOString().slice(0, 10);
      const dateTo = dateFrom;

      const slots = await availabilityService.getAvailableSlots({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        dateFrom,
        dateTo,
      });

      // No slots on the time-off day
      expect(slots.length).toBe(0);
    });

    it('respects lead time (no slots within min_advance_booking_hours)', async () => {
      const now = new Date();
      const dateFrom = now.toISOString().slice(0, 10);
      const dateTo = dateFrom;

      const slots = await availabilityService.getAvailableSlots({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        dateFrom,
        dateTo,
      });

      // All returned slots should be at least 2 hours from now
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      for (const slot of slots) {
        expect(new Date(slot.start_time).getTime()).toBeGreaterThan(twoHoursFromNow.getTime());
      }
    });

    it('filters by specific staff member', async () => {
      const dateFrom = new Date();
      dateFrom.setUTCDate(dateFrom.getUTCDate() + 3);
      const dateTo = new Date(dateFrom);
      dateTo.setUTCDate(dateTo.getUTCDate() + 1);

      const slots = await availabilityService.getAvailableSlots({
        serviceId: SERVICE_ID,
        businessId: BUSINESS_ID,
        dateFrom: dateFrom.toISOString().slice(0, 10),
        dateTo: dateTo.toISOString().slice(0, 10),
        staffId: STAFF_ID,
      });

      // All slots should show only the filtered staff
      for (const slot of slots) {
        expect(slot.available_staff.every((s) => s.id === STAFF_ID)).toBe(true);
      }
    });

    it('returns empty for inactive service', async () => {
      // Create an inactive service
      const { rows: catRows } = await adminPool.query(
        `SELECT id FROM service_categories WHERE business_id = $1 LIMIT 1`, [BUSINESS_ID],
      );
      const { rows: inactiveSvc } = await adminPool.query(
        `INSERT INTO services (business_id, category_id, name, slug, status, created_by)
         VALUES ($1, $2, 'Inactive Service', 'inactive-service', 'draft', '00000000-0000-0000-0000-000000000010')
         RETURNING id`,
        [BUSINESS_ID, catRows[0].id],
      );

      const slots = await availabilityService.getAvailableSlots({
        serviceId: inactiveSvc[0].id,
        businessId: BUSINESS_ID,
        dateFrom: '2026-07-01',
        dateTo: '2026-07-07',
      });

      expect(slots.length).toBe(0);
    });
  });

  describe('API endpoint', () => {
    it('GET /bookings/availability returns slots', async () => {
      const dateFrom = new Date();
      dateFrom.setUTCDate(dateFrom.getUTCDate() + 4);
      const dateTo = new Date(dateFrom);
      dateTo.setUTCDate(dateTo.getUTCDate() + 2);

      const { statusCode, body } = await request(
        'GET',
        `/api/v1/bookings/availability?service_id=${SERVICE_ID}&business_id=${BUSINESS_ID}&date_from=${dateFrom.toISOString().slice(0, 10)}&date_to=${dateTo.toISOString().slice(0, 10)}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.meta.count).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('start_time');
      expect(body.data[0]).toHaveProperty('end_time');
      expect(body.data[0]).toHaveProperty('available_staff');
    });

    it('requires all parameters', async () => {
      const { statusCode } = await request(
        'GET', `/api/v1/bookings/availability?service_id=${SERVICE_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
    });

    it('supports staff_id filter', async () => {
      const dateFrom = new Date();
      dateFrom.setUTCDate(dateFrom.getUTCDate() + 4);
      const dateTo = new Date(dateFrom);
      dateTo.setUTCDate(dateTo.getUTCDate() + 1);

      const { statusCode, body } = await request(
        'GET',
        `/api/v1/bookings/availability?service_id=${SERVICE_ID}&business_id=${BUSINESS_ID}&date_from=${dateFrom.toISOString().slice(0, 10)}&date_to=${dateTo.toISOString().slice(0, 10)}&staff_id=${STAFF_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      for (const slot of body.data) {
        expect(slot.available_staff.some((s: any) => s.id === STAFF_ID)).toBe(true);
      }
    });
  });
});
