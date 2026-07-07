import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as historyService from '../src/services/price-history.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let VARIANT_ID: string;
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

describe('Price History', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'History Test Biz', 'history-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'History Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM pri_history WHERE business_id = $1', [BUSINESS_ID]);

    // Get a variant ID for testing
    const { rows } = await adminPool.query(
      `SELECT sv.id FROM svc_variants sv JOIN svc_services s ON s.id = sv.service_id WHERE s.business_id = $1 LIMIT 1`,
      [BUSINESS_ID],
    );
    if (rows.length > 0) {
      VARIANT_ID = rows[0].id;
    } else {
      // Create one
      const { rows: catRows } = await adminPool.query(
        `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'History Cat')
         ON CONFLICT (business_id, name, parent_id) DO UPDATE SET name = 'History Cat' RETURNING id`, [BUSINESS_ID],
      );
      const { rows: svcRows } = await adminPool.query(
        `INSERT INTO svc_services (business_id, category_id, name, slug, status, created_by)
         VALUES ($1, $2, 'History Svc', 'history-svc', 'active', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, slug) DO UPDATE SET name = 'History Svc' RETURNING id`,
        [BUSINESS_ID, catRows[0].id],
      );
      const { rows: varRows } = await adminPool.query(
        `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 7500, 'active') RETURNING id`,
        [svcRows[0].id],
      );
      VARIANT_ID = varRows[0].id;
    }

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('Record price changes', () => {
    it('records a price change', async () => {
      await historyService.recordPriceChange(BUSINESS_ID, 'service_variant', VARIANT_ID, 7500, 8500, '00000000-0000-0000-0000-000000000010');

      const history = await historyService.getEntityHistory('service_variant', VARIANT_ID);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].old_price).toBe(7500);
      expect(history[0].new_price).toBe(8500);
    });

    it('records multiple changes with timestamps', async () => {
      await historyService.recordPriceChange(BUSINESS_ID, 'service_variant', VARIANT_ID, 8500, 9000, '00000000-0000-0000-0000-000000000010');

      const history = await historyService.getEntityHistory('service_variant', VARIANT_ID);
      expect(history.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      expect(history[0].new_price).toBe(9000);
      expect(history[1].new_price).toBe(8500);
    });

    it('supports scheduled future price changes', async () => {
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 1);

      await historyService.recordPriceChange(BUSINESS_ID, 'service_variant', VARIANT_ID, 9000, 9500, '00000000-0000-0000-0000-000000000010', futureDate.toISOString());

      const history = await historyService.getEntityHistory('service_variant', VARIANT_ID);
      expect(history.some((h: any) => h.new_price === 9500)).toBe(true);
    });
  });

  describe('Get effective price', () => {
    it('returns current effective price', async () => {
      const price = await historyService.getEffectivePrice('service_variant', VARIANT_ID);
      // Should be the most recent past effective_from entry
      expect(price).toBeGreaterThan(0);
    });

    it('returns null for entity with no history', async () => {
      const price = await historyService.getEffectivePrice('service_variant', '00000000-0000-0000-0000-999999999999');
      expect(price).toBeNull();
    });
  });

  describe('GET /pricing/history', () => {
    it('returns paginated history for a business', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/history?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.meta.total).toBeGreaterThanOrEqual(2);
      expect(body.data[0]).toHaveProperty('old_price');
      expect(body.data[0]).toHaveProperty('new_price');
      expect(body.data[0]).toHaveProperty('entity_type');
    });

    it('filters by entity_type', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/history?business_id=${BUSINESS_ID}&entity_type=service_variant`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.every((e: any) => e.entity_type === 'service_variant')).toBe(true);
    });
  });
});
