import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as segmentsService from '../src/services/customer-segments.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SEGMENT_ID: string;
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

describe('Segmentation Engine API', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Segments Test Biz', 'segments-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Segments Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Create test customers
    for (const stage of ['lead', 'trial', 'active', 'active', 'at_risk']) {
      await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, lifecycle_stage, created_by)
         VALUES ($1, $2, $3, $4, $5, 'Test', $6, '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET lifecycle_stage = $6`,
        [TENANT_ID, BUSINESS_ID, `CUST-SEG-${stage}`, `seg-${stage}-${Date.now()}@example.com`, stage, stage],
      );
    }

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*', 'customers:*'],
    );
  });

  it('POST /segments creates a segment', async () => {
    const { statusCode, body } = await request(
      'POST', '/api/v1/segments',
      {
        name: 'Active Customers',
        business_id: BUSINESS_ID,
        rules: { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'active' }] },
      },
      ownerToken,
    );

    expect(statusCode).toBe(201);
    expect(body.data.name).toBe('Active Customers');
    SEGMENT_ID = body.data.id;
  });

  it('GET /segments lists segments', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/segments?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /segments/:id/members evaluates segment', async () => {
    const { statusCode, body } = await request(
      'GET', `/api/v1/segments/${SEGMENT_ID}/members?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2); // 2 active customers
    expect(body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('DELETE /segments/:id deletes a segment', async () => {
    const { statusCode, body } = await request(
      'DELETE', `/api/v1/segments/${SEGMENT_ID}?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );

    expect(statusCode).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it('returns 404 for non-existent segment members', async () => {
    const { statusCode } = await request(
      'GET', `/api/v1/segments/00000000-0000-0000-0000-999999999999/members?business_id=${BUSINESS_ID}`,
      undefined, ownerToken,
    );
    expect(statusCode).toBe(404);
  });

  describe('Rule Evaluation', () => {
    it('supports eq operator', async () => {
      const result = await segmentsService.evaluateRules(
        { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'lead' }] },
        BUSINESS_ID,
      );
      expect(result.members.every((m: any) => m.lifecycle_stage === 'lead')).toBe(true);
    });

    it('supports neq operator', async () => {
      const result = await segmentsService.evaluateRules(
        { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'neq', value: 'lead' }] },
        BUSINESS_ID,
      );
      expect(result.members.every((m: any) => m.lifecycle_stage !== 'lead')).toBe(true);
    });

    it('supports in operator', async () => {
      const result = await segmentsService.evaluateRules(
        { logic: 'AND', rules: [{ field: 'lifecycle_stage', operator: 'in', value: ['active', 'trial'] }] },
        BUSINESS_ID,
      );
      expect(result.members.every((m: any) => ['active', 'trial'].includes(m.lifecycle_stage))).toBe(true);
    });

    it('supports contains operator', async () => {
      const result = await segmentsService.evaluateRules(
        { logic: 'AND', rules: [{ field: 'email', operator: 'contains', value: 'seg-active' }] },
        BUSINESS_ID,
      );
      expect(result.members.every((m: any) => m.email.includes('seg-active'))).toBe(true);
    });

    it('supports OR logic', async () => {
      const result = await segmentsService.evaluateRules(
        { logic: 'OR', rules: [{ field: 'lifecycle_stage', operator: 'eq', value: 'lead' }, { field: 'lifecycle_stage', operator: 'eq', value: 'at_risk' }] },
        BUSINESS_ID,
      );
      expect(result.members.every((m: any) => m.lifecycle_stage === 'lead' || m.lifecycle_stage === 'at_risk')).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });
  });
});
