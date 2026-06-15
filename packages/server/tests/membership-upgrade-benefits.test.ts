import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as benefitsService from '../src/services/membership-benefits.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let BASIC_PLAN_ID: string;
let PREMIUM_PLAN_ID: string;
let MEMBERSHIP_ID: string;
let SERVICE_ID: string;
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

describe('Membership Upgrade/Downgrade & Benefits', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Upgrade Test Biz', 'upgrade-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Upgrade Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-UPG01', 'upgrade-cust@example.com', 'Upgrade', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Upgrade' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Create two plans: Basic (€99) and Premium (€149)
    const { rows: basicRows } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle)
       VALUES ($1, 'Basic Plan', 'credit', 'monthly', 9900, 10) RETURNING id`,
      [BUSINESS_ID],
    );
    BASIC_PLAN_ID = basicRows[0].id;

    const { rows: premiumRows } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle)
       VALUES ($1, 'Premium Plan', 'credit', 'monthly', 14900, 20) RETURNING id`,
      [BUSINESS_ID],
    );
    PREMIUM_PLAN_ID = premiumRows[0].id;

    // Define upgrade path: Basic → Premium (upgrade), Premium → Basic (downgrade)
    await adminPool.query(
      `INSERT INTO plan_upgrade_paths (from_plan_id, to_plan_id, direction) VALUES ($1, $2, 'upgrade') ON CONFLICT DO NOTHING`,
      [BASIC_PLAN_ID, PREMIUM_PLAN_ID],
    );
    await adminPool.query(
      `INSERT INTO plan_upgrade_paths (from_plan_id, to_plan_id, direction) VALUES ($1, $2, 'downgrade') ON CONFLICT DO NOTHING`,
      [PREMIUM_PLAN_ID, BASIC_PLAN_ID],
    );

    // Create a service + add to plan access
    await adminPool.query('DELETE FROM services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM service_categories WHERE business_id = $1', [BUSINESS_ID]);

    const { rows: catRows } = await adminPool.query(
      `INSERT INTO service_categories (business_id, name) VALUES ($1, 'Upgrade Cat') RETURNING id`,
      [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO services (business_id, category_id, name, slug, status, created_by)
       VALUES ($1, $2, 'Upgrade Service', 'upgrade-service', 'active', '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, catRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    // Add service access to basic plan (included, cost 2 credits)
    await adminPool.query(
      `INSERT INTO plan_service_access (plan_id, service_id, credit_cost, access_type) VALUES ($1, $2, 2, 'included')`,
      [BASIC_PLAN_ID, SERVICE_ID],
    );

    // Add a discount benefit to premium plan
    await adminPool.query(
      `INSERT INTO plan_benefits (plan_id, benefit_type, value, description) VALUES ($1, 'discount', 15, '15% off all services')`,
      [PREMIUM_PLAN_ID],
    );

    // Create membership on Basic plan
    const { rows: mbrRows } = await adminPool.query(
      `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, auto_renew, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '15 days', 8, true, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, BASIC_PLAN_ID],
    );
    MEMBERSHIP_ID = mbrRows[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Upgrade/Downgrade ====================

  describe('PUT /memberships/:id/upgrade', () => {
    it('upgrades to premium plan with proration', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/upgrade?business_id=${BUSINESS_ID}`,
        { plan_id: PREMIUM_PLAN_ID }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.membership.plan_id).toBe(PREMIUM_PLAN_ID);
      expect(body.data.proration_amount).toBeGreaterThan(0);
    });

    it('rejects upgrade without valid path', async () => {
      // Try to "upgrade" to a plan with no path
      const { rows: randomPlan } = await adminPool.query(
        `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price) VALUES ($1, 'Random', 'unlimited', 'monthly', 20000) RETURNING id`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/upgrade?business_id=${BUSINESS_ID}`,
        { plan_id: randomPlan[0].id }, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('No upgrade path');
    });
  });

  describe('PUT /memberships/:id/downgrade', () => {
    it('downgrades to basic plan (no proration)', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/downgrade?business_id=${BUSINESS_ID}`,
        { plan_id: BASIC_PLAN_ID }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.membership.plan_id).toBe(BASIC_PLAN_ID);
      expect(body.data.proration_amount).toBe(0);
    });

    it('rejects downgrade without valid path', async () => {
      // Basic → Basic (no path)
      const { statusCode, body } = await request(
        'PUT', `/api/v1/memberships/${MEMBERSHIP_ID}/downgrade?business_id=${BUSINESS_ID}`,
        { plan_id: BASIC_PLAN_ID }, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('No downgrade path');
    });
  });

  // ==================== Benefits ====================

  describe('Benefits evaluation', () => {
    it('evaluates access and credit cost for a service', async () => {
      const result = await benefitsService.evaluateBenefitsForBooking(CUSTOMER_ID, BUSINESS_ID, SERVICE_ID);

      expect(result.has_access).toBe(true);
      expect(result.credit_cost).toBe(2);
      expect(result.discount_percentage).toBe(100); // 'included' = 100% discount
    });

    it('returns no access for customer without membership', async () => {
      // Create a customer with no membership
      const { rows: noMbrCust } = await adminPool.query(
        `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-UPG02', 'no-mbr@example.com', 'No', 'Membership', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'No' RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );

      const result = await benefitsService.evaluateBenefitsForBooking(noMbrCust[0].id, BUSINESS_ID, SERVICE_ID);
      expect(result.has_access).toBe(false);
      expect(result.discount_percentage).toBe(0);
    });

    it('detects insufficient credits', async () => {
      // Set credits to 1 (service costs 2)
      await adminPool.query('UPDATE memberships SET credit_balance = 1 WHERE id = $1', [MEMBERSHIP_ID]);

      const result = await benefitsService.evaluateBenefitsForBooking(CUSTOMER_ID, BUSINESS_ID, SERVICE_ID);
      expect(result.insufficient_credits).toBe(true);

      // Reset
      await adminPool.query('UPDATE memberships SET credit_balance = 10 WHERE id = $1', [MEMBERSHIP_ID]);
    });

    it('checks service exclusivity', async () => {
      // Add exclusive access to premium plan for a new service
      const { rows: excSvc } = await adminPool.query(
        `INSERT INTO services (business_id, category_id, name, slug, status, created_by)
         VALUES ($1, (SELECT id FROM service_categories WHERE business_id = $1 LIMIT 1), 'Exclusive Service', 'exclusive-service', 'active', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, slug) DO UPDATE SET name = 'Exclusive Service' RETURNING id`,
        [BUSINESS_ID],
      );

      await adminPool.query(
        `INSERT INTO plan_service_access (plan_id, service_id, credit_cost, access_type) VALUES ($1, $2, 1, 'exclusive')
         ON CONFLICT DO NOTHING`,
        [PREMIUM_PLAN_ID, excSvc[0].id],
      );

      const isExcl = await benefitsService.isServiceExclusive(excSvc[0].id, BUSINESS_ID);
      expect(isExcl).toBe(true);
    });

    it('returns customer benefits', async () => {
      // Upgrade to premium to get benefits
      await adminPool.query('UPDATE memberships SET plan_id = $2 WHERE id = $1', [MEMBERSHIP_ID, PREMIUM_PLAN_ID]);

      const benefits = await benefitsService.getCustomerBenefits(CUSTOMER_ID, BUSINESS_ID);
      expect(benefits.length).toBeGreaterThanOrEqual(1);
      expect(benefits.some((b: any) => b.benefit_type === 'discount')).toBe(true);
    });
  });
});
