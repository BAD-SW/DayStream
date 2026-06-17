import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let BOOKING_ID: string;
let QR_CODE: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost', port: address.port, path, method,
        headers: { 'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      };
      const req = http.request(options, (res) => {
        let d = ''; res.on('data', (c) => (d += c));
        res.on('end', () => { server.close();
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); }
          catch { resolve({ statusCode: res.statusCode!, body: d }); } });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data); req.end();
    });
  });
}

describe('Check-In System', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status) VALUES ($1, 'CheckIn Test Biz', 'checkin-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'CheckIn Test Biz' RETURNING id`, [TENANT_ID]);
    BUSINESS_ID = bizRows[0].id;

    // Create customer
    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (business_id, tenant_id, email, first_name, last_name, reference_number)
       VALUES ($1, $2, 'checkin-test@example.com', 'Check', 'Tester', 'CUST-CI-001')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Check' RETURNING id`, [BUSINESS_ID, TENANT_ID]);
    CUSTOMER_ID = custRows[0].id;

    // Create a confirmed booking for today
    const now = new Date();
    const start = new Date(now.getTime() + 30 * 60000); // 30 min from now
    const end = new Date(start.getTime() + 60 * 60000); // 1 hour session

    // Need a service with variant
    const { rows: svcRows } = await adminPool.query(`SELECT id FROM services WHERE business_id = $1 LIMIT 1`, [BUSINESS_ID]);
    let serviceId: string;
    let variantId: string;
    if (svcRows.length > 0) {
      serviceId = svcRows[0].id;
      const { rows: varRows } = await adminPool.query(`SELECT id FROM service_variants WHERE service_id = $1 LIMIT 1`, [serviceId]);
      if (varRows.length > 0) { variantId = varRows[0].id; }
      else {
        const { rows: newVar } = await adminPool.query(
          `INSERT INTO service_variants (service_id, name, duration, price) VALUES ($1, 'Default', 60, 5000) RETURNING id`, [serviceId]);
        variantId = newVar[0].id;
      }
    } else {
      // Create minimal service + variant
      const { rows: catRows } = await adminPool.query(`SELECT id FROM service_categories WHERE business_id = $1 LIMIT 1`, [BUSINESS_ID]);
      let catId: string;
      if (catRows.length > 0) { catId = catRows[0].id; }
      else {
        const { rows: newCat } = await adminPool.query(
          `INSERT INTO service_categories (business_id, name) VALUES ($1, 'General') RETURNING id`, [BUSINESS_ID]);
        catId = newCat[0].id;
      }
      const { rows: newSvc } = await adminPool.query(
        `INSERT INTO services (business_id, category_id, name, slug, status) VALUES ($1, $2, 'Test Service CI', $3, 'active') RETURNING id`, [BUSINESS_ID, catId, 'test-svc-ci-' + Date.now()]);
      serviceId = newSvc[0].id;
      const { rows: newVar } = await adminPool.query(
        `INSERT INTO service_variants (service_id, name, duration, price) VALUES ($1, 'Default', 60, 5000) RETURNING id`, [serviceId]);
      variantId = newVar[0].id;
    }

    const bookingRef = `BK-CI-${Date.now().toString(36)}`;
    const { rows: bookingRows } = await adminPool.query(
      `INSERT INTO bookings (business_id, customer_id, service_id, variant_id, start_time, end_time, status, booking_type, booking_reference, price)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'individual', $7, 5000) RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, serviceId, variantId, start.toISOString(), end.toISOString(), bookingRef]);
    BOOKING_ID = bookingRows[0].id;

    // Clean old check-in data
    await adminPool.query('DELETE FROM check_in_records WHERE tenant_id = $1', [TENANT_ID]);
    await adminPool.query('DELETE FROM check_in_qr_codes WHERE tenant_id = $1', [TENANT_ID]);
    await adminPool.query('DELETE FROM no_show_records WHERE tenant_id = $1', [TENANT_ID]);
    await adminPool.query('DELETE FROM bookings WHERE business_id = $1 AND booking_reference LIKE $2', [BUSINESS_ID, 'BK-CI-%']);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['checkin:*', 'checkin:read', 'services:*', 'bookings:*'],
    );
  });

  describe('QR Codes', () => {
    it('generates a booking QR code', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/check-in/qr-code/booking/${BOOKING_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.code).toMatch(/^DSCI-/);
      expect(body.data.code_type).toBe('booking');
      QR_CODE = body.data.code;
    });

    it('generates a customer QR code', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/check-in/qr-code/customer/${CUSTOMER_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.code).toMatch(/^DSCC-/);
      expect(body.data.code_type).toBe('customer');
    });

    it('regenerates a customer QR code', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/check-in/qr-code/customer/${CUSTOMER_ID}/regenerate`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.code).toMatch(/^DSCC-/);
    });
  });

  describe('Session Validation', () => {
    it('validates a valid booking (dry run)', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/check-in/validate/${BOOKING_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.pass).toBe(true);
      expect(body.data.errors).toHaveLength(0);
    });
  });

  describe('Check-In Methods', () => {
    it('checks in via QR code', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/check-in/qr', { code: QR_CODE }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.record.check_in_method).toBe('qr_staff');
      expect(body.data.validation.pass).toBe(true);
    });

    it('prevents double check-in', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/check-in/qr', { code: QR_CODE }, ownerToken);
      // QR is deactivated after first use OR validation fails due to already checked in
      expect(statusCode).toBe(400);
    });

    it('checks in via reception (new booking)', async () => {
      // Create another booking within the early-arrival window (10 min from now)
      const now = new Date();
      const start = new Date(now.getTime() + 10 * 60000); // 10 min from now (within 15-min early window)
      const end = new Date(start.getTime() + 60 * 60000);
      const { rows: svcRows } = await adminPool.query(`SELECT id FROM services WHERE business_id = $1 LIMIT 1`, [BUSINESS_ID]);
      const { rows: varRows } = await adminPool.query(`SELECT id FROM service_variants WHERE service_id = $1 LIMIT 1`, [svcRows[0].id]);
      const { rows: bkRows } = await adminPool.query(
        `INSERT INTO bookings (business_id, customer_id, service_id, variant_id, start_time, end_time, status, booking_type, booking_reference, price)
         VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'individual', $7, 5000) RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID, svcRows[0].id, varRows[0].id, start.toISOString(), end.toISOString(), `BK-CI-${Date.now().toString(36)}`]);

      const { statusCode, body } = await request('POST', '/api/v1/check-in/reception', { booking_id: bkRows[0].id }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.record.check_in_method).toBe('reception');
    });
  });

  describe('Configuration', () => {
    it('gets default config', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/config', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.grace_period_minutes).toBe(15);
      expect(body.data.credit_deduction_mode).toBe('on_booking');
    });

    it('updates config', async () => {
      const { statusCode, body } = await request('PUT', '/api/v1/check-in/config', {
        grace_period_minutes: 20, walk_in_enabled: false,
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.grace_period_minutes).toBe(20);
      expect(body.data.walk_in_enabled).toBe(false);

      // Reset for other tests
      await request('PUT', '/api/v1/check-in/config', { walk_in_enabled: true }, ownerToken);
    });
  });

  describe('Dashboard', () => {
    it('gets today\'s dashboard', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/dashboard', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('upcoming');
      expect(body.data).toHaveProperty('awaiting');
      expect(body.data).toHaveProperty('checked_in');
      expect(body.data).toHaveProperty('completed');
      expect(body.data).toHaveProperty('no_show');
    });

    it('gets upcoming bookings', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/dashboard/upcoming?limit=5', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('No-Show Management', () => {
    it('lists no-shows (empty initially)', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/no-shows', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('Kiosk', () => {
    it('registers a kiosk device', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/check-in/kiosk/register', {
        location_id: '00000000-0000-0000-0000-000000000099', device_name: 'Front Desk iPad',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.device_name).toBe('Front Desk iPad');
      expect(body.data.token).toBeTruthy();
    });
  });

  describe('Reports', () => {
    it('gets attendance rate', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/reports/attendance', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('percentage');
      expect(body.data).toHaveProperty('total_bookings');
    });

    it('gets no-show rate', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/reports/no-shows', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('no_show_count');
    });

    it('gets peak times', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/reports/peak-times', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('gets method breakdown', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/check-in/reports/methods', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
