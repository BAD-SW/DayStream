import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CATEGORY_ID: string;
let SERVICE_ID: string;
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

describe('Service CRUD API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Service CRUD Test Biz', 'service-crud-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Service CRUD Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Create a category
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Test Category') RETURNING id`,
      [BUSINESS_ID],
    );
    CATEGORY_ID = catRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /api/v1/services', () => {
    it('creates a service with default settings', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID,
        category_id: CATEGORY_ID,
        name: 'Sports Massage',
        description: 'Deep tissue sports massage',
        short_description: 'Recovery massage',
        default_duration: 60,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Sports Massage');
      expect(body.data.slug).toBe('sports-massage');
      expect(body.data.status).toBe('draft');
      expect(body.data.booking_type).toBe('individual');
      expect(body.data.default_duration).toBe(60);
      SERVICE_ID = body.data.id;
    });

    it('auto-generates unique slug on name collision', async () => {
      // Create second service with different category to avoid name uniqueness check
      const { rows: cat2 } = await adminPool.query(
        `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Another Category') RETURNING id`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID,
        category_id: cat2[0].id,
        name: 'Sports Massage',
        default_duration: 30,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.slug).toBe('sports-massage-1');
    });

    it('rejects duplicate name within same category', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID,
        category_id: CATEGORY_ID,
        name: 'Sports Massage',
      }, ownerToken);

      expect(statusCode).toBe(409);
      expect(body.code).toBe('DUPLICATE_NAME');
    });

    it('rejects invalid category', async () => {
      const { statusCode } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID,
        category_id: '00000000-0000-0000-0000-999999999999',
        name: 'Ghost Service',
      }, ownerToken);

      expect(statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/services', () => {
    it('lists services for a business', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.meta.total).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('category_name');
    });

    it('filters by status', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services?business_id=${BUSINESS_ID}&status=draft`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.every((s: any) => s.status === 'draft')).toBe(true);
    });

    it('supports search', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services?business_id=${BUSINESS_ID}&search=massage`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/services/:id', () => {
    it('returns full service detail with relations', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/${SERVICE_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(SERVICE_ID);
      expect(body.data).toHaveProperty('variants');
      expect(body.data).toHaveProperty('images');
      expect(body.data).toHaveProperty('staff');
      expect(body.data).toHaveProperty('availability');
    });

    it('returns 404 for non-existent service', async () => {
      const { statusCode } = await request(
        'GET', `/api/v1/services/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/services/:id', () => {
    it('updates service fields', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}?business_id=${BUSINESS_ID}`,
        { default_duration: 90, buffer_after: 15 },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.default_duration).toBe(90);
      expect(body.data.buffer_after).toBe(15);
    });

    it('regenerates slug when name changes', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}?business_id=${BUSINESS_ID}`,
        { name: 'Deep Tissue Massage' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.slug).toBe('deep-tissue-massage');
    });
  });

  describe('Status transitions', () => {
    it('cannot activate without variants', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/activate?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('variant');
    });

    it('archives a service', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/archive?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.archived).toBe(true);
    });

    it('restores an archived service', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/restore?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.restored).toBe(true);
    });

    it('activates after adding a variant', async () => {
      // Add a variant directly
      await adminPool.query(
        `INSERT INTO svc_variants (service_id, name, duration, price) VALUES ($1, '60 min', 60, 7500)`,
        [SERVICE_ID],
      );

      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/activate?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.activated).toBe(true);
    });

    it('pauses an active service', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/pause?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.paused).toBe(true);
    });
  });
});
