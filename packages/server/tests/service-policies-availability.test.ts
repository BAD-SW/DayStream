import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { calculateCancellationFee } from '../src/services/cancellation-policies.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let POLICY_ID: string;
let RULE_ID: string;
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

describe('Cancellation Policies & Availability Rules', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Policy Avail Test Biz', 'policy-avail-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Policy Avail Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_cancellation_policies WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Policy Test Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, created_by)
       VALUES ($1, $2, 'Policy Test Service', 'policy-test-service', '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ===================== Cancellation Policies =====================

  describe('POST /services/cancellation-policies', () => {
    it('creates a policy', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/cancellation-policies',
        {
          business_id: BUSINESS_ID,
          name: 'Standard Policy',
          is_default: true,
          free_cancellation_hours: 24,
          late_cancel_fee_type: 'percentage',
          late_cancel_fee_value: 50,
          noshow_fee_type: 'percentage',
          noshow_fee_value: 100,
        },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Standard Policy');
      expect(body.data.is_default).toBe(true);
      expect(body.data.free_cancellation_hours).toBe(24);
      POLICY_ID = body.data.id;
    });

    it('creates a second policy (non-default)', async () => {
      const { statusCode, body } = await request(
        'POST', '/api/v1/services/cancellation-policies',
        { business_id: BUSINESS_ID, name: 'Flexible Policy', free_cancellation_hours: 2, late_cancel_fee_value: 25 },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.is_default).toBe(false);
    });
  });

  describe('GET /services/cancellation-policies', () => {
    it('lists policies (default first)', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/cancellation-policies?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(2);
      expect(body.data[0].is_default).toBe(true);
    });
  });

  describe('PUT /services/cancellation-policies/:id', () => {
    it('updates a policy', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/services/cancellation-policies/${POLICY_ID}?business_id=${BUSINESS_ID}`,
        { free_cancellation_hours: 48, late_cancel_fee_value: 75 },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.free_cancellation_hours).toBe(48);
      expect(body.data.late_cancel_fee_value).toBe(75);
    });
  });

  describe('DELETE /services/cancellation-policies/:id', () => {
    it('deletes a policy', async () => {
      // Create one to delete
      const { body: created } = await request(
        'POST', '/api/v1/services/cancellation-policies',
        { business_id: BUSINESS_ID, name: 'To Delete' },
        ownerToken,
      );

      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/cancellation-policies/${created.data.id}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });
  });

  describe('Fee calculation', () => {
    const policy = {
      free_cancellation_hours: 24,
      late_cancel_fee_type: 'percentage',
      late_cancel_fee_value: 50,
      noshow_fee_type: 'percentage',
      noshow_fee_value: 100,
    };

    it('returns 0 for free cancellation window', () => {
      expect(calculateCancellationFee(policy, 7500, 48)).toBe(0);
    });

    it('calculates late cancellation fee (percentage)', () => {
      expect(calculateCancellationFee(policy, 7500, 12)).toBe(3750); // 50% of 7500
    });

    it('calculates no-show fee', () => {
      expect(calculateCancellationFee(policy, 7500, 0, true)).toBe(7500); // 100%
    });

    it('calculates fixed fee', () => {
      const fixedPolicy = { ...policy, late_cancel_fee_type: 'fixed', late_cancel_fee_value: 2000 };
      expect(calculateCancellationFee(fixedPolicy, 7500, 12)).toBe(2000);
    });
  });

  // ===================== Availability Rules =====================

  describe('POST /services/:id/availability — recurring', () => {
    it('creates a recurring rule', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/availability`,
        {
          rule_type: 'recurring',
          days_of_week: [1, 2, 3, 4, 5],
          start_time: '09:00',
          end_time: '17:00',
          description: 'Weekdays only',
        },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.rule_type).toBe('recurring');
      expect(body.data.days_of_week).toEqual([1, 2, 3, 4, 5]);
      RULE_ID = body.data.id;
    });

    it('rejects recurring rule without days_of_week', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/availability`,
        { rule_type: 'recurring', start_time: '09:00', end_time: '17:00' },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('days_of_week');
    });
  });

  describe('POST /services/:id/availability — seasonal', () => {
    it('creates a seasonal rule', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/availability`,
        {
          rule_type: 'seasonal',
          effective_from: '2026-06-01',
          effective_to: '2026-09-30',
          description: 'Summer season',
        },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.rule_type).toBe('seasonal');
    });

    it('rejects seasonal rule without dates', async () => {
      const { statusCode } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/availability`,
        { rule_type: 'seasonal', description: 'Bad seasonal' },
        ownerToken,
      );
      expect(statusCode).toBe(400);
    });
  });

  describe('POST /services/:id/availability — block', () => {
    it('creates a block rule', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/services/${SERVICE_ID}/availability`,
        {
          rule_type: 'block',
          blocked_dates: ['2026-12-25', '2026-12-26', '2027-01-01'],
          description: 'Holiday closures',
        },
        ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.blocked_dates.length).toBe(3);
    });
  });

  describe('GET /services/:id/availability', () => {
    it('lists all rules', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/services/${SERVICE_ID}/availability`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('DELETE /services/:id/availability/:ruleId', () => {
    it('deletes a rule', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/availability/${RULE_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });

    it('returns 404 for non-existent rule', async () => {
      const { statusCode } = await request(
        'DELETE', `/api/v1/services/${SERVICE_ID}/availability/00000000-0000-0000-0000-999999999999`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(404);
    });
  });
});
