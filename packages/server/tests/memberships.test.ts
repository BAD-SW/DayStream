import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as membershipService from '../src/services/membership.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let PLAN_ID: string;
let CREDIT_PLAN_ID: string;
let INTRO_PLAN_ID: string;
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

describe('Membership Engine — Plans, Purchase & Lifecycle', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Membership Test Biz', 'membership-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Membership Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM memberships WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM membership_plans WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-MBR01', 'mbr-cust@example.com', 'Member', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Member' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Task 2: Plans ====================

  describe('Plan CRUD', () => {
    it('creates an unlimited monthly plan', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: 'Unlimited Monthly', plan_type: 'unlimited',
        billing_cycle: 'monthly', price: 12900,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.plan_type).toBe('unlimited');
      expect(body.data.billing_cycle).toBe('monthly');
      expect(body.data.price).toBe(12900);
      PLAN_ID = body.data.id;
    });

    it('creates a credit-based plan', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: '20 Credits Monthly', plan_type: 'credit',
        billing_cycle: 'monthly', price: 9900, credits_per_cycle: 20,
        credit_validity_days: 45, rollover_policy: 'limited', max_rollover_credits: 5,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.credits_per_cycle).toBe(20);
      expect(body.data.rollover_policy).toBe('limited');
      CREDIT_PLAN_ID = body.data.id;
    });

    it('creates an intro package', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: '3 Session Intro', plan_type: 'intro_package',
        billing_cycle: 'one_time', price: 9900, total_sessions: 3,
        expiration_days: 30, is_intro_only: true,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.is_intro_only).toBe(true);
      expect(body.data.total_sessions).toBe(3);
      INTRO_PLAN_ID = body.data.id;
    });

    it('rejects invalid type + billing combo', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: 'Bad Plan', plan_type: 'punch_card',
        billing_cycle: 'monthly', price: 5000,
      }, ownerToken);

      expect(statusCode).toBe(400);
      expect(body.error).toContain('one_time');
    });

    it('lists plans', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/memberships/plans?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('gets plan detail with benefits and access', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/memberships/plans/${PLAN_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data).toHaveProperty('service_access');
      expect(body.data).toHaveProperty('benefits');
      expect(body.data).toHaveProperty('upgrade_paths');
    });

    it('updates a plan', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/plans/${PLAN_ID}?business_id=${BUSINESS_ID}`,
        { price: 13900 }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.price).toBe(13900);
    });

    it('archives a plan', async () => {
      // Create a plan to archive
      const { body: created } = await request('POST', '/api/v1/memberships/plans', {
        business_id: BUSINESS_ID, name: 'To Archive', plan_type: 'unlimited',
        billing_cycle: 'monthly', price: 5000,
      }, ownerToken);

      const { statusCode } = await request(
        'PUT', `/api/v1/memberships/plans/${created.data.id}/archive?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );
      expect(statusCode).toBe(200);
    });
  });

  describe('Plan Service Access & Benefits', () => {
    it('adds service access to a plan', async () => {
      // Get a service id
      const { rows: svcRows } = await adminPool.query(
        "SELECT id FROM services WHERE business_id = $1 LIMIT 1", [BUSINESS_ID],
      );
      if (svcRows.length === 0) {
        // Create minimal service infra
        const { rows: catRows } = await adminPool.query(
          `INSERT INTO service_categories (business_id, name) VALUES ($1, 'MBR Cat')
           ON CONFLICT (business_id, name, parent_id) DO UPDATE SET name = 'MBR Cat' RETURNING id`, [BUSINESS_ID],
        );
        const { rows: newSvc } = await adminPool.query(
          `INSERT INTO services (business_id, category_id, name, slug, status, created_by)
           VALUES ($1, $2, 'MBR Service', 'mbr-service', 'active', '00000000-0000-0000-0000-000000000010') RETURNING id`,
          [BUSINESS_ID, catRows[0].id],
        );
        svcRows.push(newSvc[0]);
      }

      const access = await plansService.addServiceAccess(PLAN_ID, {
        service_id: svcRows[0].id, credit_cost: 1, access_type: 'included',
      });
      expect(access.plan_id).toBe(PLAN_ID);
      expect(access.access_type).toBe('included');
    });

    it('adds a benefit to a plan', async () => {
      const benefit = await plansService.addBenefit(PLAN_ID, {
        benefit_type: 'discount', value: 10, description: '10% off all services',
      });
      expect(benefit.benefit_type).toBe('discount');
      expect(benefit.value).toBe(10);
    });

    it('lists benefits for a plan', async () => {
      const benefits = await plansService.getBenefits(PLAN_ID);
      expect(benefits.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== Task 3: Purchase & Activation ====================

  describe('Membership Purchase', () => {
    it('activates a membership with initial credits', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: CREDIT_PLAN_ID,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.status).toBe('active');
      expect(body.data.credit_balance).toBe(20);
      expect(body.data.next_billing_date).toBeDefined();
      MEMBERSHIP_ID = body.data.id;
    });

    it('rejects duplicate active membership of same plan', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: CREDIT_PLAN_ID,
      }, ownerToken);

      expect(statusCode).toBe(409);
      expect(body.error).toContain('already has an active');
    });

    it('validates intro package eligibility', async () => {
      // First purchase should work
      const { statusCode } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: INTRO_PLAN_ID,
      }, ownerToken);
      expect(statusCode).toBe(201);

      // Second purchase rejected
      const { statusCode: s2, body: b2 } = await request('POST', '/api/v1/memberships', {
        business_id: BUSINESS_ID, customer_id: CUSTOMER_ID, plan_id: INTRO_PLAN_ID,
      }, ownerToken);
      expect(s2).toBe(409);
      expect(b2.error).toContain('Intro package already purchased');
    });
  });

  // ==================== Task 4: Lifecycle ====================

  describe('Membership Lifecycle', () => {
    it('lists memberships', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/memberships?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.data[0]).toHaveProperty('plan_name');
      expect(body.data[0]).toHaveProperty('first_name');
    });

    it('gets membership detail with history', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/memberships/${MEMBERSHIP_ID}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.id).toBe(MEMBERSHIP_ID);
      expect(body.data).toHaveProperty('status_history');
      expect(body.data.status_history.length).toBeGreaterThanOrEqual(1);
    });

    it('cancels a membership', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/cancel?business_id=${BUSINESS_ID}`,
        { reason: 'Moving away' }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.cancelled).toBe(true);

      // Verify status
      const { rows } = await adminPool.query('SELECT status FROM memberships WHERE id = $1', [MEMBERSHIP_ID]);
      expect(rows[0].status).toBe('cancelled');
    });

    it('rejects cancelling an already-cancelled membership', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/cancel?business_id=${BUSINESS_ID}`,
        {}, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('Cannot cancel');
    });

    it('auto-expires memberships past end date', async () => {
      // Create a membership with a past end date
      await adminPool.query(
        `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, end_date, credit_balance, created_by)
         VALUES ($1, $2, $3, 'active', '2025-01-01', '2025-02-01', 0, '00000000-0000-0000-0000-000000000010')`,
        [BUSINESS_ID, CUSTOMER_ID, INTRO_PLAN_ID],
      );

      const expired = await membershipService.evaluateExpirations();
      expect(expired).toBeGreaterThanOrEqual(1);
    });
  });
});

// Import for direct service access test
import * as plansService from '../src/services/membership-plans.service';
