import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let SUB_VARIANT_ID: string;
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

describe('Service Variants API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Variants Test Biz', 'variants-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Variants Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean up
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Create category + service
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Variant Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, default_duration, created_by)
       VALUES ($1, $2, 'Variant Test Service', 'variant-test-service', 60, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /services/:id/variants — per_session', () => {
    it('creates a per_session variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/variants`,
        { name: '60 minutes', duration: 60, price: 7500 },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('60 minutes');
      expect(body.data.pricing_model).toBe('per_session');
      expect(body.data.price).toBe(7500);
      expect(body.data.billing_interval).toBeNull();
      VARIANT_ID = body.data.id;
    });

    it('creates a 30-min variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/variants`,
        { name: '30 minutes', duration: 30, price: 4500, display_order: 0 },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.duration).toBe(30);
    });
  });

  describe('POST /services/:id/variants — subscription', () => {
    it('creates a subscription variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/variants`,
        {
          name: 'Monthly Unlimited',
          duration: 60,
          price: 12900,
          pricing_model: 'subscription',
          billing_interval: 'monthly',
          included_sessions: null,
          sessions_rollover: false,
        },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.pricing_model).toBe('subscription');
      expect(body.data.billing_interval).toBe('monthly');
      expect(body.data.included_sessions).toBeNull();
      SUB_VARIANT_ID = body.data.id;
    });

    it('creates a capped subscription variant', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/variants`,
        {
          name: '4x Monthly',
          duration: 45,
          price: 9900,
          pricing_model: 'subscription',
          billing_interval: 'monthly',
          included_sessions: 4,
          sessions_rollover: true,
        },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.included_sessions).toBe(4);
      expect(body.data.sessions_rollover).toBe(true);
    });

    it('rejects subscription without billing_interval', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/variants`,
        { name: 'Bad Sub', duration: 60, price: 5000, pricing_model: 'subscription' },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('billing interval');
    });
  });

  describe('GET /services/:id/variants', () => {
    it('lists all variants for a service', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/${SERVICE_ID}/variants`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('PUT /services/:id/variants/:variantId', () => {
    it('updates variant price and name', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/variants/${VARIANT_ID}`,
        { price: 8000, name: '60 min Premium' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.price).toBe(8000);
      expect(body.data.name).toBe('60 min Premium');
    });

    it('returns 404 for non-existent variant', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/services/${SERVICE_ID}/variants/00000000-0000-0000-0000-999999999999`,
        { price: 100 },
        ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });

  describe('DELETE /services/:id/variants/:variantId', () => {
    it('deletes a variant', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/variants/${SUB_VARIANT_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });

    it('prevents deleting last active variant of active service', async () => {
      // Activate the service (it has active variants)
      await adminPool.query("UPDATE svc_services SET status = 'active' WHERE id = $1", [SERVICE_ID]);

      // Deactivate all but one variant
      await adminPool.query(
        "UPDATE svc_variants SET status = 'inactive' WHERE service_id = $1 AND id != $2",
        [SERVICE_ID, VARIANT_ID],
      );

      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/variants/${VARIANT_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('last active variant');
    });
  });
});
