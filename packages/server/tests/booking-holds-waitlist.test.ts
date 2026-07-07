import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as holdService from '../src/services/slot-hold.service';
import * as waitlistService from '../src/services/waitlist.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let CUSTOMER_ID: string;
let CUSTOMER_ID_2: string;
let STAFF_ID: string;
let HOLD_ID: string;
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

describe('Slot Holds & Waitlist', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Hold Wait Test Biz', 'hold-wait-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Hold Wait Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM apt_slot_holds WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM apt_waitlist_entries WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM apt_bookings WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'HW Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, default_duration, booking_type, max_capacity, created_by)
       VALUES ($1, $2, 'HW Service', 'hw-service', 'active', 60, 'shared', 2, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 5000, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    STAFF_ID = '00000000-0000-0000-0000-000000000090';
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'hw-staff@example.com', 'HW', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'HW'`,
      [STAFF_ID, TENANT_ID],
    );

    const { rows: c1 } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-HW01', 'hw-cust1@example.com', 'HW', 'Cust1', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'HW' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = c1[0].id;

    const { rows: c2 } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-HW02', 'hw-cust2@example.com', 'HW', 'Cust2', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'HW' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID_2 = c2[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Slot Holds ====================

  describe('Slot Holds', () => {
    it('POST /bookings/hold creates a hold', async () => {
      const startTime = new Date();
      startTime.setUTCDate(startTime.getUTCDate() + 7);
      startTime.setUTCHours(10, 0, 0, 0);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      const { statusCode, body } = await request('POST', '/api/v1/bookings/hold', {
        business_id: BUSINESS_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.expires_at).toBeDefined();
      expect(new Date(body.data.expires_at).getTime()).toBeGreaterThan(Date.now());
      HOLD_ID = body.data.id;
    });

    it('rejects duplicate hold on same slot', async () => {
      const startTime = new Date();
      startTime.setUTCDate(startTime.getUTCDate() + 7);
      startTime.setUTCHours(10, 0, 0, 0);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

      const { statusCode, body } = await request('POST', '/api/v1/bookings/hold', {
        business_id: BUSINESS_ID,
        service_id: SERVICE_ID,
        variant_id: VARIANT_ID,
        staff_id: STAFF_ID,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      }, ownerToken);

      expect(statusCode).toBe(409);
      expect(body.error).toContain('already being held');
    });

    it('DELETE /bookings/hold/:id releases a hold', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/bookings/hold/${HOLD_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.released).toBe(true);
    });

    it('cleanup removes expired holds', async () => {
      // Insert an expired hold
      await adminPool.query(
        `INSERT INTO apt_slot_holds (business_id, service_id, variant_id, start_time, end_time, held_by, expires_at)
         VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '1 hour', '00000000-0000-0000-0000-000000000010', NOW() - INTERVAL '1 minute')`,
        [BUSINESS_ID, SERVICE_ID, VARIANT_ID],
      );

      const cleaned = await holdService.cleanupExpiredHolds();
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== Waitlist ====================

  describe('Waitlist', () => {
    const slotStart = new Date();
    slotStart.setUTCDate(slotStart.getUTCDate() + 8);
    slotStart.setUTCHours(14, 0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
    let WAITLIST_ENTRY_ID: string;

    it('POST joins the waitlist', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/bookings/${SERVICE_ID}/waitlist?business_id=${BUSINESS_ID}`,
        { customer_id: CUSTOMER_ID, slot_start_time: slotStart.toISOString(), slot_end_time: slotEnd.toISOString() },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.position).toBe(1);
      expect(body.data.status).toBe('waiting');
      WAITLIST_ENTRY_ID = body.data.id;
    });

    it('second customer gets position 2', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/bookings/${SERVICE_ID}/waitlist?business_id=${BUSINESS_ID}`,
        { customer_id: CUSTOMER_ID_2, slot_start_time: slotStart.toISOString(), slot_end_time: slotEnd.toISOString() },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.position).toBe(2);
    });

    it('rejects duplicate waitlist entry', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/bookings/${SERVICE_ID}/waitlist?business_id=${BUSINESS_ID}`,
        { customer_id: CUSTOMER_ID, slot_start_time: slotStart.toISOString(), slot_end_time: slotEnd.toISOString() },
        ownerToken,
      );

      expect(statusCode).toBe(409);
      expect(body.error).toContain('Already on');
    });

    it('promotes next on cancellation', async () => {
      const result = await waitlistService.promoteNext(SERVICE_ID, slotStart.toISOString());
      expect(result).not.toBeNull();
      expect(result.status).toBe('notified');
      expect(result.expires_at).toBeDefined();
    });

    it('confirm promotion succeeds', async () => {
      const result = await waitlistService.confirmPromotion(WAITLIST_ENTRY_ID, CUSTOMER_ID);
      expect(result.confirmed).toBe(true);
    });

    it('DELETE leaves the waitlist', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/bookings/${SERVICE_ID}/waitlist?customer_id=${CUSTOMER_ID_2}&slot_start_time=${slotStart.toISOString()}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.removed).toBe(true);
    });

    it('processes expired notifications', async () => {
      // Create a third customer for this test
      const { rows: c3 } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-HW03', 'hw-cust3@example.com', 'HW', 'Cust3', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'HW' RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );

      // Use a different slot time to avoid conflicts
      const diffSlot = new Date(slotStart.getTime() + 2 * 60 * 60 * 1000);
      const diffSlotEnd = new Date(diffSlot.getTime() + 60 * 60 * 1000);

      await adminPool.query(
        `INSERT INTO apt_waitlist_entries (business_id, service_id, slot_start_time, slot_end_time, customer_id, position, status, notified_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'notified', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour')`,
        [BUSINESS_ID, SERVICE_ID, diffSlot.toISOString(), diffSlotEnd.toISOString(), c3[0].id],
      );

      const processed = await waitlistService.processExpiredNotifications();
      expect(processed).toBeGreaterThanOrEqual(1);
    });
  });
});
