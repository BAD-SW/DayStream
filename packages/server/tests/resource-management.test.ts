import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let TYPE_ID: string;
let RESOURCE_ID: string;
let RESOURCE_2_ID: string;
let SCHEDULE_ID: string;
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

describe('Resource Management', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Resource Test Biz', 'resource-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Resource Test Biz' RETURNING id`, [TENANT_ID]);
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM res_resources WHERE tenant_id = $1', [TENANT_ID]);
    await adminPool.query('DELETE FROM res_types WHERE tenant_id = $1 AND is_system = false', [TENANT_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['resources:*', 'services:*', 'bookings:*'],
    );
  });

  // ==================== Resource Types ====================
  describe('Resource Types', () => {
    it('creates a custom resource type', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/resources/types', {
        name: 'Infrared Sauna', category: 'equipment', description: 'Far-infrared sauna cabin',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Infrared Sauna');
      expect(body.data.category).toBe('equipment');
      TYPE_ID = body.data.id;
    });

    it('lists resource types', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/resources/types', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('updates a resource type', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/resources/types/${TYPE_ID}`, {
        description: 'Updated description',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.description).toBe('Updated description');
    });

    it('prevents duplicate type names', async () => {
      const { statusCode } = await request('POST', '/api/v1/resources/types', {
        name: 'Infrared Sauna', category: 'equipment',
      }, ownerToken);
      expect(statusCode).toBe(409);
    });
  });

  // ==================== Resource CRUD ====================
  describe('Resources', () => {
    it('creates a resource', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/resources', {
        resource_type_id: TYPE_ID, name: 'Sauna Room 1',
        description: 'Main infrared sauna', capacity: 4, buffer_minutes: 15,
        custom_attributes: { temperature_max: 75 },
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Sauna Room 1');
      expect(body.data.capacity).toBe(4);
      expect(body.data.buffer_minutes).toBe(15);
      RESOURCE_ID = body.data.id;
    });

    it('creates a second resource (exclusive)', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/resources', {
        resource_type_id: TYPE_ID, name: 'Float Tank 1',
        capacity: 1, buffer_minutes: 30, is_24_7: true,
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.capacity).toBe(1);
      expect(body.data.is_24_7).toBe(true);
      RESOURCE_2_ID = body.data.id;
    });

    it('lists resources', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/resources', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('gets a resource by ID', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/resources/${RESOURCE_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.name).toBe('Sauna Room 1');
      expect(body.data.custom_attributes.temperature_max).toBe(75);
    });

    it('updates a resource', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/resources/${RESOURCE_ID}`, {
        description: 'Premium infrared sauna cabin',
      }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.description).toBe('Premium infrared sauna cabin');
    });

    it('searches resources', async () => {
      const { statusCode, body } = await request('GET', '/api/v1/resources?search=Float', undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].name).toContain('Float');
    });
  });

  // ==================== Schedules ====================
  describe('Resource Schedules', () => {
    it('creates a schedule with slots', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/schedule`, {
        name: 'Regular Hours', effective_from: '2026-01-01',
        slots: [
          { day_of_week: 1, start_time: '08:00', end_time: '20:00' },
          { day_of_week: 2, start_time: '08:00', end_time: '20:00' },
          { day_of_week: 3, start_time: '08:00', end_time: '20:00' },
          { day_of_week: 4, start_time: '08:00', end_time: '20:00' },
          { day_of_week: 5, start_time: '08:00', end_time: '18:00' },
          { day_of_week: 6, start_time: '09:00', end_time: '14:00' },
        ],
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.slots.length).toBe(6);
      SCHEDULE_ID = body.data.id;
    });

    it('lists schedules', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/resources/${RESOURCE_ID}/schedule`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
    });

    it('adds a schedule block (holiday)', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/schedule/blocks`, {
        block_date: '2026-12-25', reason: 'Christmas',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.reason).toBe('Christmas');
    });

    it('lists schedule blocks', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/resources/${RESOURCE_ID}/schedule/blocks?start_date=2026-12-01&end_date=2026-12-31`,
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
    });
  });

  // ==================== Maintenance ====================
  describe('Maintenance', () => {
    it('creates a recurring maintenance window', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/maintenance`, {
        maintenance_type: 'recurring', day_of_week: 5,
        start_time: '18:00', end_time: '20:00', description: 'Friday deep clean',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.maintenance_type).toBe('recurring');
    });

    it('creates a one-time maintenance', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/maintenance`, {
        maintenance_type: 'one_time', specific_date: '2026-07-15',
        start_time: '08:00', end_time: '12:00', description: 'Annual inspection',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.specific_date).toContain('2026-07-15');
    });

    it('lists maintenance schedules', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/resources/${RESOURCE_ID}/maintenance`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(2);
    });
  });

  // ==================== Resource Bookings & Conflict Prevention ====================
  describe('Bookings & Conflicts', () => {
    it('creates a manual resource booking', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_2_ID}/bookings`, {
        start_time: '2026-06-17T10:00:00Z', end_time: '2026-06-17T11:00:00Z',
        booking_type: 'manual', notes: 'Test booking',
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('confirmed');
    });

    it('prevents double-booking exclusive resource', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_2_ID}/bookings`, {
        start_time: '2026-06-17T10:30:00Z', end_time: '2026-06-17T11:30:00Z',
        booking_type: 'manual',
      }, ownerToken);
      expect(statusCode).toBe(409);
      expect(body.error).toContain('capacity');
    });

    it('allows booking on shared resource within capacity', async () => {
      // Sauna has capacity 4
      const { statusCode: s1 } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/bookings`, {
        start_time: '2026-06-18T10:00:00Z', end_time: '2026-06-18T11:00:00Z', booking_type: 'manual',
      }, ownerToken);
      expect(s1).toBe(201);

      const { statusCode: s2 } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/bookings`, {
        start_time: '2026-06-18T10:00:00Z', end_time: '2026-06-18T11:00:00Z', booking_type: 'manual',
      }, ownerToken);
      expect(s2).toBe(201);

      const { statusCode: s3 } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/bookings`, {
        start_time: '2026-06-18T10:00:00Z', end_time: '2026-06-18T11:00:00Z', booking_type: 'manual',
      }, ownerToken);
      expect(s3).toBe(201);

      const { statusCode: s4 } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/bookings`, {
        start_time: '2026-06-18T10:00:00Z', end_time: '2026-06-18T11:00:00Z', booking_type: 'manual',
      }, ownerToken);
      expect(s4).toBe(201);
    });

    it('blocks booking when shared resource is at capacity', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/bookings`, {
        start_time: '2026-06-18T10:00:00Z', end_time: '2026-06-18T11:00:00Z', booking_type: 'manual',
      }, ownerToken);
      expect(statusCode).toBe(409);
      expect(body.error).toContain('capacity');
    });

    it('lists resource bookings', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/resources/${RESOURCE_ID}/bookings?start_date=2026-06-18&end_date=2026-06-18`,
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(4);
    });

    it('cancels a resource booking', async () => {
      const { body: listBody } = await request('GET',
        `/api/v1/resources/${RESOURCE_2_ID}/bookings?start_date=2026-06-17&end_date=2026-06-17`,
        undefined, ownerToken);
      const bookingId = listBody.data[0]?.id;

      const { statusCode, body } = await request('DELETE',
        `/api/v1/resources/${RESOURCE_2_ID}/bookings/${bookingId}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('cancelled');
    });
  });

  // ==================== Dependencies ====================
  describe('Dependencies', () => {
    it('adds a dependency', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_2_ID}/dependencies`, {
        depends_on_id: RESOURCE_ID, offset_minutes: 0, duration_minutes: 60,
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.depends_on_id).toBe(RESOURCE_ID);
    });

    it('prevents circular dependencies', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/dependencies`, {
        depends_on_id: RESOURCE_2_ID,
      }, ownerToken);
      expect(statusCode).toBe(400);
      expect(body.error).toContain('Circular');
    });

    it('prevents self-dependency', async () => {
      const { statusCode, body } = await request('POST', `/api/v1/resources/${RESOURCE_ID}/dependencies`, {
        depends_on_id: RESOURCE_ID,
      }, ownerToken);
      expect(statusCode).toBe(400);
      expect(body.error).toContain('itself');
    });

    it('lists dependencies', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/resources/${RESOURCE_2_ID}/dependencies`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].depends_on_name).toBe('Sauna Room 1');
    });
  });

  // ==================== Availability ====================
  describe('Availability', () => {
    it('returns availability for a date range', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/resources/${RESOURCE_ID}/availability?start_date=2026-06-15&end_date=2026-06-20`,
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      // Monday 6/15 should have 08:00-20:00
      expect(body.data['2026-06-15']).toBeDefined();
      expect(body.data['2026-06-15'].length).toBe(1);
      expect(body.data['2026-06-15'][0].start_time).toBe('08:00:00');
    });

    it('24/7 resource always shows available', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/resources/${RESOURCE_2_ID}/availability?start_date=2026-06-15&end_date=2026-06-15`,
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data['2026-06-15'].length).toBe(1);
      expect(body.data['2026-06-15'][0].start_time).toBe('00:00:00');
    });
  });

  // ==================== Calendar & Timeline ====================
  describe('Calendar', () => {
    it('gets resource calendar', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/resources/${RESOURCE_ID}/calendar?start_date=2026-06-15&end_date=2026-06-21`,
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('bookings');
      expect(body.data).toHaveProperty('maintenance');
      expect(body.data).toHaveProperty('blocks');
      expect(body.data).toHaveProperty('availability');
    });

    it('gets timeline view', async () => {
      const { statusCode, body } = await request('GET',
        '/api/v1/resources/calendar/timeline?start_date=2026-06-15&end_date=2026-06-21',
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data[0]).toHaveProperty('resource');
      expect(body.data[0]).toHaveProperty('bookings');
    });
  });

  // ==================== Utilization ====================
  describe('Utilization', () => {
    it('gets utilization for a resource', async () => {
      const { statusCode, body } = await request('GET',
        `/api/v1/resources/${RESOURCE_ID}/utilization?start_date=2026-06-01&end_date=2026-06-30`,
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('utilizationRate');
      expect(body.data).toHaveProperty('totalBookings');
      expect(body.data).toHaveProperty('bookedMinutes');
      expect(body.data).toHaveProperty('peakHours');
    });

    it('gets utilization summary for all resources', async () => {
      const { statusCode, body } = await request('GET',
        '/api/v1/resources/utilization?start_date=2026-06-01&end_date=2026-06-30',
        undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('resources');
      expect(body.data).toHaveProperty('summary');
      expect(body.data.summary).toHaveProperty('averageUtilization');
      expect(body.data.summary).toHaveProperty('totalResources');
    });
  });

  // ==================== Deactivation ====================
  describe('Deactivation', () => {
    it('deactivates a resource', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/resources/${RESOURCE_ID}/deactivate`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('inactive');
    });

    it('cannot delete type with resources', async () => {
      const { statusCode, body } = await request('DELETE', `/api/v1/resources/types/${TYPE_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(400);
      expect(body.error).toContain('existing resources');
    });
  });
});
