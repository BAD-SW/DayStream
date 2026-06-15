import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as corporateService from '../src/services/corporate-pricing.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let ACCOUNT_ID: string;
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

describe('Corporate Pricing', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Corporate Test Biz', 'corporate-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Corporate Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM corporate_accounts WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-CORP01', 'corp-cust@example.com', 'Corp', 'Employee', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Corp' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('POST /pricing/corporate', () => {
    it('creates a corporate account', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/corporate', {
        business_id: BUSINESS_ID, name: 'Acme Corp',
        contact_email: 'hr@acme.com', billing_email: 'billing@acme.com',
        discount_percentage: 15,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Acme Corp');
      expect(body.data.discount_percentage).toBe(15);
      ACCOUNT_ID = body.data.id;
    });
  });

  describe('GET /pricing/corporate', () => {
    it('lists corporate accounts with member count', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/corporate?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0]).toHaveProperty('member_count');
    });
  });

  describe('POST /pricing/corporate/:id/members', () => {
    it('adds a member', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/pricing/corporate/${ACCOUNT_ID}/members`,
        { customer_id: CUSTOMER_ID }, ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.added).toBe(true);
    });

    it('rejects duplicate member', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/pricing/corporate/${ACCOUNT_ID}/members`,
        { customer_id: CUSTOMER_ID }, ownerToken,
      );

      expect(statusCode).toBe(409);
      expect(body.error).toContain('already a member');
    });
  });

  describe('GET /pricing/corporate/:id/members', () => {
    it('lists members', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/corporate/${ACCOUNT_ID}/members`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].first_name).toBe('Corp');
    });
  });

  describe('Customer corporate lookup', () => {
    it('finds corporate account for a customer', async () => {
      const account = await corporateService.getCustomerCorporateAccount(CUSTOMER_ID, BUSINESS_ID);
      expect(account).not.toBeNull();
      expect(account.name).toBe('Acme Corp');
      expect(account.discount_percentage).toBe(15);
    });

    it('returns null for customer not in any account', async () => {
      const { rows: otherCust } = await adminPool.query(
        `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-CORP02', 'nocorp@example.com', 'No', 'Corp', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'No' RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );

      const account = await corporateService.getCustomerCorporateAccount(otherCust[0].id, BUSINESS_ID);
      expect(account).toBeNull();
    });
  });

  describe('DELETE /pricing/corporate/:id/members/:customerId', () => {
    it('removes a member', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/pricing/corporate/${ACCOUNT_ID}/members/${CUSTOMER_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.removed).toBe(true);
    });

    it('returns 404 for non-existent member', async () => {
      const { statusCode } = await request(
        'DELETE', `/api/v1/pricing/corporate/${ACCOUNT_ID}/members/00000000-0000-0000-0000-999999999999`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });
});
