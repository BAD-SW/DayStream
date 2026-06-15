import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as recurringService from '../src/services/recurring-bookings.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let CUSTOMER_ID: string;
let STAFF_ID: string;
let SERIES_ID: string;
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

describe('Recurring Bookings', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Recurring Test Biz', 'recurring-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Recurring Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM bookings WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM recurring_booking_series WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM service_categories WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Recurring Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO services (business_id, category_id, name, slug, status, default_duration, booking_type, created_by)
       VALUES ($1, $2, 'Recurring Service', 'recurring-service', 'active', 60, 'individual', '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO service_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    STAFF_ID = '00000000-0000-0000-0000-000000000095';
    await adminPool.query(
      `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'recurring-staff@example.com', 'Recurring', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Recurring'`,
      [STAFF_ID, TENANT_ID],
    );
    await adminPool.query(
      `INSERT INTO service_staff (service_id, user_id, is_primary) VALUES ($1, $2, true)
       ON CONFLICT (service_id, user_id, variant_id) DO NOTHING`,
      [SERVICE_ID, STAFF_ID],
    );

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-REC01', 'recurring-cust@example.com', 'Recurring', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Recurring'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /bookings/recurring', () => {
    it('creates a weekly recurring series', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/bookings/recurring', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        recurrence_pattern: 'weekly',
        day_of_week: 4, // Thursday
        start_time: '14:00',
        end_type: 'count',
        end_count: 4,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.series.recurrence_pattern).toBe('weekly');
      expect(body.data.series.status).toBe('active');
      expect(body.data.generation.created).toBeGreaterThan(0);
      SERIES_ID = body.data.series.id;
    });

    it('generates booking instances', async () => {
      const { rows } = await adminPool.query(
        'SELECT * FROM bookings WHERE recurring_series_id = $1 ORDER BY start_time',
        [SERIES_ID],
      );

      expect(rows.length).toBeGreaterThan(0);
      // All should be on a Thursday
      for (const bk of rows) {
        expect(new Date(bk.start_time).getUTCDay()).toBe(4);
        expect(new Date(bk.start_time).getUTCHours()).toBe(14);
      }
    });

    it('skips conflicts gracefully', async () => {
      // The second series at the same time/staff should skip conflicts
      const { statusCode, body } = await request('POST', '/api/v1/bookings/recurring', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        recurrence_pattern: 'weekly',
        day_of_week: 4,
        start_time: '14:00',
        end_type: 'count',
        end_count: 4,
      }, ownerToken);

      expect(statusCode).toBe(201);
      // All should be skipped (conflicts with first series)
      expect(body.data.generation.skipped).toBeGreaterThan(0);
    });
  });

  describe('GET /bookings/recurring/:seriesId', () => {
    it('returns series with instances', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/bookings/recurring/${SERIES_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(SERIES_ID);
      expect(body.data.recurrence_pattern).toBe('weekly');
      expect(body.data.instances.length).toBeGreaterThan(0);
    });

    it('returns 404 for non-existent series', async () => {
      const { statusCode } = await request(
        'GET', `/api/v1/bookings/recurring/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });

  describe('PUT /bookings/recurring/:seriesId/cancel', () => {
    it('cancels all future occurrences', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/bookings/recurring/${SERIES_ID}/cancel?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.cancelled).toBeGreaterThan(0);

      // Verify series status
      const { rows } = await adminPool.query(
        'SELECT status FROM recurring_booking_series WHERE id = $1',
        [SERIES_ID],
      );
      expect(rows[0].status).toBe('cancelled');
    });
  });

  describe('Single occurrence cancellation', () => {
    it('cancels one instance without affecting others', async () => {
      // Create a new series for this test
      const { body: newSeries } = await request('POST', '/api/v1/bookings/recurring', {
        business_id: BUSINESS_ID,
        customer_id: CUSTOMER_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        recurrence_pattern: 'weekly',
        day_of_week: 2, // Tuesday (different to avoid conflict)
        start_time: '10:00',
        end_type: 'count',
        end_count: 3,
      }, ownerToken);

      const seriesId = newSeries.data.series.id;

      // Get one instance
      const { rows: instances } = await adminPool.query(
        "SELECT id FROM bookings WHERE recurring_series_id = $1 AND status = 'confirmed' LIMIT 1",
        [seriesId],
      );

      if (instances.length > 0) {
        const cancelled = await recurringService.cancelSingleOccurrence(instances[0].id, BUSINESS_ID, '00000000-0000-0000-0000-000000000010', TENANT_ID);
        expect(cancelled).toBe(true);

        // Series should still be active
        const { rows: seriesRows } = await adminPool.query(
          'SELECT status FROM recurring_booking_series WHERE id = $1',
          [seriesId],
        );
        expect(seriesRows[0].status).toBe('active');

        // Other instances still confirmed
        const { rows: remaining } = await adminPool.query(
          "SELECT COUNT(*)::int AS count FROM bookings WHERE recurring_series_id = $1 AND status = 'confirmed'",
          [seriesId],
        );
        expect(remaining[0].count).toBeGreaterThan(0);
      }
    });
  });
});
