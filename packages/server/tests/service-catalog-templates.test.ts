import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let BUSINESS_SLUG: string;
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

describe('Service Catalog & Templates', () => {
  beforeAll(async () => {
    BUSINESS_SLUG = 'catalog-template-test-biz';
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Catalog Template Test Biz', $2, 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Catalog Template Test Biz'
       RETURNING id`,
      [TENANT_ID, BUSINESS_SLUG],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_cancellation_policies WHERE business_id = $1', [BUSINESS_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ===================== Templates =====================

  describe('GET /services/templates', () => {
    it('lists available templates', async () => {
      const { statusCode, body } = await request(
        'GET', '/api/v1/services/templates',
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.templates.length).toBeGreaterThan(0);
      expect(body.data.business_types.length).toBeGreaterThanOrEqual(5);
      expect(body.data.business_types).toContain('recovery_center');
    });

    it('filters by business type', async () => {
      const { statusCode, body } = await request(
        'GET', '/api/v1/services/templates?business_type=yoga_studio',
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.templates.every((t: any) => t.business_type === 'yoga_studio')).toBe(true);
    });
  });

  describe('POST /services/templates/apply', () => {
    it('applies recovery_center template', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/templates/apply',
        { business_id: BUSINESS_ID, business_type: 'recovery_center' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.business_type).toBe('recovery_center');
      expect(body.data.categories_created).toBeGreaterThan(0);
      expect(body.data.services_created).toBeGreaterThan(0);
      expect(body.data.policy_created).toBe(true);
    });

    it('is additive (does not duplicate on second apply)', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/templates/apply',
        { business_id: BUSINESS_ID, business_type: 'recovery_center' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.categories_created).toBe(0);
      expect(body.data.services_created).toBe(0);
      expect(body.data.policy_created).toBe(false);
    });

    it('services are created in draft status', async () => {
      const { rows } = await adminPool.query(
        "SELECT DISTINCT status FROM svc_services WHERE business_id = $1",
        [BUSINESS_ID],
      );
      expect(rows.every((r: any) => r.status === 'draft')).toBe(true);
    });

    it('rejects unknown business type', async () => {
      const { statusCode } = await request(
        'POST', '/api/v1/services/templates/apply',
        { business_id: BUSINESS_ID, business_type: 'unknown_type' },
        ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });

  // ===================== Catalog =====================

  describe('Public Catalog', () => {
    beforeAll(async () => {
      // Activate some services + add variants for catalog to return
      const { rows: draftServices } = await adminPool.query(
        "SELECT id FROM svc_services WHERE business_id = $1 AND status = 'draft' LIMIT 3",
        [BUSINESS_ID],
      );

      for (const svc of draftServices) {
        // Ensure variant exists
        const { rows: varCheck } = await adminPool.query(
          "SELECT id FROM svc_variants WHERE service_id = $1 AND status = 'active'",
          [svc.id],
        );
        if (varCheck.length === 0) {
          await adminPool.query(
            'INSERT INTO svc_variants (service_id, name, duration, price) VALUES ($1, $2, 60, 5000)',
            [svc.id, '60 min'],
          );
        }
        // Activate
        await adminPool.query(
          "UPDATE svc_services SET status = 'active', online_booking_enabled = true WHERE id = $1",
          [svc.id],
        );
      }
    });

    it('GET /catalog/:businessSlug returns catalog (no auth)', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/catalog/${BUSINESS_SLUG}`,
      );

      expect(statusCode).toBe(200);
      expect(body.data.business.slug).toBe(BUSINESS_SLUG);
      expect(body.data.categories.length).toBeGreaterThan(0);
      expect(body.data.categories[0].services.length).toBeGreaterThan(0);

      const svc = body.data.categories[0].services[0];
      expect(svc).toHaveProperty('name');
      expect(svc).toHaveProperty('slug');
      expect(svc).toHaveProperty('starting_price');
      expect(svc).toHaveProperty('duration_range');
    });

    it('supports search filter', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/catalog/${BUSINESS_SLUG}?search=cold`,
      );

      expect(statusCode).toBe(200);
      // Should find cold plunge or cold therapy services
      const allServices = body.data.categories.flatMap((c: any) => c.services);
      expect(allServices.some((s: any) => s.name.toLowerCase().includes('cold'))).toBe(true);
    });

    it('returns 404 for non-existent business', async () => {
      const { statusCode } = await request('GET', '/api/v1/catalog/nonexistent-biz');
      expect(statusCode).toBe(404);
    });

    it('GET /catalog/:businessSlug/:serviceSlug returns detail', async () => {
      // Get a service slug from the catalog
      const { body: catalogBody } = await request('GET', `/api/v1/catalog/${BUSINESS_SLUG}`);
      const firstService = catalogBody.data.categories[0].services[0];

      const { statusCode, body } = await request(
        'GET', `/api/v1/catalog/${BUSINESS_SLUG}/${firstService.slug}`,
      );

      expect(statusCode).toBe(200);
      expect(body.data.slug).toBe(firstService.slug);
      expect(body.data).toHaveProperty('variants');
      expect(body.data).toHaveProperty('images');
      expect(body.data).toHaveProperty('staff');
      expect(body.data).toHaveProperty('cancellation_policy');
      expect(body.data.variants.length).toBeGreaterThan(0);
    });

    it('detail returns 404 for non-existent service', async () => {
      const { statusCode } = await request(
        'GET', `/api/v1/catalog/${BUSINESS_SLUG}/nonexistent-service`,
      );
      expect(statusCode).toBe(404);
    });

    it('does not show draft/paused services in catalog', async () => {
      const { body } = await request('GET', `/api/v1/catalog/${BUSINESS_SLUG}`);
      const allServices = body.data.categories.flatMap((c: any) => c.services);
      // We only activated 3, so total in catalog should be <= 3
      // Draft services should not appear
      const { rows: draftCount } = await adminPool.query(
        "SELECT COUNT(*)::int AS count FROM svc_services WHERE business_id = $1 AND status = 'draft'",
        [BUSINESS_ID],
      );
      // Catalog should have fewer services than total (since most are draft)
      const { rows: totalCount } = await adminPool.query(
        "SELECT COUNT(*)::int AS count FROM svc_services WHERE business_id = $1",
        [BUSINESS_ID],
      );
      expect(allServices.length).toBeLessThan(totalCount[0].count);
    });
  });
});
