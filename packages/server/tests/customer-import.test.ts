import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as importService from '../src/services/customer-import.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any; headers?: any }> {
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
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(responseData), headers: res.headers }); }
          catch { resolve({ statusCode: res.statusCode!, body: responseData, headers: res.headers }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

describe('Customer Import/Export', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Import Test Biz', 'import-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Import Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  describe('CSV Parsing', () => {
    it('parses basic CSV', () => {
      const csv = 'email,first_name,last_name\njohn@example.com,John,Doe\njane@example.com,Jane,Smith';
      const result = importService.parseCSV(csv);
      expect(result.headers).toEqual(['email', 'first_name', 'last_name']);
      expect(result.rows.length).toBe(2);
      expect(result.rows[0].email).toBe('john@example.com');
    });

    it('handles quoted fields with commas', () => {
      const csv = 'email,name\njohn@example.com,"Doe, John"';
      const result = importService.parseCSV(csv);
      expect(result.rows[0].name).toBe('Doe, John');
    });
  });

  describe('Validation', () => {
    it('validates required fields', () => {
      const csv = 'email,first_name,last_name\n,John,Doe';
      const result = importService.validateImport(csv, { email: 'email', first_name: 'first_name', last_name: 'last_name' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('email');
    });

    it('validates email format', () => {
      const csv = 'email,first_name,last_name\nnot-an-email,John,Doe';
      const result = importService.validateImport(csv, { email: 'email', first_name: 'first_name', last_name: 'last_name' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'email' && e.message.includes('Invalid email'))).toBe(true);
    });

    it('passes valid rows', () => {
      const csv = 'email,first_name,last_name\njohn@example.com,John,Doe';
      const result = importService.validateImport(csv, { email: 'email', first_name: 'first_name', last_name: 'last_name' });
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Import API', () => {
    it('POST /customers/import/validate returns validation results', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/customers/import/validate',
        {
          csv_text: 'email,first_name,last_name\nimport1@example.com,Import,One\n,Missing,Email',
          mapping: { email: 'email', first_name: 'first_name', last_name: 'last_name' },
          business_id: BUSINESS_ID,
        },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.total).toBe(2);
      expect(body.data.valid).toBe(false);
      expect(body.data.errors.length).toBeGreaterThan(0);
    });

    it('POST /customers/import executes import', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/customers/import',
        {
          csv_text: 'email,first_name,last_name\nimport-exec1@example.com,Exec,One\nimport-exec2@example.com,Exec,Two',
          mapping: { email: 'email', first_name: 'first_name', last_name: 'last_name' },
          business_id: BUSINESS_ID,
        },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.total).toBe(2);
      expect(body.data.imported).toBe(2);
      expect(body.data.skipped).toBe(0);
    });

    it('skips duplicate emails during import', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/customers/import',
        {
          csv_text: 'email,first_name,last_name\nimport-exec1@example.com,Duplicate,One',
          mapping: { email: 'email', first_name: 'first_name', last_name: 'last_name' },
          business_id: BUSINESS_ID,
        },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.imported).toBe(0);
      expect(body.data.skipped).toBe(1);
    });
  });

  describe('Export API', () => {
    it('GET /customers/export returns CSV', async () => {
      const { statusCode, body, headers } = await request(
        'GET', `/api/v1/customers/export?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      // Response is a string (CSV)
      expect(typeof body).toBe('string');
      expect(body).toContain('reference_number');
      expect(body).toContain('email');
    });
  });
});
