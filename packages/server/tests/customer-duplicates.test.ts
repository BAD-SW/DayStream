import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as duplicateService from '../src/services/customer-duplicates.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_A_ID: string;
let CUSTOMER_B_ID: string;
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

describe('Customer Duplicate Detection & Merge', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Duplicates Test Biz', 'duplicates-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Duplicates Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Create two customers to merge
    const { rows: a } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, phone, created_by)
       VALUES ($1, $2, 'CUST-DUP-A', 'dup-a@example.com', 'Alice', 'Primary', '+1111111', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Alice', phone = '+1111111'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_A_ID = a[0].id;

    const { rows: b } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, phone, created_by)
       VALUES ($1, $2, 'CUST-DUP-B', 'dup-b@example.com', 'Alice', 'Secondary', '+2222222', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Alice', phone = '+2222222'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_B_ID = b[0].id;

    // Add activities to secondary
    await adminPool.query(
      `INSERT INTO customer_activities (customer_id, business_id, activity_type, description)
       VALUES ($1, $2, 'booking', 'Secondary booking')`,
      [CUSTOMER_B_ID, BUSINESS_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  describe('Detection', () => {
    it('detects duplicates by email', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'dup-a@example.com');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].match_type).toBe('email');
      expect(matches[0].confidence).toBe(1.0);
    });

    it('detects duplicates by phone', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'no-match@example.com', '+1111111');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].match_type).toBe('phone');
    });

    it('detects duplicates by name', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'no-match@example.com', undefined, 'Alice', 'Primary');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].match_type).toBe('name');
    });

    it('returns empty for no matches', async () => {
      const matches = await duplicateService.findDuplicates(BUSINESS_ID, 'totally-unique@example.com', '+9999999', 'NoMatch', 'NoMatch');
      expect(matches.length).toBe(0);
    });
  });

  describe('Merge API', () => {
    it('POST /customers/merge merges two customers', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/customers/merge',
        {
          primary_id: CUSTOMER_A_ID,
          secondary_id: CUSTOMER_B_ID,
          keep_fields: { phone: 'secondary' },
          business_id: BUSINESS_ID,
        },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(CUSTOMER_A_ID);
      expect(body.data.phone).toBe('+2222222'); // kept from secondary
    });

    it('reassigns activities from secondary to primary', async () => {
      const { rows } = await adminPool.query(
        "SELECT * FROM customer_activities WHERE customer_id = $1 AND description = 'Secondary booking'",
        [CUSTOMER_A_ID],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('deletes secondary customer after merge', async () => {
      const { rows } = await adminPool.query(
        'SELECT * FROM customers WHERE id = $1',
        [CUSTOMER_B_ID],
      );
      expect(rows.length).toBe(0);
    });

    it('rejects merging non-existent customer', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/customers/merge',
        {
          primary_id: CUSTOMER_A_ID,
          secondary_id: '00000000-0000-0000-0000-999999999999',
          business_id: BUSINESS_ID,
        },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('not found');
    });
  });
});
