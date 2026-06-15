import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as codesService from '../src/services/discount-codes.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let CODE_ID: string;
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

describe('Discount Codes', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Codes Test Biz', 'codes-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Codes Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM discount_codes WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-CODE01', 'codes-cust@example.com', 'Code', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Code' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /pricing/codes — Create', () => {
    it('creates a discount code', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes', {
        business_id: BUSINESS_ID, code: 'WELCOME20',
        discount_type: 'percentage', discount_value: 20,
        max_total_uses: 50, max_uses_per_customer: 1,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.code).toBe('WELCOME20');
      expect(body.data.discount_value).toBe(20);
      expect(body.data.status).toBe('active');
      CODE_ID = body.data.id;
    });

    it('rejects duplicate code', async () => {
      const { statusCode } = await request('POST', '/api/v1/pricing/codes', {
        business_id: BUSINESS_ID, code: 'welcome20',
        discount_type: 'percentage', discount_value: 10,
      }, ownerToken);
      expect(statusCode).toBe(409);
    });
  });

  describe('POST /pricing/codes/validate', () => {
    it('validates a valid code', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes/validate', {
        code: 'WELCOME20', business_id: BUSINESS_ID, customer_id: CUSTOMER_ID,
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(true);
      expect(body.data.discount_type).toBe('percentage');
      expect(body.data.discount_value).toBe(20);
    });

    it('rejects non-existent code', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes/validate', {
        code: 'FAKECODE', business_id: BUSINESS_ID,
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(false);
      expect(body.data.error).toContain('not found');
    });

    it('rejects expired code', async () => {
      await adminPool.query(
        `INSERT INTO discount_codes (business_id, code, discount_type, discount_value, valid_to)
         VALUES ($1, 'EXPIRED10', 'percentage', 10, '2020-01-01')`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes/validate', {
        code: 'EXPIRED10', business_id: BUSINESS_ID,
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(false);
      expect(body.data.error).toContain('expired');
    });

    it('rejects code at max uses', async () => {
      await adminPool.query(
        `INSERT INTO discount_codes (business_id, code, discount_type, discount_value, max_total_uses, current_uses)
         VALUES ($1, 'MAXED', 'fixed', 500, 5, 5)`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes/validate', {
        code: 'MAXED', business_id: BUSINESS_ID,
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(false);
      expect(body.data.error).toContain('maximum uses');
    });

    it('rejects when customer already used code', async () => {
      // Record usage
      await codesService.redeemCode('WELCOME20', BUSINESS_ID, CUSTOMER_ID, 2000);

      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes/validate', {
        code: 'WELCOME20', business_id: BUSINESS_ID, customer_id: CUSTOMER_ID,
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.valid).toBe(false);
      expect(body.data.error).toContain('already used');
    });
  });

  describe('POST /pricing/codes/bulk', () => {
    it('generates multiple unique codes', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/codes/bulk', {
        business_id: BUSINESS_ID, count: 5, prefix: 'REF',
        discount_type: 'fixed', discount_value: 1000, is_single_use: true,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.count).toBe(5);
      expect(body.data.codes.length).toBe(5);
      expect(body.data.codes.every((c: string) => c.startsWith('REF'))).toBe(true);
      // All unique
      const unique = new Set(body.data.codes);
      expect(unique.size).toBe(5);
    });
  });

  describe('GET /pricing/codes', () => {
    it('lists codes', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/codes?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('PUT /pricing/codes/:id — Deactivate', () => {
    it('deactivates a code', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/pricing/codes/${CODE_ID}?business_id=${BUSINESS_ID}`,
        { status: 'inactive' }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('inactive');
    });
  });
});
