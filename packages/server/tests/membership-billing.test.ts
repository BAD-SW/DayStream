import { describe, it, expect, beforeAll } from 'vitest';
import * as billingService from '../src/services/membership-billing.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let PLAN_ID: string;
let MEMBERSHIP_ID: string;

describe('Membership Billing', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Billing Test Biz', 'billing-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Billing Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    const { rows: custRows } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-BIL01', 'billing-cust@example.com', 'Billing', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Billing' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    const { rows: planRows } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle, credit_validity_days, rollover_policy, max_rollover_credits)
       VALUES ($1, 'Billing Test Plan', 'credit', 'monthly', 9900, 10, 30, 'limited', 3)
       RETURNING id`,
      [BUSINESS_ID],
    );
    PLAN_ID = planRows[0].id;

    // Create a membership due for renewal today
    const { rows: mbrRows } = await adminPool.query(
      `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, auto_renew, credit_balance, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, true, 5, '00000000-0000-0000-0000-000000000010')
       RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, PLAN_ID],
    );
    MEMBERSHIP_ID = mbrRows[0].id;
  });

  describe('Renewal processing', () => {
    it('processes due renewals (allocates credits, extends billing date)', async () => {
      const result = await billingService.processRenewals();

      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(result.renewed).toBeGreaterThanOrEqual(1);

      // Verify billing date extended
      const { rows } = await adminPool.query(
        'SELECT next_billing_date, credit_balance FROM memberships WHERE id = $1',
        [MEMBERSHIP_ID],
      );
      const nextBilling = new Date(rows[0].next_billing_date);
      expect(nextBilling.getTime()).toBeGreaterThan(Date.now());
      // Credits should have been processed (rollover + allocation)
      // Original 5, limited rollover to 3, then +10 = 13
      expect(rows[0].credit_balance).toBe(13);
    });

    it('does not re-process already-extended memberships', async () => {
      const result = await billingService.processRenewals();
      // Should process 0 since billing date was just extended
      expect(result.processed).toBe(0);
    });
  });

  describe('Dunning', () => {
    it('expires memberships past dunning window', async () => {
      // Create a membership with billing date 10 days ago (past 7-day dunning window)
      await adminPool.query(
        `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, auto_renew, credit_balance, created_by)
         VALUES ($1, $2, $3, 'active', CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '10 days', true, 0, '00000000-0000-0000-0000-000000000010')`,
        [BUSINESS_ID, CUSTOMER_ID, PLAN_ID],
      );

      const result = await billingService.processDunning();
      expect(result.expired).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Proration calculator', () => {
    it('calculates upgrade proration correctly', () => {
      // Upgrading from €99/mo to €129/mo with 15 days remaining in 30-day cycle
      const proration = billingService.calculateProration(9900, 12900, 15, 30);
      expect(proration).toBe(1500); // (12900-9900) * 15/30 = 1500
    });

    it('returns 0 for downgrade', () => {
      const proration = billingService.calculateProration(12900, 9900, 15, 30);
      expect(proration).toBe(0);
    });

    it('returns 0 for zero remaining days', () => {
      const proration = billingService.calculateProration(9900, 12900, 0, 30);
      expect(proration).toBe(0);
    });
  });

  describe('Cycle helpers', () => {
    it('getCycleDays returns correct values', () => {
      expect(billingService.getCycleDays('monthly')).toBe(30);
      expect(billingService.getCycleDays('quarterly')).toBe(90);
      expect(billingService.getCycleDays('annually')).toBe(365);
    });

    it('getRemainingDays calculates from billing date', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);
      const remaining = billingService.getRemainingDays(futureDate.toISOString().slice(0, 10), 'monthly');
      expect(remaining).toBeGreaterThanOrEqual(14);
      expect(remaining).toBeLessThanOrEqual(16);
    });
  });
});
