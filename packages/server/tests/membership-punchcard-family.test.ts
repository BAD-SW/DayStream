import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as punchcardService from '../src/services/membership-punchcard.service';
import * as familyService from '../src/services/membership-family.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let CUSTOMER_ID_2: string;
let CUSTOMER_ID_3: string;
let PUNCH_PLAN_ID: string;
let INTRO_PLAN_ID: string;
let FAMILY_PLAN_ID: string;
let RECURRING_PLAN_ID: string;
let PUNCH_MEMBERSHIP_ID: string;
let FAMILY_MEMBERSHIP_ID: string;
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

describe('Punch Cards, Intro Packages & Family Memberships', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'PunchFamily Test Biz', 'punchfamily-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'PunchFamily Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Customers
    const ids = ['CUST-PF01', 'CUST-PF02', 'CUST-PF03'];
    const emails = ['pf-cust1@example.com', 'pf-cust2@example.com', 'pf-cust3@example.com'];
    const customerIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { rows } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, $3, $4, 'PF', $5, '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'PF' RETURNING id`,
        [TENANT_ID, BUSINESS_ID, ids[i], emails[i], `Cust${i + 1}`],
      );
      customerIds.push(rows[0].id);
    }
    CUSTOMER_ID = customerIds[0];
    CUSTOMER_ID_2 = customerIds[1];
    CUSTOMER_ID_3 = customerIds[2];

    // Plans
    const { rows: punchRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price, total_sessions, expiration_days)
       VALUES ($1, '5 Session Pack', 'punch_card', 'one_time', 22500, 5, 90) RETURNING id`,
      [BUSINESS_ID],
    );
    PUNCH_PLAN_ID = punchRows[0].id;

    const { rows: introRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price, total_sessions, expiration_days, is_intro_only)
       VALUES ($1, 'Intro 3 Pack', 'intro_package', 'one_time', 9900, 3, 30, true) RETURNING id`,
      [BUSINESS_ID],
    );
    INTRO_PLAN_ID = introRows[0].id;

    const { rows: familyRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle, max_additional_members, shared_credits)
       VALUES ($1, 'Family Plan', 'credit', 'monthly', 19900, 20, 3, true) RETURNING id`,
      [BUSINESS_ID],
    );
    FAMILY_PLAN_ID = familyRows[0].id;

    const { rows: recurringRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle)
       VALUES ($1, 'Monthly Standard', 'credit', 'monthly', 9900, 10) RETURNING id`,
      [BUSINESS_ID],
    );
    RECURRING_PLAN_ID = recurringRows[0].id;

    // Create punch card membership
    const { rows: punchMbr } = await adminPool.query(
      `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, end_date, credit_balance, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '90 days', 5, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, PUNCH_PLAN_ID],
    );
    PUNCH_MEMBERSHIP_ID = punchMbr[0].id;

    // Create family membership
    const { rows: famMbr } = await adminPool.query(
      `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, auto_renew, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 20, true, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, FAMILY_PLAN_ID],
    );
    FAMILY_MEMBERSHIP_ID = famMbr[0].id;

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Punch Cards ====================

  describe('Punch Card', () => {
    it('deducts a session', async () => {
      const result = await punchcardService.deductPunchCardSession(PUNCH_MEMBERSHIP_ID);
      expect(result.success).toBe(true);
      expect(result.sessions_remaining).toBe(4);
    });

    it('deducts until zero and auto-expires', async () => {
      // Use remaining 4 sessions
      for (let i = 0; i < 4; i++) {
        await punchcardService.deductPunchCardSession(PUNCH_MEMBERSHIP_ID);
      }

      const { rows } = await adminPool.query('SELECT status, credit_balance FROM mem_memberships WHERE id = $1', [PUNCH_MEMBERSHIP_ID]);
      expect(rows[0].credit_balance).toBe(0);
      expect(rows[0].status).toBe('expired');
    });

    it('rejects deduction from expired card', async () => {
      const result = await punchcardService.deductPunchCardSession(PUNCH_MEMBERSHIP_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });

    it('allows multiple active punch cards', async () => {
      // Customer can buy another punch card
      const { rows } = await adminPool.query(
        `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, credit_balance, created_by)
         VALUES ($1, $2, $3, 'active', CURRENT_DATE, 5, '00000000-0000-0000-0000-000000000010') RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID, PUNCH_PLAN_ID],
      );
      expect(rows.length).toBe(1);

      const cards = await punchcardService.getActivePunchCards(CUSTOMER_ID, BUSINESS_ID);
      expect(cards.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Intro Package', () => {
    it('validates first-time eligibility', async () => {
      const result = await punchcardService.validateIntroEligibility(CUSTOMER_ID_2, BUSINESS_ID, INTRO_PLAN_ID);
      expect(result.eligible).toBe(true);
    });

    it('rejects re-purchase', async () => {
      // Create an intro membership for customer 2
      await adminPool.query(
        `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, credit_balance, created_by)
         VALUES ($1, $2, $3, 'active', CURRENT_DATE, 3, '00000000-0000-0000-0000-000000000010')`,
        [BUSINESS_ID, CUSTOMER_ID_2, INTRO_PLAN_ID],
      );

      const result = await punchcardService.validateIntroEligibility(CUSTOMER_ID_2, BUSINESS_ID, INTRO_PLAN_ID);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('already purchased');
    });
  });

  describe('Conversion to recurring', () => {
    it('converts punch card customer to recurring membership', async () => {
      const result = await punchcardService.convertToRecurring(CUSTOMER_ID_3, BUSINESS_ID, RECURRING_PLAN_ID, '00000000-0000-0000-0000-000000000010', TENANT_ID);
      expect(result.success).toBe(true);
      expect(result.membership?.status).toBe('active');
      expect(result.membership?.credit_balance).toBe(10);
    });

    it('rejects duplicate recurring conversion', async () => {
      const result = await punchcardService.convertToRecurring(CUSTOMER_ID_3, BUSINESS_ID, RECURRING_PLAN_ID, '00000000-0000-0000-0000-000000000010', TENANT_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already has');
    });
  });

  // ==================== Family Memberships ====================

  describe('Family Members', () => {
    it('adds a family member', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${FAMILY_MEMBERSHIP_ID}/members?business_id=${BUSINESS_ID}`,
        { customer_id: CUSTOMER_ID_2 }, ownerToken,
      );

      expect(statusCode).toBe(201);
      expect(body.data.primary_membership_id).toBe(FAMILY_MEMBERSHIP_ID);
      expect(body.data.status).toBe('active');
      // Shared credits = 0 for individual member (uses primary's pool)
      expect(body.data.credit_balance).toBe(0);
    });

    it('adds second family member', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${FAMILY_MEMBERSHIP_ID}/members?business_id=${BUSINESS_ID}`,
        { customer_id: CUSTOMER_ID_3 }, ownerToken,
      );
      expect(statusCode).toBe(201);
    });

    it('lists family members', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/memberships/${FAMILY_MEMBERSHIP_ID}/members`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBe(2);
      expect(body.data[0]).toHaveProperty('first_name');
      expect(body.data[0]).toHaveProperty('email');
    });

    it('deducts from shared credit pool', async () => {
      // Get member's membership id
      const { rows: memberMbr } = await adminPool.query(
        "SELECT id FROM mem_memberships WHERE primary_membership_id = $1 AND customer_id = $2 AND status = 'active'",
        [FAMILY_MEMBERSHIP_ID, CUSTOMER_ID_2],
      );

      const result = await familyService.deductSharedCredit(memberMbr[0].id, 2);
      expect(result.success).toBe(true);

      // Check primary's balance decreased
      const { rows: primary } = await adminPool.query('SELECT credit_balance FROM mem_memberships WHERE id = $1', [FAMILY_MEMBERSHIP_ID]);
      expect(primary[0].credit_balance).toBe(18); // 20 - 2
    });

    it('rejects when max members reached', async () => {
      // Plan allows 3 additional, already have 2. Add a 3rd.
      const { rows: c4 } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-PF04', 'pf-cust4@example.com', 'PF', 'Cust4', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'PF' RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );
      await request('POST', `/api/v1/memberships/${FAMILY_MEMBERSHIP_ID}/members?business_id=${BUSINESS_ID}`,
        { customer_id: c4[0].id }, ownerToken);

      // 4th should fail (max is 3)
      const { rows: c5 } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-PF05', 'pf-cust5@example.com', 'PF', 'Cust5', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'PF' RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${FAMILY_MEMBERSHIP_ID}/members?business_id=${BUSINESS_ID}`,
        { customer_id: c5[0].id }, ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('Maximum');
    });

    it('removes a family member', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/memberships/${FAMILY_MEMBERSHIP_ID}/members/${CUSTOMER_ID_3}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.removed).toBe(true);
    });
  });
});
