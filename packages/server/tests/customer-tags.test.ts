import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let TAG_ID: string;
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

describe('Customer Tags API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Tags Test Biz', 'tags-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Tags Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-8001', 'tags-test@example.com', 'Tags', 'Test', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Tags'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  describe('Tag Management', () => {
    it('creates a tag', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/tags?business_id=${BUSINESS_ID}`,
        { name: 'VIP', color: '#FFD700' },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('VIP');
      expect(body.data.color).toBe('#FFD700');
      TAG_ID = body.data.id;
    });

    it('lists tags', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers/tags/list?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.some((t: any) => t.name === 'VIP')).toBe(true);
    });

    it('updates a tag', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/customers/tags/${TAG_ID}?business_id=${BUSINESS_ID}`,
        { color: '#FF0000' },
        ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.color).toBe('#FF0000');
    });
  });

  describe('Tag Assignment', () => {
    it('assigns a tag to a customer', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/${CUSTOMER_ID}/tags?business_id=${BUSINESS_ID}`,
        { tag_id: TAG_ID },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.assigned).toBe(true);
    });

    it('removes a tag from a customer', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/customers/${CUSTOMER_ID}/tags/${TAG_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.removed).toBe(true);
    });
  });

  describe('Tag Deletion', () => {
    it('deletes a tag', async () => {
      // Create a disposable tag
      const { body: createBody } = await request(
        'POST', `/api/v1/customers/tags?business_id=${BUSINESS_ID}`,
        { name: 'Disposable', color: '#CCCCCC' },
        ownerToken,
      );

      const { statusCode, body } = await request(
        'DELETE', `/api/v1/customers/tags/${createBody.data.id}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });
  });
});
