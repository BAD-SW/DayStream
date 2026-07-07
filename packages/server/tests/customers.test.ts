import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let businessOwnerToken: string;
let createdCustomerId: string;

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

describe('Customer CRUD API', () => {
  beforeAll(async () => {
    // Create a test business for customers
    const { rows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Test CRM Business', 'test-crm-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Test CRM Business'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = rows[0].id;

    businessOwnerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010',
      TENANT_ID,
      'Business Owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  describe('POST /api/v1/customers', () => {
    it('creates a customer', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Smith',
        phone: '+34600123456',
      }, businessOwnerToken);

      expect(statusCode).toBe(201);
      expect(body.data.email).toBe('jane@example.com');
      expect(body.data.reference_number).toMatch(/^CUST-\d{4}$/);
      expect(body.data.lifecycle_stage).toBe('lead');
      createdCustomerId = body.data.id;
    });

    it('rejects duplicate email within same business', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Duplicate',
      }, businessOwnerToken);

      expect(statusCode).toBe(409);
      expect(body.code).toBe('DUPLICATE_EMAIL');
    });

    it('rejects invalid email', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'not-an-email',
        first_name: 'Bad',
        last_name: 'Email',
      }, businessOwnerToken);

      expect(statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('requires authentication', async () => {
      const { statusCode } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'noauth@example.com',
        first_name: 'No',
        last_name: 'Auth',
      });

      expect(statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/customers', () => {
    it('lists customers for a business', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers?business_id=${BUSINESS_ID}`,
        undefined, businessOwnerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.meta.total).toBeGreaterThan(0);
    });

    it('supports search', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers?business_id=${BUSINESS_ID}&search=jane`,
        undefined, businessOwnerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.some((c: any) => c.email === 'jane@example.com')).toBe(true);
    });

    it('requires business_id', async () => {
      const { statusCode } = await request('GET', '/api/v1/customers', undefined, businessOwnerToken);
      expect(statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/customers/:id', () => {
    it('returns customer detail', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/customers/${createdCustomerId}?business_id=${BUSINESS_ID}`,
        undefined, businessOwnerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(createdCustomerId);
      expect(body.data.email).toBe('jane@example.com');
    });

    it('returns 404 for non-existent customer', async () => {
      const { statusCode } = await request(
        'GET', `/api/v1/customers/00000000-0000-0000-0000-999999999999?business_id=${BUSINESS_ID}`,
        undefined, businessOwnerToken,
      );

      expect(statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/customers/:id', () => {
    it('updates customer fields', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/customers/${createdCustomerId}?business_id=${BUSINESS_ID}`,
        { phone: '+34600999888' },
        businessOwnerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.phone).toBe('+34600999888');
    });
  });

  describe('PUT /api/v1/customers/:id/archive', () => {
    it('archives a customer', async () => {
      // Create a customer to archive
      const { body: createBody } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'archive-me@example.com',
        first_name: 'Archive',
        last_name: 'Me',
      }, businessOwnerToken);
      const archiveId = createBody.data.id;

      const { statusCode, body } = await request(
        'PUT', `/api/v1/customers/${archiveId}/archive?business_id=${BUSINESS_ID}`,
        undefined, businessOwnerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('archived');
    });
  });

  describe('POST /api/v1/customers/:id/anonymize', () => {
    it('anonymizes a customer (GDPR)', async () => {
      // Create a customer to anonymize
      const { body: createBody } = await request('POST', '/api/v1/customers', {
        business_id: BUSINESS_ID,
        email: 'anonymize-me@example.com',
        first_name: 'Anonymize',
        last_name: 'Me',
        phone: '+34111222333',
      }, businessOwnerToken);
      const anonymizeId = createBody.data.id;

      const { statusCode, body } = await request(
        'POST', `/api/v1/customers/${anonymizeId}/anonymize?business_id=${BUSINESS_ID}`,
        undefined, businessOwnerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('anonymized');

      // Verify PII is gone
      const { body: getBody } = await request(
        'GET', `/api/v1/customers/${anonymizeId}?business_id=${BUSINESS_ID}`,
        undefined, businessOwnerToken,
      );
      // Anonymized customers won't appear in normal queries (status filter)
      // But direct ID lookup should still work showing anonymized data
      expect(getBody.data.first_name).toBe('[deleted]');
      expect(getBody.data.phone).toBeNull();
    });
  });
});
