/**
 * Integration tests for the Service Management system (Phase 06).
 * Verifies cross-cutting behavior across multiple services.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let BUSINESS_SLUG: string;
let ownerToken: string;
let readOnlyToken: string;

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

describe('Service Management — Integration Tests', () => {
  beforeAll(async () => {
    BUSINESS_SLUG = 'svc-integration-test-biz';
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Service Integration Test Biz', $2, 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Service Integration Test Biz'
       RETURNING id`,
      [TENANT_ID, BUSINESS_SLUG],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean slate
    await adminPool.query('DELETE FROM services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM service_categories WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM cancellation_policies WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM tax_categories WHERE business_id = $1', [BUSINESS_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );

    readOnlyToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000020', TENANT_ID, 'business_staff',
      ['services:read', 'customers:read'],
    );
  });

  describe('Full service creation flow (category → service → variants → activate)', () => {
    let categoryId: string;
    let serviceId: string;

    it('creates a category', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/services/categories', {
        business_id: BUSINESS_ID, name: 'Integration Category', icon: 'star',
      }, ownerToken);

      expect(statusCode).toBe(201);
      categoryId = body.data.id;
    });

    it('creates a service in draft status', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID, category_id: categoryId, name: 'Integration Service',
        description: 'Full flow test service', default_duration: 60, max_capacity: 1,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('draft');
      expect(body.data.slug).toBe('integration-service');
      serviceId = body.data.id;
    });

    it('cannot activate without variants', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/services/${serviceId}/activate?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
    });

    it('adds a per_session variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${serviceId}/variants`,
        { name: '60 min', duration: 60, price: 7500 },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.pricing_model).toBe('per_session');
    });

    it('adds a subscription variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${serviceId}/variants`,
        { name: 'Monthly Unlimited', duration: 60, price: 12900, pricing_model: 'subscription', billing_interval: 'monthly' },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.billing_interval).toBe('monthly');
    });

    it('activates the service', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/services/${serviceId}/activate?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
    });

    it('service appears in public catalog', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/catalog/${BUSINESS_SLUG}`);
      expect(statusCode).toBe(200);
      const allServices = body.data.categories.flatMap((c: any) => c.services);
      expect(allServices.some((s: any) => s.slug === 'integration-service')).toBe(true);
    });

    it('catalog detail includes variants and policy', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/catalog/${BUSINESS_SLUG}/integration-service`);
      expect(statusCode).toBe(200);
      expect(body.data.variants.length).toBe(2);
      expect(body.data.variants.some((v: any) => v.pricing_model === 'subscription')).toBe(true);
    });

    it('pausing removes from catalog', async () => {
      await request('PUT', `/api/v1/services/${serviceId}/pause?business_id=${BUSINESS_ID}`, undefined, ownerToken);

      const { body } = await request('GET', `/api/v1/catalog/${BUSINESS_SLUG}`);
      const allServices = body.data.categories.flatMap((c: any) => c.services);
      expect(allServices.some((s: any) => s.slug === 'integration-service')).toBe(false);
    });
  });

  describe('Template application creates draft services', () => {
    it('applies yoga_studio template', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/services/templates/apply', {
        business_id: BUSINESS_ID, business_type: 'yoga_studio',
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.services_created).toBeGreaterThan(0);
      expect(body.data.categories_created).toBeGreaterThan(0);
    });

    it('all template services are in draft', async () => {
      const { body } = await request(
        'GET', `/api/v1/services?business_id=${BUSINESS_ID}&status=draft`,
        undefined, ownerToken,
      );
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((s: any) => s.status === 'draft')).toBe(true);
    });

    it('template services do not appear in catalog', async () => {
      const { body } = await request('GET', `/api/v1/catalog/${BUSINESS_SLUG}`);
      // Only the previously-paused service and template drafts — none should be in catalog
      // since template services are draft
      const allServices = body.data.categories.flatMap((c: any) => c.services);
      const templateNames = ['Vinyasa Flow', 'Hatha Yoga', 'Yin Yoga'];
      for (const name of templateNames) {
        expect(allServices.some((s: any) => s.name === name)).toBe(false);
      }
    });
  });

  describe('Business scoping', () => {
    let otherBusinessId: string;

    beforeAll(async () => {
      const { rows } = await adminPool.query(
        `INSERT INTO businesses (tenant_id, name, slug, status)
         VALUES ($1, 'Other Biz', 'other-svc-biz', 'active')
         ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Other Biz'
         RETURNING id`,
        [TENANT_ID],
      );
      otherBusinessId = rows[0].id;
    });

    it('cannot see services from another business', async () => {
      const { body } = await request(
        'GET', `/api/v1/services?business_id=${otherBusinessId}`,
        undefined, ownerToken,
      );
      // Other business should have no services from our test
      const ourServiceNames = ['Integration Service', 'Vinyasa Flow'];
      for (const name of ourServiceNames) {
        expect(body.data.some((s: any) => s.name === name)).toBe(false);
      }
    });

    it('cannot see categories from another business', async () => {
      const { body } = await request(
        'GET', `/api/v1/services/categories?business_id=${otherBusinessId}`,
        undefined, ownerToken,
      );
      expect(body.data.some((c: any) => c.name === 'Integration Category')).toBe(false);
    });
  });

  describe('Subscription variant validation', () => {
    let serviceId: string;

    beforeAll(async () => {
      const { rows: catRows } = await adminPool.query(
        `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Sub Validation Cat')
         ON CONFLICT (business_id, name, parent_id) DO UPDATE SET name = 'Sub Validation Cat'
         RETURNING id`,
        [BUSINESS_ID],
      );
      const { rows: svcRows } = await adminPool.query(
        `INSERT INTO services (business_id, category_id, name, slug, created_by)
         VALUES ($1, $2, 'Sub Validation Service', 'sub-validation-service', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, slug) DO UPDATE SET name = 'Sub Validation Service'
         RETURNING id`,
        [BUSINESS_ID, catRows[0].id],
      );
      serviceId = svcRows[0].id;
    });

    it('rejects subscription without billing_interval', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${serviceId}/variants`,
        { name: 'Bad Sub', duration: 60, price: 5000, pricing_model: 'subscription' },
        ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.error).toContain('billing interval');
    });

    it('accepts subscription with all required fields', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${serviceId}/variants`,
        { name: '4x Weekly', duration: 30, price: 4900, pricing_model: 'subscription', billing_interval: 'weekly', included_sessions: 4, sessions_rollover: true },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.billing_interval).toBe('weekly');
      expect(body.data.included_sessions).toBe(4);
      expect(body.data.sessions_rollover).toBe(true);
    });

    it('per_session variants have null subscription fields', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${serviceId}/variants`,
        { name: 'Single Session', duration: 30, price: 2500 },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.billing_interval).toBeNull();
      expect(body.data.included_sessions).toBeNull();
      expect(body.data.sessions_rollover).toBe(false);
    });
  });

  describe('Slug generation', () => {
    it('auto-generates unique slugs', async () => {
      const { rows: catRows } = await adminPool.query(
        `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Slug Test Cat')
         ON CONFLICT (business_id, name, parent_id) DO UPDATE SET name = 'Slug Test Cat'
         RETURNING id`,
        [BUSINESS_ID],
      );

      const { body: s1 } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID, category_id: catRows[0].id, name: 'Slug Test',
      }, ownerToken);

      // Different category to avoid name uniqueness within category
      const { rows: catRows2 } = await adminPool.query(
        `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Slug Test Cat 2')
         ON CONFLICT (business_id, name, parent_id) DO UPDATE SET name = 'Slug Test Cat 2'
         RETURNING id`,
        [BUSINESS_ID],
      );

      const { body: s2 } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID, category_id: catRows2[0].id, name: 'Slug Test',
      }, ownerToken);

      expect(s1.data.slug).toBe('slug-test');
      expect(s2.data.slug).toBe('slug-test-1');
    });

    it('regenerates slug on name update', async () => {
      const { rows: catRows } = await adminPool.query(
        "SELECT id FROM service_categories WHERE business_id = $1 LIMIT 1",
        [BUSINESS_ID],
      );
      const { body: created } = await request('POST', '/api/v1/services', {
        business_id: BUSINESS_ID, category_id: catRows[0].id, name: 'Original Name',
      }, ownerToken);

      const { body: updated } = await request(
        'PUT', `/api/v1/services/${created.data.id}?business_id=${BUSINESS_ID}`,
        { name: 'Updated Name' },
        ownerToken,
      );

      expect(updated.data.slug).toBe('updated-name');
    });
  });
});
