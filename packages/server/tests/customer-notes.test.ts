import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let ownerToken: string;
let staffToken: string;

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

describe('Customer Notes API', () => {
  beforeAll(async () => {
    // Ensure business exists
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Notes Test Biz', 'notes-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Notes Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Create a customer
    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-9001', 'notes-test@example.com', 'Notes', 'Test', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Notes'
       RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Create note category
    await adminPool.query(
      `INSERT INTO cus_note_categories (business_id, name, is_sensitive, customer_visible)
       VALUES ($1, 'General', false, true)
       ON CONFLICT (business_id, name) DO NOTHING`,
      [BUSINESS_ID],
    );
    await adminPool.query(
      `INSERT INTO cus_note_categories (business_id, name, is_sensitive, customer_visible)
       VALUES ($1, 'Medical', true, false)
       ON CONFLICT (business_id, name) DO NOTHING`,
      [BUSINESS_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );

    staffToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000012', TENANT_ID, 'business_staff',
      ['bookings:read', 'bookings:update', 'customers:read'],
    );
  });

  describe('Note Categories', () => {
    it('lists categories for a business', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers/note-categories/list?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data.some((c: any) => c.name === 'General')).toBe(true);
      expect(body.data.some((c: any) => c.name === 'Medical')).toBe(true);
    });

    it('creates a new category', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/note-categories?business_id=${BUSINESS_ID}`,
        { name: 'Preferences', is_sensitive: false, customer_visible: true },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Preferences');
    });
  });

  describe('Notes CRUD', () => {
    it('creates a note', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/${CUSTOMER_ID}/notes?business_id=${BUSINESS_ID}`,
        { category: 'General', content: 'Customer prefers morning appointments.' },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.category).toBe('General');
      expect(body.data.content).toBe('Customer prefers morning appointments.');
    });

    it('creates a sensitive note', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/${CUSTOMER_ID}/notes?business_id=${BUSINESS_ID}`,
        { category: 'Medical', content: 'Allergic to latex.', is_sensitive: true },
        ownerToken,
      );
      expect(statusCode).toBe(201);
      expect(body.data.is_sensitive).toBe(true);
    });

    it('owner can read all notes including sensitive', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers/${CUSTOMER_ID}/notes?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data.some((n: any) => n.is_sensitive === true)).toBe(true);
    });

    it('staff cannot read sensitive notes', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers/${CUSTOMER_ID}/notes?business_id=${BUSINESS_ID}`,
        undefined, staffToken,
      );
      expect(statusCode).toBe(200);
      // Staff should not see sensitive notes
      expect(body.data.every((n: any) => n.is_sensitive === false)).toBe(true);
    });

    it('rejects note with invalid category', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/${CUSTOMER_ID}/notes?business_id=${BUSINESS_ID}`,
        { category: 'NonExistent', content: 'test' },
        ownerToken,
      );
      expect(statusCode).toBe(400);
      expect(body.code).toBe('INVALID_CATEGORY');
    });
  });
});
