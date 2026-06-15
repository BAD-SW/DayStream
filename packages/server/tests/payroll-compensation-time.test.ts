import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as compensationService from '../src/services/compensation.service';
import * as timeService from '../src/services/time-tracking.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let STAFF_ID: string;
let RULE_ID: string;
let TIME_ENTRY_ID: string;
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

describe('Compensation Rules & Time Tracking', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Payroll Test Biz', 'payroll-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Payroll Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    STAFF_ID = '00000000-0000-0000-0000-000000000055';
    await adminPool.query(
      `INSERT INTO users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'payroll-staff@example.com', 'Payroll', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'Payroll'`,
      [STAFF_ID, TENANT_ID],
    );

    await adminPool.query('DELETE FROM compensation_rules WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM time_entries WHERE business_id = $1', [BUSINESS_ID]);

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Compensation Rules ====================

  describe('POST /payroll/compensation-rules', () => {
    it('creates an hourly rule', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/compensation-rules', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, rule_type: 'hourly',
        rate: 2500, effective_from: '2026-01-01', overtime_after_hours: 38,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.rule_type).toBe('hourly');
      expect(body.data.rate).toBe(2500);
      expect(body.data.overtime_after_hours).toBe(38);
      RULE_ID = body.data.id;
    });

    it('creates a commission rule', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/compensation-rules', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, rule_type: 'commission',
        rate: 1000, threshold_amount: 500000, effective_from: '2026-01-01',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.rule_type).toBe('commission');
      expect(body.data.threshold_amount).toBe(500000);
    });

    it('creates a salary rule', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/compensation-rules', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, rule_type: 'salary',
        rate: 350000, effective_from: '2026-01-01',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.rate).toBe(350000); // €3,500/month
    });
  });

  describe('GET /payroll/compensation-rules', () => {
    it('lists all rules', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/compensation-rules?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
      expect(body.data[0]).toHaveProperty('first_name');
    });

    it('filters by user_id', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/compensation-rules?business_id=${BUSINESS_ID}&user_id=${STAFF_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.every((r: any) => r.user_id === STAFF_ID)).toBe(true);
    });
  });

  describe('PUT /payroll/compensation-rules/:id', () => {
    it('updates a rule', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/payroll/compensation-rules/${RULE_ID}?business_id=${BUSINESS_ID}`,
        { rate: 2800 }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.rate).toBe(2800);
    });
  });

  describe('Effective rules lookup', () => {
    it('returns rules effective at a given date', async () => {
      const rules = await compensationService.getEffectiveRules(STAFF_ID, BUSINESS_ID, '2026-06-15');
      expect(rules.length).toBeGreaterThanOrEqual(3);
    });

    it('excludes expired rules', async () => {
      // Create an expired rule
      await adminPool.query(
        `INSERT INTO compensation_rules (business_id, user_id, rule_type, rate, effective_from, effective_to)
         VALUES ($1, $2, 'per_session', 5000, '2025-01-01', '2025-06-30')`,
        [BUSINESS_ID, STAFF_ID],
      );

      const rules = await compensationService.getEffectiveRules(STAFF_ID, BUSINESS_ID, '2026-06-15');
      expect(rules.every((r: any) => r.rule_type !== 'per_session' || r.effective_to === null || r.effective_to >= '2026-06-15')).toBe(true);
    });
  });

  // ==================== Time Tracking ====================

  describe('POST /payroll/time-entries', () => {
    it('creates a manual time entry', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/time-entries', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, entry_type: 'manual',
        start_time: '2026-06-10T09:00:00Z', end_time: '2026-06-10T17:00:00Z',
        description: 'Full day shift',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(parseFloat(body.data.hours)).toBe(8);
      expect(body.data.entry_type).toBe('manual');
      TIME_ENTRY_ID = body.data.id;
    });

    it('creates a clock entry with explicit hours', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/time-entries', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, entry_type: 'clock',
        start_time: '2026-06-11T10:00:00Z', hours: 6.5,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(parseFloat(body.data.hours)).toBe(6.5);
    });
  });

  describe('GET /payroll/time-entries', () => {
    it('lists time entries', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/time-entries?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data[0]).toHaveProperty('first_name');
    });

    it('filters by user', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/time-entries?business_id=${BUSINESS_ID}&user_id=${STAFF_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.every((e: any) => e.user_id === STAFF_ID)).toBe(true);
    });
  });

  describe('PUT /payroll/time-entries/:id/approve', () => {
    it('approves a time entry', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/payroll/time-entries/${TIME_ENTRY_ID}/approve?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.approved).toBe(true);
    });
  });

  describe('User summary', () => {
    it('returns hours, sessions, and revenue for a period', async () => {
      // Approve both entries first
      await adminPool.query('UPDATE time_entries SET approved = true WHERE business_id = $1', [BUSINESS_ID]);

      const summary = await timeService.getUserSummary(STAFF_ID, BUSINESS_ID, '2026-06-01', '2026-06-30');
      expect(summary.total_hours).toBeGreaterThanOrEqual(8);
      expect(typeof summary.total_sessions).toBe('number');
      expect(typeof summary.total_revenue).toBe('number');
    });
  });
});
