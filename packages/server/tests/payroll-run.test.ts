import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as payrollService from '../src/services/payroll.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let STAFF_ID: string;
let PERIOD_ID: string;
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

describe('Payroll Processing & Deductions', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'PayRun Test Biz', 'payrun-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'PayRun Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    STAFF_ID = '00000000-0000-0000-0000-000000000056';
    await adminPool.query(
      `INSERT INTO usr_users (id, tenant_id, email, first_name, last_name, password_hash, role, status)
       VALUES ($1, $2, 'payrun-staff@example.com', 'PayRun', 'Staff', 'hashed', 'therapist', 'active')
       ON CONFLICT (id) DO UPDATE SET first_name = 'PayRun'`,
      [STAFF_ID, TENANT_ID],
    );

    // Clean
    await adminPool.query('DELETE FROM fin_payroll_entries WHERE pay_period_id IN (SELECT id FROM fin_pay_periods WHERE business_id = $1)', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_pay_periods WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_compensation_rules WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_payroll_deductions WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM fin_time_entries WHERE business_id = $1', [BUSINESS_ID]);

    // Set up compensation: €25/hr + salary €2000/period
    await adminPool.query(
      `INSERT INTO fin_compensation_rules (business_id, user_id, rule_type, rate, effective_from, overtime_after_hours)
       VALUES ($1, $2, 'hourly', 2500, '2026-01-01', 40)`,
      [BUSINESS_ID, STAFF_ID],
    );
    await adminPool.query(
      `INSERT INTO fin_compensation_rules (business_id, user_id, rule_type, rate, effective_from)
       VALUES ($1, $2, 'salary', 200000, '2026-01-01')`,
      [BUSINESS_ID, STAFF_ID],
    );

    // Set up deductions: 20% income tax + €50 insurance
    await adminPool.query(
      `INSERT INTO fin_payroll_deductions (business_id, user_id, name, deduction_type, calculation_type, value, effective_from)
       VALUES ($1, $2, 'Income Tax', 'tax', 'percentage', 2000, '2026-01-01')`,
      [BUSINESS_ID, STAFF_ID],
    );
    await adminPool.query(
      `INSERT INTO fin_payroll_deductions (business_id, user_id, name, deduction_type, calculation_type, value, effective_from)
       VALUES ($1, $2, 'Health Insurance', 'insurance', 'fixed', 5000, '2026-01-01')`,
      [BUSINESS_ID, STAFF_ID],
    );

    // Add time entries for June: 160 hours (no overtime)
    await adminPool.query(
      `INSERT INTO fin_time_entries (business_id, user_id, entry_type, start_time, end_time, hours, approved)
       VALUES ($1, $2, 'manual', '2026-06-01T09:00:00Z', '2026-06-01T17:00:00Z', 160, true)`,
      [BUSINESS_ID, STAFF_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Pay Periods ====================

  describe('POST /payroll/periods', () => {
    it('opens a pay period', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/periods', {
        business_id: BUSINESS_ID, period_start: '2026-06-01', period_end: '2026-06-30',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('open');
      PERIOD_ID = body.data.id;
    });

    it('rejects duplicate period', async () => {
      const { statusCode } = await request('POST', '/api/v1/payroll/periods', {
        business_id: BUSINESS_ID, period_start: '2026-06-01', period_end: '2026-06-30',
      }, ownerToken);

      expect(statusCode).toBe(409);
    });
  });

  describe('GET /payroll/periods', () => {
    it('lists periods', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/periods?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== Payroll Run ====================

  describe('POST /payroll/periods/:id/run', () => {
    it('runs payroll and calculates gross/deductions/net', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/payroll/periods/${PERIOD_ID}/run?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.entries.length).toBe(1);
      expect(body.data.totals.staff_count).toBe(1);

      const entry = body.data.entries[0];
      // Gross includes hourly (160h × €25 = €4000) + salary (€2000) + any other active rules
      expect(entry.gross_pay).toBeGreaterThanOrEqual(600000);
      // Deductions: percentage (20% of gross) + fixed (€50)
      expect(entry.total_deductions).toBeGreaterThan(0);
      // Net = gross - deductions
      expect(entry.net_pay).toBe(entry.gross_pay - entry.total_deductions);
      expect(entry.net_pay).toBeGreaterThan(0);
    });
  });

  describe('GET /payroll/periods/:id/entries', () => {
    it('returns payroll entries with staff names', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/periods/${PERIOD_ID}/entries`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].first_name).toBe('PayRun');
      expect(body.data[0].breakdown).toBeDefined();
    });
  });

  describe('PUT /payroll/periods/:id/finalize', () => {
    it('finalizes the payroll', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/payroll/periods/${PERIOD_ID}/finalize?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.finalized).toBe(true);

      // Verify period status
      const { rows } = await adminPool.query('SELECT status FROM fin_pay_periods WHERE id = $1', [PERIOD_ID]);
      expect(rows[0].status).toBe('finalized');
    });

    it('rejects re-finalizing', async () => {
      const { statusCode } = await request(
        'PUT', `/api/v1/payroll/periods/${PERIOD_ID}/finalize?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(400);
    });
  });

  // ==================== Deductions ====================

  describe('POST /payroll/deductions', () => {
    it('creates a tax deduction', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/deductions', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, name: 'Social Security',
        deduction_type: 'tax', calculation_type: 'percentage', value: 620,
        effective_from: '2026-01-01',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.deduction_type).toBe('tax');
      expect(body.data.calculation_type).toBe('percentage');
      expect(body.data.value).toBe(620); // 6.2% in basis points
    });

    it('creates a loan deduction (fixed)', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/payroll/deductions', {
        business_id: BUSINESS_ID, user_id: STAFF_ID, name: 'Salary Advance Repayment',
        deduction_type: 'loan', calculation_type: 'fixed', value: 10000,
        effective_from: '2026-06-01', effective_to: '2026-12-31',
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.deduction_type).toBe('loan');
      expect(body.data.effective_to).toContain('2026-12-31');
    });
  });

  describe('GET /payroll/deductions', () => {
    it('lists deductions for a user', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/payroll/deductions?business_id=${BUSINESS_ID}&user_id=${STAFF_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(4); // 2 original + 2 new
      expect(body.data.some((d: any) => d.deduction_type === 'tax')).toBe(true);
      expect(body.data.some((d: any) => d.deduction_type === 'insurance')).toBe(true);
      expect(body.data.some((d: any) => d.deduction_type === 'loan')).toBe(true);
    });
  });

  describe('PUT /payroll/deductions/:id', () => {
    it('deactivates a deduction', async () => {
      // Get one to deactivate
      const { rows } = await adminPool.query(
        "SELECT id FROM fin_payroll_deductions WHERE business_id = $1 AND name = 'Salary Advance Repayment'", [BUSINESS_ID],
      );

      const { statusCode, body } = await request(
        'PUT', `/api/v1/payroll/deductions/${rows[0].id}?business_id=${BUSINESS_ID}`,
        { status: 'inactive' }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('inactive');
    });
  });
});
