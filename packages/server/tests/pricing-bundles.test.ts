import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as bundlesService from '../src/services/pricing-bundles.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let VARIANT_ID_1: string;
let VARIANT_ID_2: string;
let BUNDLE_ID: string;
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

describe('Pricing Bundles', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Bundle Test Biz', 'bundle-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Bundle Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM pri_bundles WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Create 2 services with variants
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Bundle Cat') RETURNING id`, [BUSINESS_ID],
    );
    const { rows: svc1 } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, created_by)
       VALUES ($1, $2, 'Massage', 'massage', 'active', '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    const { rows: svc2 } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, created_by)
       VALUES ($1, $2, 'Sauna', 'sauna', 'active', '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );

    const { rows: v1 } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active') RETURNING id`,
      [svc1[0].id],
    );
    VARIANT_ID_1 = v1[0].id;

    const { rows: v2 } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '45 min', 45, 3500, 'active') RETURNING id`,
      [svc2[0].id],
    );
    VARIANT_ID_2 = v2[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /pricing/bundles', () => {
    it('creates a fixed price bundle', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/bundles', {
        business_id: BUSINESS_ID,
        name: 'Recovery Package',
        bundle_type: 'fixed_price',
        bundle_price: 9500, // €95 (vs €75 + €35 = €110 individual)
        items: [{ variant_id: VARIANT_ID_1 }, { variant_id: VARIANT_ID_2 }],
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Recovery Package');
      expect(body.data.bundle_type).toBe('fixed_price');
      expect(body.data.bundle_price).toBe(9500);
      BUNDLE_ID = body.data.id;
    });

    it('creates a percentage off bundle', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/bundles', {
        business_id: BUSINESS_ID,
        name: '3-Session Deal',
        bundle_type: 'percentage_off',
        discount_percentage: 15,
        items: [{ variant_id: VARIANT_ID_1, quantity: 3 }],
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.discount_percentage).toBe(15);
    });

    it('rejects fixed_price without price', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/bundles', {
        business_id: BUSINESS_ID, name: 'Bad Bundle', bundle_type: 'fixed_price',
        items: [{ variant_id: VARIANT_ID_1 }],
      }, ownerToken);

      expect(statusCode).toBe(400);
      expect(body.error).toContain('bundle_price');
    });
  });

  describe('GET /pricing/bundles', () => {
    it('lists bundles with items', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/bundles?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(2);
      expect(body.data[0].items.length).toBeGreaterThan(0);
      expect(body.data[0].items[0]).toHaveProperty('variant_name');
      expect(body.data[0].items[0]).toHaveProperty('price');
    });
  });

  describe('Bundle savings calculation', () => {
    it('calculates savings for fixed price bundle', async () => {
      const bundle = await bundlesService.getBundleById(BUNDLE_ID, BUSINESS_ID);
      expect(bundle).not.toBeNull();
      expect(bundle!.individual_total).toBe(11000); // 7500 + 3500
      expect(bundle!.savings).toBe(1500);            // 11000 - 9500
    });

    it('calculates savings for percentage bundle', () => {
      const result = bundlesService.calculateBundlePrice({
        bundle_type: 'percentage_off',
        discount_percentage: 15,
        items: [{ price: 7500, quantity: 3 }],
      });

      expect(result.individual_total).toBe(22500);  // 7500 × 3
      expect(result.bundle_price).toBe(19125);      // 22500 × 85%
      expect(result.savings).toBe(3375);            // 22500 - 19125
    });
  });

  describe('PUT /pricing/bundles/:id', () => {
    it('updates bundle price', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/pricing/bundles/${BUNDLE_ID}?business_id=${BUSINESS_ID}`,
        { bundle_price: 8900 }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.bundle_price).toBe(8900);
    });
  });

  describe('DELETE /pricing/bundles/:id', () => {
    it('archives a bundle', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/pricing/bundles/${BUNDLE_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.archived).toBe(true);
    });
  });
});
