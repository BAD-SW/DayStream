import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let ownerToken: string;
let CATEGORY_ID: string;
let PARENT_CATEGORY_ID: string;

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

describe('Service Categories API', () => {
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Service Cat Test Biz', 'service-cat-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Service Cat Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up any leftover test categories
    await adminPool.query(
      "DELETE FROM service_categories WHERE business_id = $1",
      [BUSINESS_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /api/v1/services/categories', () => {
    it('creates a category', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/categories',
        { business_id: BUSINESS_ID, name: 'Recovery Services', icon: 'snowflake' },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Recovery Services');
      expect(body.data.icon).toBe('snowflake');
      expect(body.data.status).toBe('active');
      PARENT_CATEGORY_ID = body.data.id;
    });

    it('creates a subcategory (child)', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/categories',
        { business_id: BUSINESS_ID, name: 'Cold Therapy', parent_id: PARENT_CATEGORY_ID },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.parent_id).toBe(PARENT_CATEGORY_ID);
      CATEGORY_ID = body.data.id;
    });

    it('rejects 3rd-level nesting', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/categories',
        { business_id: BUSINESS_ID, name: 'Too Deep', parent_id: CATEGORY_ID },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('depth');
    });

    it('rejects duplicate name within same parent', async () => {
      // 'Cold Therapy' was already created under PARENT_CATEGORY_ID
      const { statusCode } = await request(
        'POST', '/api/v1/services/categories',
        { business_id: BUSINESS_ID, name: 'Cold Therapy', parent_id: PARENT_CATEGORY_ID },
        ownerToken,
      );

      expect(statusCode).toBe(409);
    });
  });

  describe('GET /api/v1/services/categories', () => {
    it('lists categories with service counts', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/categories?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data[0]).toHaveProperty('service_count');
    });

    it('requires business_id', async () => {
      const { statusCode } = await request(
        'GET', '/api/v1/services/categories',
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
    });
  });

  describe('PUT /api/v1/services/categories/:id', () => {
    it('updates a category', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/categories/${PARENT_CATEGORY_ID}?business_id=${BUSINESS_ID}`,
        { name: 'Recovery & Wellness', icon: 'heart' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.name).toBe('Recovery & Wellness');
      expect(body.data.icon).toBe('heart');
    });

    it('returns 404 for non-existent category', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/services/categories/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        { name: 'Ghost' },
        ownerToken,
      );
      expect(statusCode).toBe(404);
    });

    it('rejects self-referencing parent', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/categories/${PARENT_CATEGORY_ID}?business_id=${BUSINESS_ID}`,
        { parent_id: PARENT_CATEGORY_ID },
        ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.error).toContain('own parent');
    });
  });

  describe('DELETE /api/v1/services/categories/:id', () => {
    it('archives a category', async () => {
      // Create a category to archive
      const { body: created } = await request(
        'POST', '/api/v1/services/categories',
        { business_id: BUSINESS_ID, name: 'To Archive' },
        ownerToken,
      );

      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/categories/${created.data.id}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.archived).toBe(true);
    });

    it('returns 404 for non-existent category', async () => {
      const { statusCode } = await request(
        'DELETE', `/api/v1/services/categories/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });
});
