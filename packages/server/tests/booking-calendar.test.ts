import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fc from 'fast-check';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';
import { getCalendar, computeCapacitySegments, derivePaymentStatus } from '../src/services/booking-calendar.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const STAFF_ID_1 = '00000000-0000-0000-0000-000000000060';
const STAFF_ID_2 = '00000000-0000-0000-0000-000000000061';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let GROUP_SERVICE_ID: string; // max_capacity 4 — for staff-timeline tests (a coach running a small class)
let GROUP_VARIANT_ID: string;
let CUSTOMER_ID: string;
let RESOURCE_ID: string;
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

function genRef(): string {
  return `BK-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

async function insertBooking(opts: {
  startTime: Date;
  endTime?: Date;
  resourceId?: string | null;
  staffId?: string | null;
  serviceId?: string;
  variantId?: string;
  status?: string;
  participantCount?: number;
}): Promise<string> {
  const endTime = opts.endTime ?? new Date(opts.startTime.getTime() + 60 * 60000);
  const { rows } = await adminPool.query(
    `INSERT INTO apt_bookings (business_id, customer_id, service_id, variant_id, resource_id, staff_id, start_time, end_time, status, booking_type, price, booking_reference, participant_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'individual', 5000, $10, $11) RETURNING id`,
    [
      BUSINESS_ID, CUSTOMER_ID, opts.serviceId ?? SERVICE_ID, opts.variantId ?? VARIANT_ID, opts.resourceId ?? null, opts.staffId ?? null,
      opts.startTime.toISOString(), endTime.toISOString(), opts.status ?? 'confirmed', genRef(), opts.participantCount ?? 1,
    ],
  );
  return rows[0].id;
}

describe('Calendar API — capacity extension (feature 31)', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Calendar Capacity Test Biz', 'calendar-capacity-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Calendar Capacity Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM apt_bookings WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM res_resources WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Calendar Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, default_duration, buffer_after, min_advance_booking_hours, booking_type, max_capacity, created_by)
       VALUES ($1, $2, 'Calendar Test Service', 'calendar-test-service', 'active', 60, 15, 1, 'individual', 5, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 5000, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    // A staff-led small-group service (max_capacity 4) — for staff-timeline tests, where the
    // capacity ceiling comes from the service being run, not from a resource.
    const { rows: groupSvcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, default_duration, buffer_after, min_advance_booking_hours, booking_type, max_capacity, created_by)
       VALUES ($1, $2, 'Calendar Test Group Class', 'calendar-test-group-class', 'active', 60, 15, 1, 'group', 4, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    GROUP_SERVICE_ID = groupSvcRows[0].id;
    const { rows: groupVarRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 5000, 'active') RETURNING id`,
      [GROUP_SERVICE_ID],
    );
    GROUP_VARIANT_ID = groupVarRows[0].id;

    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, business_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, $3, 'calendar-coach1@example.com', 'Coach', 'One', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Coach'`,
      [STAFF_ID_1, TENANT_ID, BUSINESS_ID],
    );
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, business_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, $3, 'calendar-coach2@example.com', 'Coach', 'Two', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Coach'`,
      [STAFF_ID_2, TENANT_ID, BUSINESS_ID],
    );

    const { rows: resRows } = await adminPool.query(
      `INSERT INTO res_resources (tenant_id, business_id, name, category, capacity, status)
       VALUES ($1, $2, 'Calendar Test Room', 'room', 3, 'active') RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    RESOURCE_ID = resRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-CAL01', 'calendar-cust@example.com', 'Calendar', 'Customer', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Calendar'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  afterEach(async () => {
    await adminPool.query('DELETE FROM apt_bookings WHERE business_id = $1', [BUSINESS_ID]);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM res_resources WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_variants WHERE service_id = $1', [SERVICE_ID]);
    await adminPool.query('DELETE FROM svc_variants WHERE service_id = $1', [GROUP_SERVICE_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);
  });

  describe('Integration tests (task 1.2)', () => {
    it('day view response includes service_id, resource_capacity, participant_count on each booking', async () => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 5);
      start.setUTCHours(10, 0, 0, 0);
      await insertBooking({ startTime: start, resourceId: RESOURCE_ID, participantCount: 2 });

      const dateStr = start.toISOString().slice(0, 10);
      const { statusCode, body } = await request(
        'GET',
        `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`,
        undefined,
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.bookings.length).toBeGreaterThan(0);
      const booking = body.data.bookings[0];
      expect(booking).toHaveProperty('service_id', SERVICE_ID);
      expect(booking).toHaveProperty('resource_capacity');
      // Each booking reports its OWN participant count — not some shared/aggregate resource
      // figure. That aggregate now lives entirely in `resourceTimelines`, not on the booking.
      expect(booking.participant_count).toBe(2);
    });

    it('booking with a resource: resource_capacity matches the DB value', async () => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 6);
      start.setUTCHours(11, 0, 0, 0);
      await insertBooking({ startTime: start, resourceId: RESOURCE_ID });

      const dateStr = start.toISOString().slice(0, 10);
      const { body } = await request(
        'GET',
        `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`,
        undefined,
        ownerToken,
      );

      const booking = body.data.bookings.find((b: any) => b.service_id === SERVICE_ID);
      expect(booking.resource_capacity).toBe(3);
      expect(booking.resource_id).toBe(RESOURCE_ID);
    });

    it('booking without a resource: resource_id and resource_capacity are both null', async () => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 7);
      start.setUTCHours(12, 0, 0, 0);
      await insertBooking({ startTime: start, resourceId: null });

      const dateStr = start.toISOString().slice(0, 10);
      const { body } = await request(
        'GET',
        `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`,
        undefined,
        ownerToken,
      );

      const booking = body.data.bookings[0];
      expect(booking.resource_id).toBeNull();
      expect(booking.resource_capacity).toBeNull();
    });

    it('resourceTimelines reflects the true concurrent headcount per segment, not a flat sum of overlappers (the reported bug)', async () => {
      // The exact motivating scenario: capacity 3. Booking A = 2 people, 60min @ 3:00pm (3:00-4:00).
      // Booking B = 1 person, 30min @ 3:30pm (3:30-4:00). Booking C = 1 person, 90min @ 3:30pm
      // (3:30-5:00). B and C don't overlap A's whole span uniformly, so the old flat-SUM approach
      // (summing participant_count of every booking that overlaps *this* one) showed a misleading
      // "3/3" on all three regardless of when each was actually concurrent with the others.
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 14);
      const at = (h: number, m: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0));

      await insertBooking({ startTime: at(15, 0), endTime: at(16, 0), resourceId: RESOURCE_ID, participantCount: 2 });
      await insertBooking({ startTime: at(15, 30), endTime: at(16, 0), resourceId: RESOURCE_ID, participantCount: 1 });
      await insertBooking({ startTime: at(15, 30), endTime: at(17, 0), resourceId: RESOURCE_ID, participantCount: 1 });

      const dateStr = day.toISOString().slice(0, 10);
      const { statusCode, body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(statusCode).toBe(200);

      const segments = body.data.resourceTimelines[RESOURCE_ID];
      expect(segments).toEqual([
        { start_time: at(15, 0).toISOString(), end_time: at(15, 30).toISOString(), booked: 2, capacity: 3 },
        { start_time: at(15, 30).toISOString(), end_time: at(16, 0).toISOString(), booked: 4, capacity: 3 },
        { start_time: at(16, 0).toISOString(), end_time: at(17, 0).toISOString(), booked: 1, capacity: 3 },
      ]);
    });

    it('staffTimelines shows one coach fully booked and another still with room (item 3c-a)', async () => {
      // Two coaches running the same group class (capacity 4) at the same time: Coach One has
      // 4 people booked (full), Coach Two has 1 (plenty of room) — the two staff timelines must be
      // independent, not merged into a single shared-resource-style figure.
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 21);
      const at = (h: number, m: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0));

      await insertBooking({ startTime: at(10, 0), endTime: at(11, 0), staffId: STAFF_ID_1, serviceId: GROUP_SERVICE_ID, variantId: GROUP_VARIANT_ID, participantCount: 4 });
      await insertBooking({ startTime: at(10, 0), endTime: at(11, 0), staffId: STAFF_ID_2, serviceId: GROUP_SERVICE_ID, variantId: GROUP_VARIANT_ID, participantCount: 1 });

      const dateStr = day.toISOString().slice(0, 10);
      const { statusCode, body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(statusCode).toBe(200);

      expect(body.data.staffTimelines[STAFF_ID_1]).toEqual([
        { start_time: at(10, 0).toISOString(), end_time: at(11, 0).toISOString(), booked: 4, capacity: 4 },
      ]);
      expect(body.data.staffTimelines[STAFF_ID_2]).toEqual([
        { start_time: at(10, 0).toISOString(), end_time: at(11, 0).toISOString(), booked: 1, capacity: 4 },
      ]);
    });

    it('a staff member\'s capacity ceiling is taken from whichever service they\'re running at that moment', async () => {
      // Coach One runs the default service (capacity 5) at 9am, then the group class (capacity 4)
      // at 10am — the staff timeline's capacity must switch accordingly rather than staying pinned
      // to one fixed number for the whole day.
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 22);
      const at = (h: number, m: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0));

      await insertBooking({ startTime: at(9, 0), endTime: at(9, 30), staffId: STAFF_ID_1, serviceId: SERVICE_ID, variantId: VARIANT_ID, participantCount: 1 });
      await insertBooking({ startTime: at(10, 0), endTime: at(10, 30), staffId: STAFF_ID_1, serviceId: GROUP_SERVICE_ID, variantId: GROUP_VARIANT_ID, participantCount: 2 });

      const dateStr = day.toISOString().slice(0, 10);
      const { statusCode, body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(statusCode).toBe(200);

      expect(body.data.staffTimelines[STAFF_ID_1]).toEqual([
        { start_time: at(9, 0).toISOString(), end_time: at(9, 30).toISOString(), booked: 1, capacity: 5 },
        { start_time: at(10, 0).toISOString(), end_time: at(10, 30).toISOString(), booked: 2, capacity: 4 },
      ]);
    });

    it('resourceBlocks surfaces a resource schedule block for the day, converted to UTC instants (item 1)', async () => {
      // A business owner blocks part of an otherwise-open day on a specific resource (e.g. a
      // plumber visiting one pool 8-10am) — the calendar must expose that block for resources
      // that appear that day, not just the resource's own bookings.
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 23);
      const at = (h: number, m: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0));
      const dateStr = day.toISOString().slice(0, 10);

      await insertBooking({ startTime: at(14, 0), endTime: at(15, 0), resourceId: RESOURCE_ID });
      await adminPool.query(
        `INSERT INTO res_schedule_blocks (resource_id, block_date, start_time, end_time, reason) VALUES ($1, $2, '08:00:00', '10:00:00', 'Plumber visit')`,
        [RESOURCE_ID, dateStr],
      );

      try {
        const { statusCode, body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
        expect(statusCode).toBe(200);
        expect(body.data.resourceBlocks[RESOURCE_ID]).toEqual([
          { start_time: at(8, 0).toISOString(), end_time: at(10, 0).toISOString(), reason: 'Plumber visit' },
        ]);
      } finally {
        await adminPool.query(`DELETE FROM res_schedule_blocks WHERE resource_id = $1 AND block_date = $2`, [RESOURCE_ID, dateStr]);
      }
    });

    it('resourceBlocks is empty for resources with no blocks that day', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 24);
      const at = (h: number, m: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0));
      const dateStr = day.toISOString().slice(0, 10);

      await insertBooking({ startTime: at(14, 0), endTime: at(15, 0), resourceId: RESOURCE_ID });

      const { statusCode, body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.resourceBlocks[RESOURCE_ID] ?? []).toEqual([]);
    });
  });

  describe('Payment status (item 3c-b)', () => {
    // insertBooking always prices at 5000 cents ($50).
    async function insertTransaction(bookingId: string, type: 'charge' | 'refund' | 'credit', amount: number, status = 'completed') {
      await adminPool.query(
        `INSERT INTO pay_transactions (business_id, customer_id, booking_id, type, status, amount) VALUES ($1, $2, $3, $4, $5, $6)`,
        [BUSINESS_ID, CUSTOMER_ID, bookingId, type, status, amount],
      );
    }

    it('a booking with a completed charge covering its full price shows as paid', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 25);
      const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0));
      const id = await insertBooking({ startTime: start });
      await insertTransaction(id, 'charge', 5000);

      const dateStr = day.toISOString().slice(0, 10);
      const { body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(body.data.bookings.find((b: any) => b.id === id).payment_status).toBe('paid');
    });

    it('a booking with a partial charge shows as partial', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 26);
      const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0));
      const id = await insertBooking({ startTime: start });
      await insertTransaction(id, 'charge', 2000);

      const dateStr = day.toISOString().slice(0, 10);
      const { body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(body.data.bookings.find((b: any) => b.id === id).payment_status).toBe('partial');
    });

    it('a booking with no payment transactions at all shows as unpaid, not neutral', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 27);
      const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0));
      const id = await insertBooking({ startTime: start });

      const dateStr = day.toISOString().slice(0, 10);
      const { body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(body.data.bookings.find((b: any) => b.id === id).payment_status).toBe('unpaid');
    });

    it('a fully refunded charge shows as unpaid again, not paid', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 28);
      const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0));
      const id = await insertBooking({ startTime: start });
      await insertTransaction(id, 'charge', 5000);
      await insertTransaction(id, 'refund', 5000);

      const dateStr = day.toISOString().slice(0, 10);
      const { body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(body.data.bookings.find((b: any) => b.id === id).payment_status).toBe('unpaid');
    });

    it('a pending (not completed) charge does not count toward payment status', async () => {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 29);
      const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0));
      const id = await insertBooking({ startTime: start });
      await insertTransaction(id, 'charge', 5000, 'pending');

      const dateStr = day.toISOString().slice(0, 10);
      const { body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=day&date=${dateStr}`, undefined, ownerToken);
      expect(body.data.bookings.find((b: any) => b.id === id).payment_status).toBe('unpaid');
    });
  });

  describe('derivePaymentStatus (pure function, item 3c-b)', () => {
    it('a free booking (price 0) is always paid', () => {
      expect(derivePaymentStatus(0, 0)).toBe('paid');
    });

    it('net paid meeting or exceeding price is paid', () => {
      expect(derivePaymentStatus(5000, 5000)).toBe('paid');
      expect(derivePaymentStatus(5000, 6000)).toBe('paid'); // overpayment still reads as paid
    });

    it('net paid between 0 and price is partial', () => {
      expect(derivePaymentStatus(5000, 1)).toBe('partial');
      expect(derivePaymentStatus(5000, 4999)).toBe('partial');
    });

    it('zero or negative net paid is unpaid', () => {
      expect(derivePaymentStatus(5000, 0)).toBe('unpaid');
      expect(derivePaymentStatus(5000, -500)).toBe('unpaid'); // e.g. an over-refund
    });
  });

  describe('Month view timezone bucketing (item 2 fix: bookings no longer shift to the wrong day)', () => {
    it('a booking at 11pm business-local time buckets under its own local day, not the next UTC day', async () => {
      // Fixed-offset zone (no DST) so the test is deterministic regardless of when it runs.
      await adminPool.query(`UPDATE sys_businesses SET timezone = 'Etc/GMT+8' WHERE id = $1`, [BUSINESS_ID]);
      try {
        const day = new Date();
        day.setUTCDate(day.getUTCDate() + 20);
        const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate();

        // 23:00 local (Etc/GMT+8 = UTC-8) on day `d` is 07:00 UTC on day `d+1` — the old UTC-day
        // bucketing would file this under `d+1`, not the local day `d` it actually belongs to.
        const startUtc = new Date(Date.UTC(y, m, d + 1, 7, 0, 0));
        await insertBooking({ startTime: startUtc, endTime: new Date(startUtc.getTime() + 30 * 60000) });

        const monthStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const { statusCode, body } = await request('GET', `/api/v1/bookings/calendar?business_id=${BUSINESS_ID}&view=month&date=${monthStr}`, undefined, ownerToken);
        expect(statusCode).toBe(200);

        const localDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const nextDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
        const dayEntry = body.data.days.find((r: any) => (typeof r.date === 'string' ? r.date.split('T')[0] : r.date) === localDateStr);
        const wrongDayEntry = body.data.days.find((r: any) => (typeof r.date === 'string' ? r.date.split('T')[0] : r.date) === nextDateStr);

        expect(dayEntry).toBeDefined();
        expect(dayEntry.count).toBe(1);
        expect(wrongDayEntry).toBeUndefined();
      } finally {
        await adminPool.query(`UPDATE sys_businesses SET timezone = 'UTC' WHERE id = $1`, [BUSINESS_ID]);
      }
    });
  });

  describe('computeCapacitySegments (pure function, revised to carry capacity per-booking)', () => {
    it('returns no segments for an empty booking list or a booking whose own capacity is zero/negative', () => {
      expect(computeCapacitySegments([])).toEqual([]);
      expect(computeCapacitySegments([{ start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T11:00:00.000Z', participant_count: 1, capacity: 0 }])).toEqual([]);
    });

    it('a single booking produces exactly one segment spanning its own interval', () => {
      const segs = computeCapacitySegments(
        [{ start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T11:00:00.000Z', participant_count: 2, capacity: 5 }],
      );
      expect(segs).toEqual([{ start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T11:00:00.000Z', booked: 2, capacity: 5 }]);
    });

    it('two back-to-back (non-overlapping) bookings with the same headcount and capacity merge into one segment', () => {
      const segs = computeCapacitySegments(
        [
          { start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T11:00:00.000Z', participant_count: 2, capacity: 5 },
          { start_time: '2026-01-01T11:00:00.000Z', end_time: '2026-01-01T12:00:00.000Z', participant_count: 2, capacity: 5 },
        ],
      );
      expect(segs).toEqual([{ start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T12:00:00.000Z', booked: 2, capacity: 5 }]);
    });

    it('a segment\'s capacity is the max ceiling of whichever bookings are active during it (staff mixing services)', () => {
      const segs = computeCapacitySegments([
        { start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T11:00:00.000Z', participant_count: 1, capacity: 1 },
        { start_time: '2026-01-01T10:30:00.000Z', end_time: '2026-01-01T11:00:00.000Z', participant_count: 3, capacity: 4 },
      ]);
      expect(segs).toEqual([
        { start_time: '2026-01-01T10:00:00.000Z', end_time: '2026-01-01T10:30:00.000Z', booked: 1, capacity: 1 },
        { start_time: '2026-01-01T10:30:00.000Z', end_time: '2026-01-01T11:00:00.000Z', booked: 4, capacity: 4 },
      ]);
    });

    describe('Property: every point covered by a source booking is accounted for by exactly the right headcount', () => {
      // For any set of bookings, sampling the midpoint of every returned segment must reproduce
      // that segment's own `booked` value via a brute-force sweep — and every source booking's own
      // midpoint must be covered by a segment whose booked count is >= that booking's own count.
      it('segments correctly represent true concurrent headcount and max capacity ceiling at their own midpoint', () => {
        const bookingArb = fc.record({
          offsetMin: fc.integer({ min: 0, max: 180 }),
          durationMin: fc.integer({ min: 15, max: 120 }),
          participantCount: fc.integer({ min: 1, max: 4 }),
          capacity: fc.integer({ min: 1, max: 6 }),
        });

        fc.assert(
          fc.property(fc.array(bookingArb, { minLength: 1, maxLength: 6 }), (specs) => {
            const base = Date.UTC(2026, 0, 1, 6, 0, 0);
            const bookings = specs.map((s) => ({
              start_time: new Date(base + s.offsetMin * 60000).toISOString(),
              end_time: new Date(base + (s.offsetMin + s.durationMin) * 60000).toISOString(),
              participant_count: s.participantCount,
              capacity: s.capacity,
            }));

            const coveringAt = (t: number) => bookings.filter((b) => {
              const s = new Date(b.start_time).getTime();
              const e = new Date(b.end_time).getTime();
              return s <= t && e > t;
            });

            const segments = computeCapacitySegments(bookings);

            for (const seg of segments) {
              const mid = (new Date(seg.start_time).getTime() + new Date(seg.end_time).getTime()) / 2;
              const covering = coveringAt(mid);
              expect(seg.booked).toBe(covering.reduce((sum, b) => sum + b.participant_count, 0));
              expect(seg.capacity).toBe(Math.max(...covering.map((b) => b.capacity)));
            }

            // Every source booking's own midpoint must be covered by some returned segment
            // (never silently dropped), since its own count is always >= 1 > 0.
            for (const b of bookings) {
              const s = new Date(b.start_time).getTime();
              const e = new Date(b.end_time).getTime();
              if (s >= e) continue;
              const mid = (s + e) / 2;
              const covering = segments.find((seg) => new Date(seg.start_time).getTime() <= mid && new Date(seg.end_time).getTime() > mid);
              expect(covering).toBeDefined();
            }
          }),
          { numRuns: 100 },
        );
      });
    });
  });
});
