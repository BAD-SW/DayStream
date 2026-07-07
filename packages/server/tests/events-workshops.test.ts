import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let EVENT_TYPE_ID: string;
let EVENT_ID: string;
let TIER_ID: string;
let CUSTOMER_ID: string;
let REG_ID: string;
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

describe('Events & Workshops', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Events Test Biz', 'events-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Events Test Biz' RETURNING id`, [TENANT_ID]);
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM evt_registrations WHERE event_id IN (SELECT id FROM evt_events WHERE tenant_id = $1)', [TENANT_ID]);
    await adminPool.query('DELETE FROM evt_ticket_tiers WHERE event_id IN (SELECT id FROM evt_events WHERE tenant_id = $1)', [TENANT_ID]);
    await adminPool.query('DELETE FROM evt_events WHERE tenant_id = $1', [TENANT_ID]);
    await adminPool.query('DELETE FROM evt_types WHERE tenant_id = $1 AND is_system = false', [TENANT_ID]);

    // Create a test customer
    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (business_id, tenant_id, email, first_name, last_name, reference_number)
       VALUES ($1, $2, 'event-test@example.com', 'Event', 'Tester', 'CUST-EVT-001')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Event' RETURNING id`, [BUSINESS_ID, TENANT_ID]);
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['events:*', 'services:*'],
    );
  });

  describe('Event Types', () => {
    it('creates an event type', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/events/types', {
        name: 'Workshop', slug: 'workshop', description: 'Hands-on workshops',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Workshop');
      EVENT_TYPE_ID = body.data.id;
    });

    it('lists event types', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/events/types', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Event CRUD', () => {
    it('creates an event', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/events', {
        event_type_id: EVENT_TYPE_ID, title: 'Breath & Ice Workshop',
        description: 'Learn Wim Hof breathing techniques', capacity: 20,
        start_time: '2026-07-15T09:00:00Z', end_time: '2026-07-15T12:00:00Z',
        location_name: 'Main Studio', tags: ['wellness', 'breathing'],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.title).toBe('Breath & Ice Workshop');
      expect(body.data.status).toBe('draft');
      expect(body.data.slug).toContain('breath');
      EVENT_ID = body.data.id;
    });

    it('gets an event by ID', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.title).toBe('Breath & Ice Workshop');
      expect(body.data.registrations_count).toBe(0);
    });

    it('updates an event', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/events/${EVENT_ID}`, {
        min_attendees: 5,
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.min_attendees).toBe(5);
    });

    it('publishes an event', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/events/${EVENT_ID}/publish`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('published');
    });

    it('lists events', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/events?status=published', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Ticket Tiers', () => {
    it('creates a ticket tier', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/events/${EVENT_ID}/tickets`, {
        name: 'Early Bird', price: 4500, quantity_available: 10,
        availability_end: '2026-07-10T23:59:59Z',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Early Bird');
      expect(body.data.price).toBe(4500);
      TIER_ID = body.data.id;
    });

    it('creates a free tier', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/events/${EVENT_ID}/tickets`, {
        name: 'Member Free', price: 0, quantity_available: 5, eligibility_type: 'members_only',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.price).toBe(0);
    });

    it('lists tiers', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}/tickets`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(2);
    });
  });

  describe('Registration', () => {
    it('registers for a free event tier (immediately confirmed)', async () => {
      // Use the free tier
      const { body: tiersBody } = await request('GET', `/api/v1/events/${EVENT_ID}/tickets`, undefined, ownerToken);
      const freeTier = tiersBody.data.find((t: any) => t.price === 0);

      const { statusCode, body } = await request('POST', `/api/v1/events/${EVENT_ID}/register`, {
        customer_id: CUSTOMER_ID, ticket_tier_id: freeTier.id,
        attendee_info: { dietary: 'none' },
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('confirmed');
      expect(body.data.reference_number).toMatch(/^EVT-/);
      REG_ID = body.data.id;
    });

    it('lists registrations', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}/registrations`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].first_name).toBe('Event');
    });

    it('enforces capacity', async () => {
      // Create a small-capacity event to test
      const { body: smallEvent } = await request('POST', '/api/v1/events', {
        event_type_id: EVENT_TYPE_ID, title: 'Tiny Event', capacity: 1,
        start_time: '2026-08-01T10:00:00Z', end_time: '2026-08-01T11:00:00Z',
      }, ownerToken);
      await request('PUT', `/api/v1/events/${smallEvent.data.id}/publish`, undefined, ownerToken);

      const { body: tierBody } = await request('POST', `/api/v1/events/${smallEvent.data.id}/tickets`, {
        name: 'Standard', price: 0, quantity_available: 10,
      }, ownerToken);

      // First registration fills capacity
      await request('POST', `/api/v1/events/${smallEvent.data.id}/register`, {
        customer_id: CUSTOMER_ID, ticket_tier_id: tierBody.data.id,
      }, ownerToken);

      // Create another customer for 2nd attempt
      const { rows: cust2 } = await adminPool.query(
        `INSERT INTO cus_customers (business_id, tenant_id, email, first_name, last_name, reference_number)
         VALUES ($1, $2, 'event-test2@example.com', 'Second', 'Person', 'CUST-EVT-002')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Second' RETURNING id`, [BUSINESS_ID, TENANT_ID]);

      // Second should fail (at capacity)
      const { statusCode } = await request('POST', `/api/v1/events/${smallEvent.data.id}/register`, {
        customer_id: cust2[0].id, ticket_tier_id: tierBody.data.id,
      }, ownerToken);
      expect(statusCode).toBe(409);
    });
  });

  describe('Check-In', () => {
    it('checks in by reference number', async () => {
      // Get the registration reference
      const { body: regBody } = await request('GET', `/api/v1/events/${EVENT_ID}/registrations`, undefined, ownerToken);
      const ref = regBody.data[0].reference_number;

      const { statusCode, body } = await request('POST', `/api/v1/events/${EVENT_ID}/check-in/qr`, {
        reference_number: ref,
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.checked_in_at).toBeTruthy();
    });

    it('cannot check in twice', async () => {
      const { body: regBody } = await request('GET', `/api/v1/events/${EVENT_ID}/registrations`, undefined, ownerToken);
      const ref = regBody.data[0].reference_number;

      const { statusCode } = await request('POST', `/api/v1/events/${EVENT_ID}/check-in/qr`, {
        reference_number: ref,
      }, ownerToken);
      expect(statusCode).toBe(404); // already checked in
    });

    it('gets attendee list', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}/attendees`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].checked_in_at).toBeTruthy();
    });
  });

  describe('Communications', () => {
    it('sends an ad-hoc message', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/events/${EVENT_ID}/communications`, {
        subject: 'Important Update', content: 'Please bring a towel!',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.subject).toBe('Important Update');
    });

    it('gets communication history', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}/communications`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reports', () => {
    it('gets event report', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}/reports`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('registrations');
      expect(body.data).toHaveProperty('attendanceRate');
      expect(body.data).toHaveProperty('revenue');
      expect(body.data).toHaveProperty('capacityUtilization');
    });

    it('gets events summary', async () => {
      const { statusCode, body } = await request('GET',
        '/api/v1/events/reports/summary?start_date=2026-01-01&end_date=2026-12-31', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('total_events');
      expect(body.data).toHaveProperty('totalRevenue');
    });

    it('exports attendee list', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/${EVENT_ID}/attendees/export`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('headers');
      expect(body.data).toHaveProperty('rows');
      expect(body.data.totalRows).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Public Calendar', () => {
    it('returns published events without auth', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/events/calendar?tenant_id=${TENANT_ID}`);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      const found = body.data.find((e: any) => e.title === 'Breath & Ice Workshop');
      expect(found).toBeDefined();
    });

    it('does not return draft events', async () => {
      // Create a draft event
      await request('POST', '/api/v1/events', {
        event_type_id: EVENT_TYPE_ID, title: 'Secret Draft', capacity: 10,
        start_time: '2026-09-01T10:00:00Z', end_time: '2026-09-01T12:00:00Z',
      }, ownerToken);

      const { body } = await request('GET', `/api/v1/events/calendar?tenant_id=${TENANT_ID}`);
      const secret = body.data.find((e: any) => e.title === 'Secret Draft');
      expect(secret).toBeUndefined();
    });
  });

  describe('Cancellation', () => {
    it('cancels a registration', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/events/registrations/${REG_ID}/cancel`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('cancelled');
    });

    it('cancels an event', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/events/${EVENT_ID}/cancel`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('cancelled');
    });
  });
});
