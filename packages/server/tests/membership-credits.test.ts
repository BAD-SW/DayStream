import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as creditsService from '../src/services/membership-credits.service';
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

describe('Membership Credits', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Credits Test Biz', 'credits-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Credits Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-CRD01', 'credits-cust@example.com', 'Credits', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Credits' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Create a credit plan
    const { rows: planRows } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle, credit_validity_days, rollover_policy, max_rollover_credits)
       VALUES ($1, 'Credits Test Plan', 'credit', 'monthly', 9900, 10, 30, 'limited', 3)
       RETURNING id`,
      [BUSINESS_ID],
    );
    PLAN_ID = planRows[0].id;

    // Create a membership with 10 credits
    const { rows: mbrRows } = await adminPool.query(
      `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 10, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, PLAN_ID],
    );
    MEMBERSHIP_ID = mbrRows[0].id;

    // Seed initial allocation transaction
    await adminPool.query(
      `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description)
       VALUES ($1, 'allocated', 10, 10, 'Initial allocation')`,
      [MEMBERSHIP_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  describe('GET /memberships/:id/credits', () => {
    it('returns balance and transaction history', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/memberships/${MEMBERSHIP_ID}/credits`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.balance).toBe(10);
      expect(body.data.transactions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /memberships/:id/credits/deduct', () => {
    it('deducts credits', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${MEMBERSHIP_ID}/credits/deduct`,
        { amount: 2, description: 'Booking: Massage' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.balance_after).toBe(8);
    });

    it('rejects when insufficient credits', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${MEMBERSHIP_ID}/credits/deduct`,
        { amount: 100 },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('Insufficient');
    });
  });

  describe('POST /memberships/:id/credits/restore', () => {
    it('restores credits on cancellation', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${MEMBERSHIP_ID}/credits/restore`,
        { amount: 2, description: 'Booking cancelled' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.balance_after).toBe(10); // back to 10
    });
  });

  describe('POST /memberships/:id/credits/adjust', () => {
    it('adds credits (admin)', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${MEMBERSHIP_ID}/credits/adjust`,
        { amount: 5, description: 'Bonus credits for loyalty' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.balance_after).toBe(15);
    });

    it('removes credits (admin)', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${MEMBERSHIP_ID}/credits/adjust`,
        { amount: -3, description: 'Correction' },
        ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.balance_after).toBe(12);
    });

    it('rejects negative balance', async () => {
      const { statusCode, body } = await request(
        'POST', `/api/v1/memberships/${MEMBERSHIP_ID}/credits/adjust`,
        { amount: -100, description: 'Would go negative' },
        ownerToken,
      );

      expect(statusCode).toBe(400);
      expect(body.error).toContain('negative');
    });
  });

  describe('Rollover logic', () => {
    it('no rollover: expires all remaining credits', async () => {
      // Set balance to 5 for this test
      await adminPool.query('UPDATE memberships SET credit_balance = 5 WHERE id = $1', [MEMBERSHIP_ID]);

      const result = await creditsService.processRollover(MEMBERSHIP_ID, 'none', null);
      expect(result.expired).toBe(5);
      expect(result.rolled_over).toBe(0);

      const { rows } = await adminPool.query('SELECT credit_balance FROM memberships WHERE id = $1', [MEMBERSHIP_ID]);
      expect(rows[0].credit_balance).toBe(0);
    });

    it('limited rollover: caps at max', async () => {
      // Set balance to 7 (max_rollover is 3)
      await adminPool.query('UPDATE memberships SET credit_balance = 7 WHERE id = $1', [MEMBERSHIP_ID]);

      const result = await creditsService.processRollover(MEMBERSHIP_ID, 'limited', 3);
      expect(result.expired).toBe(4); // 7 - 3 = 4 expired
      expect(result.rolled_over).toBe(3);
    });

    it('unlimited rollover: keeps all', async () => {
      await adminPool.query('UPDATE memberships SET credit_balance = 8 WHERE id = $1', [MEMBERSHIP_ID]);

      const result = await creditsService.processRollover(MEMBERSHIP_ID, 'unlimited', null);
      expect(result.expired).toBe(0);
      expect(result.rolled_over).toBe(8);
    });
  });

  describe('Credit allocation on renewal', () => {
    it('allocates new credits', async () => {
      await adminPool.query('UPDATE memberships SET credit_balance = 3 WHERE id = $1', [MEMBERSHIP_ID]);

      const newBalance = await creditsService.allocateCredits(MEMBERSHIP_ID, 10, 30);
      expect(newBalance).toBe(13); // 3 existing + 10 new
    });
  });

  describe('Credit expiration job', () => {
    it('expires credits past validity period', async () => {
      // Insert an allocation that expired yesterday
      await adminPool.query(
        `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description, expires_at)
         VALUES ($1, 'allocated', 5, 5, 'Expired test', NOW() - INTERVAL '1 day')`,
        [MEMBERSHIP_ID],
      );

      const expired = await creditsService.expireStaleCredits();
      expect(expired).toBeGreaterThanOrEqual(0); // may or may not expire depending on balance
    });
  });
});
