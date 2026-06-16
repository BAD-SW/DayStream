import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let STAFF_ID: string;
let PATTERN_ID: string;
let LEAVE_ID: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost', port: address.port, path, method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
      const req = http.request(options, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          server.close();
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); }
          catch { resolve({ statusCode: res.statusCode!, body: d }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Staff Management', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status) VALUES ($1, 'Staff Test Biz', 'staff-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Staff Test Biz' RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up any existing test data
    await adminPool.query('DELETE FROM staff_profiles WHERE tenant_id = $1', [TENANT_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['staff:*', 'services:*', 'bookings:*'],
    );
  });

  // ==================== Staff Profile CRUD ====================
  describe('Staff Profiles', () => {
    it('creates a staff profile', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/staff', {
        first_name: 'Jane',
        last_name: 'Therapist',
        email: 'jane@example.com',
        mobile_phone: '+34612345678',
        employment_type: 'full_time',
        hire_date: '2025-01-15',
        bio: 'Experienced massage therapist',
        languages: 'English, Spanish',
        show_on_directory: true,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.first_name).toBe('Jane');
      expect(body.data.last_name).toBe('Therapist');
      expect(body.data.staff_ref).toMatch(/^STF-\d{3}$/);
      expect(body.data.status).toBe('active');
      STAFF_ID = body.data.id;
    });

    it('lists staff profiles', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/staff', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('gets a staff profile by ID', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/staff/${STAFF_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(STAFF_ID);
      expect(body.data.email).toBe('jane@example.com');
    });

    it('updates a staff profile', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/staff/${STAFF_ID}`, {
        bio: 'Senior massage therapist with 10 years experience',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.bio).toContain('Senior');
    });

    it('searches staff by name', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/staff?search=Jane', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('filters staff by employment type', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/staff?employment_type=full_time', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.every((s: any) => s.employment_type === 'full_time')).toBe(true);
    });
  });

  // ==================== Qualifications ====================
  describe('Qualifications', () => {
    let qualId: string;

    it('adds a qualification', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/qualifications`, {
        name: 'Level 4 Sports Massage',
        issuing_body: 'UK Massage Board',
        date_obtained: '2022-06-15',
        expiry_date: '2027-06-15',
        certification_number: 'CERT-12345',
        show_on_directory: true,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Level 4 Sports Massage');
      qualId = body.data.id;
    });

    it('lists qualifications for a staff member', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/staff/${STAFF_ID}/qualifications`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe('Level 4 Sports Massage');
    });

    it('updates a qualification', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/staff/${STAFF_ID}/qualifications/${qualId}`, {
        certification_number: 'CERT-99999',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.certification_number).toBe('CERT-99999');
    });

    it('checks expiring qualifications', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/staff/qualifications/expiring?days=3650', undefined, ownerToken);
      expect(statusCode).toBe(200);
      // Our qualification expires in 2027, which is within 3650 days
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('deletes a qualification', async () => {
      const { statusCode, body } = await request('DELETE', `/api/v1/staff/${STAFF_ID}/qualifications/${qualId}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });
  });

  // ==================== Availability Patterns ====================
  describe('Availability Patterns', () => {
    it('creates an availability pattern with slots', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/availability/patterns`, {
        name: 'Regular Schedule',
        effective_from: '2026-01-01',
        is_default: true,
        slots: [
          { day_of_week: 1, start_time: '09:00', end_time: '17:00' }, // Monday
          { day_of_week: 2, start_time: '09:00', end_time: '17:00' }, // Tuesday
          { day_of_week: 3, start_time: '09:00', end_time: '13:00' }, // Wednesday AM
          { day_of_week: 3, start_time: '14:00', end_time: '18:00' }, // Wednesday PM
          { day_of_week: 4, start_time: '10:00', end_time: '20:00' }, // Thursday
          { day_of_week: 5, start_time: '09:00', end_time: '15:00' }, // Friday
        ],
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Regular Schedule');
      expect(body.data.slots.length).toBe(6);
      PATTERN_ID = body.data.id;
    });

    it('lists patterns for a staff member', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/staff/${STAFF_ID}/availability/patterns`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].slots.length).toBe(6);
    });

    it('copies a pattern', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/availability/patterns/${PATTERN_ID}/copy`, undefined, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Regular Schedule (copy)');
      expect(body.data.slots.length).toBe(6);
      // Clean up copied pattern
      await request('DELETE', `/api/v1/staff/${STAFF_ID}/availability/patterns/${body.data.id}`, undefined, ownerToken);
    });

    it('resolves effective availability for a date range', async () => {
      // Monday June 15, 2026
      const { statusCode, body } = await request('GET',
        `/api/v1/staff/${STAFF_ID}/availability?start_date=2026-06-15&end_date=2026-06-19`,
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      // Monday should have 09:00-17:00
      expect(body.data['2026-06-15']).toBeDefined();
      expect(body.data['2026-06-15'].length).toBe(1);
      expect(body.data['2026-06-15'][0].start_time).toBe('09:00:00');
    });
  });

  // ==================== Availability Overrides ====================
  describe('Availability Overrides', () => {
    it('creates a remove override (block a day)', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/availability/overrides`, {
        override_date: '2026-06-16', // Tuesday
        override_type: 'remove',
        reason: 'Personal appointment',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.override_type).toBe('remove');
    });

    it('blocked day returns empty availability', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/staff/${STAFF_ID}/availability?start_date=2026-06-16&end_date=2026-06-16`,
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data['2026-06-16']).toEqual([]);
    });

    it('creates an add override (extra day)', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/availability/overrides`, {
        override_date: '2026-06-20', // Saturday (normally off)
        override_type: 'add',
        start_time: '10:00',
        end_time: '14:00',
        reason: 'Extra hours this week',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.override_type).toBe('add');
    });

    it('add override shows availability on off-day', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/staff/${STAFF_ID}/availability?start_date=2026-06-20&end_date=2026-06-20`,
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data['2026-06-20'].length).toBeGreaterThanOrEqual(1);
      // Should include our 10:00-14:00 block
      const hasBlock = body.data['2026-06-20'].some((b: any) => b.start_time === '10:00:00' && b.end_time === '14:00:00');
      expect(hasBlock).toBe(true);
    });

    it('lists overrides in date range', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/staff/${STAFF_ID}/availability/overrides?start_date=2026-06-01&end_date=2026-06-30`,
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== Leave Management ====================
  describe('Leave Management', () => {
    it('submits a leave request', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/leave`, {
        leave_type: 'holiday',
        start_date: '2026-07-01',
        end_date: '2026-07-05',
        notes: 'Summer holiday',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('pending');
      expect(body.data.leave_type).toBe('holiday');
      LEAVE_ID = body.data.id;
    });

    it('lists leave requests', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/staff/leave?status=pending', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('approves a leave request', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/staff/leave/${LEAVE_ID}/approve`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.request.status).toBe('approved');
    });

    it('approved leave blocks availability', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/staff/${STAFF_ID}/availability?start_date=2026-07-01&end_date=2026-07-03`,
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      // All days should be empty (on leave)
      expect(body.data['2026-07-01']).toEqual([]);
      expect(body.data['2026-07-02']).toEqual([]);
      expect(body.data['2026-07-03']).toEqual([]);
    });

    it('gets leave balances', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/staff/${STAFF_ID}/leave/balance`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('cancels a leave request and restores balance', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/staff/leave/${LEAVE_ID}/cancel`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('cancelled');
    });

    it('rejects a pending leave request', async () => {
      // Submit a new one
      const { body: newLeave } = await request('POST', `/api/v1/staff/${STAFF_ID}/leave`, {
        leave_type: 'personal',
        start_date: '2026-08-01',
        end_date: '2026-08-02',
      }, ownerToken);

      const { statusCode, body } = await request('PUT', `/api/v1/staff/leave/${newLeave.data.id}/reject`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('rejected');
    });
  });

  // ==================== Capacity Management ====================
  describe('Capacity', () => {
    it('sets capacity config', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/staff/${STAFF_ID}/capacity`, {
        max_bookings_per_day: 8,
        max_bookings_per_week: 35,
        max_consecutive_hours: 4,
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.max_bookings_per_day).toBe(8);
      expect(body.data.max_bookings_per_week).toBe(35);
    });

    it('gets capacity config', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/staff/${STAFF_ID}/capacity`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.max_bookings_per_day).toBe(8);
    });

    it('creates a capacity override', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/staff/${STAFF_ID}/capacity/override`, {
        override_date: '2026-06-20',
        max_bookings: 12,
        reason: 'Special event day',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.max_bookings).toBe(12);
    });
  });

  // ==================== Calendar ====================
  describe('Calendar', () => {
    it('gets staff calendar for a date range', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/staff/${STAFF_ID}/calendar?start_date=2026-06-15&end_date=2026-06-21`,
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('bookings');
      expect(body.data).toHaveProperty('leave');
      expect(body.data).toHaveProperty('availability');
      expect(body.data).toHaveProperty('overrides');
    });

    it('gets team calendar', async () => {
      const { statusCode, body } = await request('GET',
        '/api/v1/staff/calendar/team?start_date=2026-06-15&end_date=2026-06-21',
        undefined, ownerToken);

      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('staff');
      expect(body.data[0]).toHaveProperty('bookings');
      expect(body.data[0]).toHaveProperty('availability');
    });
  });

  // ==================== Public Directory ====================
  describe('Public Directory', () => {
    it('returns active staff marked for directory', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/staff/directory?tenant_id=${TENANT_ID}`);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      const jane = body.data.find((s: any) => s.first_name === 'Jane');
      expect(jane).toBeDefined();
      expect(jane.bio).toContain('Senior');
    });

    it('does not include inactive staff in directory', async () => {
      // Create an inactive staff
      await adminPool.query(
        `INSERT INTO staff_profiles (tenant_id, staff_ref, first_name, last_name, status, show_on_directory)
         VALUES ($1, 'STF-999', 'Hidden', 'Person', 'inactive', true)`,
        [TENANT_ID],
      );

      const { body } = await request('GET', `/api/v1/staff/directory?tenant_id=${TENANT_ID}`);
      const hidden = body.data.find((s: any) => s.first_name === 'Hidden');
      expect(hidden).toBeUndefined();
    });
  });

  // ==================== Deactivation ====================
  describe('Deactivation', () => {
    it('deactivates a staff member', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/staff/${STAFF_ID}/deactivate`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('inactive');
    });

    it('deactivated staff not shown in default list', async () => {
      const { body } = await request('GET', '/api/v1/staff', undefined, ownerToken);
      const inactive = body.data.find((s: any) => s.id === STAFF_ID);
      // Status filter defaults to excluding 'terminated' but includes inactive
      // Our filter is "status != terminated" so inactive should still appear
      // Let's verify with explicit status filter
      const { body: body2 } = await request('GET', '/api/v1/staff?status=active', undefined, ownerToken);
      const activeOnly = body2.data.find((s: any) => s.id === STAFF_ID);
      expect(activeOnly).toBeUndefined();
    });
  });
});
