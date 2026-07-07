import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as freezeService from '../src/services/membership-freeze.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let PLAN_ID: string;
let MEMBERSHIP_ID: string;
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

describe('Membership Freeze/Pause', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Freeze Test Biz', 'freeze-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Freeze Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-FRZ01', 'freeze-cust@example.com', 'Freeze', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Freeze' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    const { rows: planRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price, max_pause_days_per_year, max_pauses_per_year)
       VALUES ($1, 'Freeze Test Plan', 'unlimited', 'monthly', 12900, 30, 2)
       RETURNING id`,
      [BUSINESS_ID],
    );
    PLAN_ID = planRows[0].id;

    const { rows: mbrRows } = await adminPool.query(
      `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '25 days', 0, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, PLAN_ID],
    );
    MEMBERSHIP_ID = mbrRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('PUT /memberships/:id/pause', () => {
    it('pauses an active membership', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/pause?business_id=${BUSINESS_ID}`,
        { pause_days: 14 }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('paused');
      expect(body.data.pause_end_date).toBeDefined();
      expect(body.data.total_paused_days).toBe(14);
      expect(body.data.pause_count).toBe(1);
    });

    it('rejects pausing an already-paused membership', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/pause?business_id=${BUSINESS_ID}`,
        { pause_days: 7 }, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('Only active');
    });
  });

  describe('PUT /memberships/:id/resume', () => {
    it('resumes a paused membership', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/resume?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('active');
      expect(body.data.paused_at).toBeNull();
    });

    it('rejects resuming a non-paused membership', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/resume?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('not paused');
    });
  });

  describe('Pause limits', () => {
    it('enforces max pauses per year', async () => {
      // Pause again (count will be 2, which is the max)
      await request('PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/pause?business_id=${BUSINESS_ID}`, { pause_days: 7 }, ownerToken);
      await request('PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/resume?business_id=${BUSINESS_ID}`, undefined, ownerToken);

      // Third pause should be rejected (max is 2)
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/pause?business_id=${BUSINESS_ID}`,
        { pause_days: 5 }, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('pauses per year exceeded');
    });

    it('admin override bypasses limits', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/pause?business_id=${BUSINESS_ID}`,
        { pause_days: 10, admin_override: true }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.status).toBe('paused');
    });
  });

  describe('Auto-resume job', () => {
    it('auto-resumes memberships past pause_end_date', async () => {
      // Set pause_end_date to yesterday
      await adminPool.query(
        "UPDATE mem_memberships SET pause_end_date = CURRENT_DATE - 1 WHERE id = $1",
        [MEMBERSHIP_ID],
      );

      const resumed = await freezeService.autoResumePaused();
      expect(resumed).toBeGreaterThanOrEqual(1);

      const { rows } = await adminPool.query('SELECT status FROM mem_memberships WHERE id = $1', [MEMBERSHIP_ID]);
      expect(rows[0].status).toBe('active');
    });
  });
});
