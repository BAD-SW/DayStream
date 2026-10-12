import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import { adminPool } from '../src/db/pool';

/**
 * Membership engine — plans (mbr_plans) and enrollments (mbr_enrollments).
 * Replaces the tests of the earlier credit / punch-card / family engine, whose
 * routes (credits, members, upgrade, downgrade, reports) no longer exist.
 * Uses its own business so it never touches other data.
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000021';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let PLAN_ID: string;
let SECOND_PLAN_ID: string;
let ENROLLMENT_ID: string;
let ownerToken: string;

function request(method: string, path: string, body?: any, token?: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address() as any;
      const data = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost', port: address.port, path, method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
      const req = http.request(options, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          server.close();
          try { resolve({ statusCode: res.statusCode!, body: JSON.parse(d) }); }
          catch { resolve({ statusCode: res.statusCode!, body: d }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

const biz = () => `business_id=${BUSINESS_ID}`;

describe('Membership Engine — Plans & Enrollments', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Membership Test Biz', 'membership-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Membership Test Biz' RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Start clean, within this test business only
    await adminPool.query('DELETE FROM mbr_enrollments WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM mbr_plans WHERE business_id = $1', [BUSINESS_ID]);

    const email = 'membership-test@example.com';
    const existing = await adminPool.query('SELECT id FROM cus_customers WHERE business_id = $1 AND email = $2', [BUSINESS_ID, email]);
    if (existing.rows[0]) {
      CUSTOMER_ID = existing.rows[0].id;
    } else {
      const { rows } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'MBR-TEST-1', $3, 'Member', 'Test', $4) RETURNING id`,
        [TENANT_ID, BUSINESS_ID, email, USER_ID],
      );
      CUSTOMER_ID = rows[0].id;
    }

    ownerToken = authService.generateAccessToken(USER_ID, TENANT_ID, 'business_owner', ['services:*', 'customers:*']);
  });

  describe('Plans', () => {
    it('creates a monthly plan', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: 'Gold Monthly', description: 'Unlimited access',
        billing_frequency: 'monthly', price: 9900, trial_days: 0,
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Gold Monthly');
      expect(Number(body.data.price)).toBe(9900);
      PLAN_ID = body.data.id;
    });

    it('creates a second plan to change to', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: 'Silver Monthly', billing_frequency: 'monthly', price: 5900,
      }, ownerToken);
      expect(statusCode).toBe(201);
      SECOND_PLAN_ID = body.data.id;
    });

    it('requires authentication', async () => {
      const { statusCode } = await request('GET', `/api/v1/memberships/plans?${biz()}`);
      expect(statusCode).toBe(401);
    });

    it('requires business_id when listing', async () => {
      const { statusCode } = await request('GET', '/api/v1/memberships/plans', undefined, ownerToken);
      expect(statusCode).toBe(400);
    });

    it('lists the plans of the business', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/memberships/plans?${biz()}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      const names = body.data.map((p: any) => p.name);
      expect(names).toContain('Gold Monthly');
      expect(names).toContain('Silver Monthly');
    });

    it('gets a plan with its active enrollment count', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/memberships/plans/${PLAN_ID}?${biz()}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(PLAN_ID);
      expect(body.data.active_enrollments).toBe(0);
    });

    it('returns 404 for a plan of another business', async () => {
      const { statusCode } = await request('GET', `/api/v1/memberships/plans/${PLAN_ID}?business_id=00000000-0000-0000-0000-000000000002`, undefined, ownerToken);
      expect(statusCode).toBe(404);
    });

    it('updates the price', async () => {
      const { statusCode } = await request('PUT', `/api/v1/memberships/plans/${PLAN_ID}?${biz()}`, { price: 10900 }, ownerToken);
      expect(statusCode).toBe(200);
      const { body } = await request('GET', `/api/v1/memberships/plans/${PLAN_ID}?${biz()}`, undefined, ownerToken);
      expect(Number(body.data.price)).toBe(10900);
    });

    it('archives and reactivates a plan', async () => {
      const archived = await request('PUT', `/api/v1/memberships/plans/${SECOND_PLAN_ID}/archive?${biz()}`, {}, ownerToken);
      expect(archived.statusCode).toBe(200);
      const activated = await request('PUT', `/api/v1/memberships/plans/${SECOND_PLAN_ID}/activate?${biz()}`, {}, ownerToken);
      expect(activated.statusCode).toBe(200);
      const { body } = await request('GET', `/api/v1/memberships/plans/${SECOND_PLAN_ID}?${biz()}`, undefined, ownerToken);
      expect(body.data.status).toBe('active');
    });
  });

  describe('Enrollments', () => {
    it('enrolls a customer in a plan', async () => {
      await request('PUT', `/api/v1/memberships/plans/${PLAN_ID}/activate?${biz()}`, {}, ownerToken);
      const { statusCode, body } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: PLAN_ID,
      }, ownerToken);
      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('active');
      expect(body.data.plan_id).toBe(PLAN_ID);
      ENROLLMENT_ID = body.data.id;
    });

    it('refuses a second active membership for the same customer', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: SECOND_PLAN_ID,
      }, ownerToken);
      expect(statusCode).toBe(409);
      expect(body.code).toBe('ALREADY_ENROLLED');
    });

    it('returns 404 when the plan does not exist', async () => {
      const { statusCode } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: '00000000-0000-0000-0000-00000000dead',
      }, ownerToken);
      expect(statusCode).toBe(404);
    });

    it('lists enrollments, filterable by customer', async () => {
      const { statusCode, body } = await request('GET', `/api/v1/memberships?${biz()}&customer_id=${CUSTOMER_ID}`, undefined, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.some((e: any) => e.id === ENROLLMENT_ID)).toBe(true);
    });

    it('counts the enrollment on the plan', async () => {
      const { body } = await request('GET', `/api/v1/memberships/plans/${PLAN_ID}?${biz()}`, undefined, ownerToken);
      expect(body.data.active_enrollments).toBe(1);
    });

    it('pauses and resumes', async () => {
      const paused = await request('PUT', `/api/v1/memberships/${ENROLLMENT_ID}/pause?${biz()}`, {}, ownerToken);
      expect(paused.statusCode).toBe(200);
      const whilePaused = await request('GET', `/api/v1/memberships/${ENROLLMENT_ID}?${biz()}`, undefined, ownerToken);
      expect(whilePaused.body.data.status).toBe('paused');

      const again = await request('PUT', `/api/v1/memberships/${ENROLLMENT_ID}/pause?${biz()}`, {}, ownerToken);
      expect(again.statusCode).toBe(404); // only an active enrollment can be paused

      const resumed = await request('PUT', `/api/v1/memberships/${ENROLLMENT_ID}/resume?${biz()}`, {}, ownerToken);
      expect(resumed.statusCode).toBe(200);
      const after = await request('GET', `/api/v1/memberships/${ENROLLMENT_ID}?${biz()}`, undefined, ownerToken);
      expect(after.body.data.status).toBe('active');
    });

    it('rejects a change to the plan already held', async () => {
      const { statusCode } = await request('PUT', `/api/v1/memberships/${ENROLLMENT_ID}/change-plan?${biz()}`, { plan_id: PLAN_ID }, ownerToken);
      expect(statusCode).toBe(400);
    });

    it('defers a downgrade to the next billing cycle', async () => {
      const { statusCode, body } = await request('PUT', `/api/v1/memberships/${ENROLLMENT_ID}/change-plan?${biz()}`, { plan_id: SECOND_PLAN_ID }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.type).toBe('downgrade');
      const { rows } = await adminPool.query('SELECT plan_id, pending_plan_id FROM mbr_enrollments WHERE id = $1', [ENROLLMENT_ID]);
      expect(rows[0].plan_id).toBe(PLAN_ID);              // current period unchanged
      expect(rows[0].pending_plan_id).toBe(SECOND_PLAN_ID);
    });

    it('applies an upgrade immediately with a prorated charge', async () => {
      const created = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: 'Platinum Monthly', billing_frequency: 'monthly', price: 19900,
      }, ownerToken);
      await request('PUT', `/api/v1/memberships/plans/${created.body.data.id}/activate?${biz()}`, {}, ownerToken);
      const { statusCode, body } = await request('PUT', `/api/v1/memberships/${ENROLLMENT_ID}/change-plan?${biz()}`, { plan_id: created.body.data.id }, ownerToken);
      expect(statusCode).toBe(200);
      expect(body.data.type).toBe('upgrade');
      expect(body.data.proratedCharge).toBeGreaterThanOrEqual(0);
      const { rows } = await adminPool.query('SELECT plan_id, pending_plan_id FROM mbr_enrollments WHERE id = $1', [ENROLLMENT_ID]);
      expect(rows[0].plan_id).toBe(created.body.data.id);
      expect(rows[0].pending_plan_id).toBeNull();
    });

    it('cancels the active enrollment', async () => {
      const { body: list } = await request('GET', `/api/v1/memberships?${biz()}&customer_id=${CUSTOMER_ID}&status=active`, undefined, ownerToken);
      const active = list.data[0];
      const { statusCode } = await request('PUT', `/api/v1/memberships/${active.id}/cancel?${biz()}`, {}, ownerToken);
      expect(statusCode).toBe(200);
    });

    it('returns 404 for an unknown enrollment', async () => {
      const { statusCode } = await request('GET', `/api/v1/memberships/00000000-0000-0000-0000-00000000dead?${biz()}`, undefined, ownerToken);
      expect(statusCode).toBe(404);
    });
  });
});
