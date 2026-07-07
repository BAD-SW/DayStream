import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let TAX_CAT_ID: string;
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

describe('Tax Categories API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Tax Test Biz', 'tax-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Tax Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM svc_tax_categories WHERE business_id = $1', [BUSINESS_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /services/tax-categories', () => {
    it('creates a standard rate tax category', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/tax-categories',
        { business_id: BUSINESS_ID, name: 'Standard', rate: 2100, is_default: true },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Standard');
      expect(body.data.rate).toBe(2100);
      expect(body.data.is_default).toBe(true);
      TAX_CAT_ID = body.data.id;
    });

    it('creates a reduced rate', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/tax-categories',
        { business_id: BUSINESS_ID, name: 'Reduced', rate: 1000 },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.rate).toBe(1000);
      expect(body.data.is_default).toBe(false);
    });

    it('creates a zero-rated category', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/tax-categories',
        { business_id: BUSINESS_ID, name: 'Zero-rated', rate: 0 },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.rate).toBe(0);
    });

    it('rejects duplicate name', async () => {
      const { statusCode } = await request(
        'POST', '/api/v1/services/tax-categories',
        { business_id: BUSINESS_ID, name: 'Standard', rate: 2100 },
        ownerToken,
      );
      expect(statusCode).toBe(409);
    });
  });

  describe('GET /services/tax-categories', () => {
    it('lists tax categories (default first)', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/tax-categories?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(3);
      expect(body.data[0].is_default).toBe(true);
    });
  });

  describe('PUT /services/tax-categories/:id', () => {
    it('updates rate', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/tax-categories/${TAX_CAT_ID}?business_id=${BUSINESS_ID}`,
        { rate: 2300 },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.rate).toBe(2300);
    });

    it('changes default', async () => {
      // Get the reduced category id
      const { body: listBody } = await request(
        'GET', `/api/v1/services/tax-categories?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      const reducedId = listBody.data.find((c: any) => c.name === 'Reduced').id;

      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/tax-categories/${reducedId}?business_id=${BUSINESS_ID}`,
        { is_default: true },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.is_default).toBe(true);

      // Verify old default is no longer default
      const { body: afterList } = await request(
        'GET', `/api/v1/services/tax-categories?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      const oldDefault = afterList.data.find((c: any) => c.id === TAX_CAT_ID);
      expect(oldDefault.is_default).toBe(false);
    });

    it('returns 404 for non-existent category', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/services/tax-categories/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        { rate: 500 },
        ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });
});
