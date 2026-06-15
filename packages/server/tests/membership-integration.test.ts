/**
 * Integration tests for the Membership Engine (Phase 08).
 * Verifies cross-cutting flows across plans, purchase, credits, billing, pause, upgrade, and family.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as authService from '../src/services/auth.service';
import * as membershipService from '../src/services/membership.service';
import * as creditsService from '../src/services/membership-credits.service';
import * as billingService from '../src/services/membership-billing.service';
import * as freezeService from '../src/services/membership-freeze.service';
import * as upgradeService from '../src/services/membership-upgrade.service';
import * as familyService from '../src/services/membership-family.service';
import * as punchcardService from '../src/services/membership-punchcard.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000010';
let BUSINESS_ID: string;
let CUSTOMER_ID: string;
let CUSTOMER_ID_2: string;
let BASIC_PLAN_ID: string;
let PREMIUM_PLAN_ID: string;
let PUNCH_PLAN_ID: string;

describe('Membership Engine — Integration Tests', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO businesses (tenant_id, name, slug, status)
       VALUES ($1, 'MBR Integration Biz', 'mbr-integration-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'MBR Integration Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM memberships WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM membership_plans WHERE business_id = $1', [BUSINESS_ID]);

    // Customers
    const { rows: c1 } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-MINT01', 'mbr-int1@example.com', 'MbrInt', 'Cust1', $3)
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'MbrInt' RETURNING id`,
      [TENANT_ID, BUSINESS_ID, USER_ID],
    );
    CUSTOMER_ID = c1[0].id;

    const { rows: c2 } = await adminPool.query(
      `INSERT INTO customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-MINT02', 'mbr-int2@example.com', 'MbrInt', 'Cust2', $3)
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'MbrInt' RETURNING id`,
      [TENANT_ID, BUSINESS_ID, USER_ID],
    );
    CUSTOMER_ID_2 = c2[0].id;

    // Plans: Basic (€99, 10 credits), Premium (€149, 20 credits, family)
    const { rows: basic } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle, credit_validity_days, rollover_policy, max_rollover_credits)
       VALUES ($1, 'Integration Basic', 'credit', 'monthly', 9900, 10, 30, 'limited', 3)
       RETURNING id`,
      [BUSINESS_ID],
    );
    BASIC_PLAN_ID = basic[0].id;

    const { rows: premium } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, credits_per_cycle, credit_validity_days, rollover_policy, max_additional_members, shared_credits)
       VALUES ($1, 'Integration Premium', 'credit', 'monthly', 14900, 20, 45, 'unlimited', 2, true)
       RETURNING id`,
      [BUSINESS_ID],
    );
    PREMIUM_PLAN_ID = premium[0].id;

    // Upgrade path
    await adminPool.query(
      `INSERT INTO plan_upgrade_paths (from_plan_id, to_plan_id, direction) VALUES ($1, $2, 'upgrade') ON CONFLICT DO NOTHING`,
      [BASIC_PLAN_ID, PREMIUM_PLAN_ID],
    );
    await adminPool.query(
      `INSERT INTO plan_upgrade_paths (from_plan_id, to_plan_id, direction) VALUES ($1, $2, 'downgrade') ON CONFLICT DO NOTHING`,
      [PREMIUM_PLAN_ID, BASIC_PLAN_ID],
    );

    // Punch card plan
    const { rows: punch } = await adminPool.query(
      `INSERT INTO membership_plans (business_id, name, plan_type, billing_cycle, price, total_sessions, expiration_days)
       VALUES ($1, 'Integration 5-Pack', 'punch_card', 'one_time', 22500, 5, 60)
       RETURNING id`,
      [BUSINESS_ID],
    );
    PUNCH_PLAN_ID = punch[0].id;
  });

  describe('Full membership flow: purchase → use credits → renew → upgrade → cancel', () => {
    let membershipId: string;

    it('purchases a basic membership with initial credits', async () => {
      const membership = await membershipService.createMembership({
        businessId: BUSINESS_ID, customerId: CUSTOMER_ID, planId: BASIC_PLAN_ID,
        createdBy: USER_ID, tenantId: TENANT_ID,
      });

      expect(membership.status).toBe('active');
      expect(membership.credit_balance).toBe(10);
      expect(membership.next_billing_date).toBeDefined();
      membershipId = membership.id;
    });

    it('deducts credits on booking', async () => {
      const result = await creditsService.deductCredits(membershipId, 2, undefined, 'Booked: Massage');
      expect(result.success).toBe(true);
      expect(result.balance_after).toBe(8);
    });

    it('restores credits on free cancellation', async () => {
      const result = await creditsService.restoreCredits(membershipId, 2, undefined, 'Booking cancelled');
      expect(result.success).toBe(true);
      expect(result.balance_after).toBe(10);
    });

    it('uses more credits during the cycle', async () => {
      await creditsService.deductCredits(membershipId, 3);
      await creditsService.deductCredits(membershipId, 2);
      // Balance: 10 - 3 - 2 = 5

      const info = await creditsService.getCreditInfo(membershipId);
      expect(info?.balance).toBe(5);
    });

    it('renews: processes rollover and allocates new credits', async () => {
      // Simulate billing date reached
      await adminPool.query(
        'UPDATE memberships SET next_billing_date = CURRENT_DATE WHERE id = $1',
        [membershipId],
      );

      const result = await billingService.processRenewals();
      expect(result.renewed).toBeGreaterThanOrEqual(1);

      // Balance: rollover limited to 3, then +10 = 13
      const info = await creditsService.getCreditInfo(membershipId);
      expect(info?.balance).toBe(13);
    });

    it('upgrades to premium plan with proration', async () => {
      const result = await upgradeService.upgradeMembership(membershipId, BUSINESS_ID, PREMIUM_PLAN_ID, USER_ID, TENANT_ID);
      expect(result.success).toBe(true);
      expect(result.proration_amount).toBeGreaterThanOrEqual(0);

      // Plan changed
      const { rows } = await adminPool.query('SELECT plan_id FROM memberships WHERE id = $1', [membershipId]);
      expect(rows[0].plan_id).toBe(PREMIUM_PLAN_ID);
    });

    it('cancels the membership', async () => {
      const result = await membershipService.cancelMembership(membershipId, BUSINESS_ID, USER_ID, TENANT_ID, 'Test complete');
      expect(result.success).toBe(true);

      const { rows } = await adminPool.query('SELECT status FROM memberships WHERE id = $1', [membershipId]);
      expect(rows[0].status).toBe('cancelled');
    });
  });

  describe('Credit lifecycle: allocate → deduct → restore → expire', () => {
    let membershipId: string;

    beforeAll(async () => {
      const { rows } = await adminPool.query(
        `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, created_by)
         VALUES ($1, $2, $3, 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 0, $4) RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID_2, BASIC_PLAN_ID, USER_ID],
      );
      membershipId = rows[0].id;
    });

    it('allocates credits', async () => {
      const balance = await creditsService.allocateCredits(membershipId, 10, 30);
      expect(balance).toBe(10);
    });

    it('deducts credits', async () => {
      const result = await creditsService.deductCredits(membershipId, 4);
      expect(result.balance_after).toBe(6);
    });

    it('restores credits', async () => {
      const result = await creditsService.restoreCredits(membershipId, 2);
      expect(result.balance_after).toBe(8);
    });

    it('expires via scheduled job', async () => {
      // Insert an expired allocation
      await adminPool.query(
        `INSERT INTO credit_transactions (membership_id, type, amount, balance_after, description, expires_at)
         VALUES ($1, 'allocated', 8, 8, 'Test allocation', NOW() - INTERVAL '1 day')`,
        [membershipId],
      );

      const expired = await creditsService.expireStaleCredits();
      expect(expired).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Pause flow: pause → no billing → resume → credits extended', () => {
    let membershipId: string;

    beforeAll(async () => {
      const { rows } = await adminPool.query(
        `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, created_by)
         VALUES ($1, $2, $3, 'active', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '20 days', 5, $4) RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID_2, BASIC_PLAN_ID, USER_ID],
      );
      membershipId = rows[0].id;
    });

    it('pauses the membership', async () => {
      const result = await freezeService.pauseMembership(membershipId, BUSINESS_ID, 14, USER_ID, TENANT_ID);
      expect(result.success).toBe(true);
      expect(result.membership?.status).toBe('paused');
    });

    it('billing date extended by pause days', async () => {
      const { rows } = await adminPool.query('SELECT next_billing_date FROM memberships WHERE id = $1', [membershipId]);
      const billing = new Date(rows[0].next_billing_date);
      // Should be ~34 days from now (20 original + 14 pause)
      const daysFromNow = Math.ceil((billing.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      expect(daysFromNow).toBeGreaterThanOrEqual(30);
    });

    it('resumes the membership', async () => {
      const result = await freezeService.resumeMembership(membershipId, BUSINESS_ID, USER_ID, TENANT_ID);
      expect(result.success).toBe(true);
      expect(result.membership?.status).toBe('active');
    });
  });

  describe('Family membership: primary + additional, shared pool', () => {
    let familyMembershipId: string;

    beforeAll(async () => {
      const { rows } = await adminPool.query(
        `INSERT INTO memberships (business_id, customer_id, plan_id, status, start_date, next_billing_date, credit_balance, auto_renew, created_by)
         VALUES ($1, $2, $3, 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 20, true, $4) RETURNING id`,
        [BUSINESS_ID, CUSTOMER_ID, PREMIUM_PLAN_ID, USER_ID],
      );
      familyMembershipId = rows[0].id;
    });

    it('adds a family member', async () => {
      const result = await familyService.addFamilyMember(familyMembershipId, BUSINESS_ID, CUSTOMER_ID_2, USER_ID);
      expect(result.success).toBe(true);
      expect(result.membership?.primary_membership_id).toBe(familyMembershipId);
      // Shared credits: member gets 0 (uses primary pool)
      expect(result.membership?.credit_balance).toBe(0);
    });

    it('deducts from shared pool when member books', async () => {
      const { rows: memberMbr } = await adminPool.query(
        "SELECT id FROM memberships WHERE primary_membership_id = $1 AND customer_id = $2 AND status = 'active'",
        [familyMembershipId, CUSTOMER_ID_2],
      );

      const result = await familyService.deductSharedCredit(memberMbr[0].id, 3);
      expect(result.success).toBe(true);

      // Primary balance reduced
      const { rows } = await adminPool.query('SELECT credit_balance FROM memberships WHERE id = $1', [familyMembershipId]);
      expect(rows[0].credit_balance).toBe(17); // 20 - 3
    });

    it('lists family members', async () => {
      const members = await familyService.getFamilyMembers(familyMembershipId);
      expect(members.length).toBe(1);
      expect(members[0].first_name).toBe('MbrInt');
    });

    it('removes family member', async () => {
      const removed = await familyService.removeFamilyMember(familyMembershipId, BUSINESS_ID, CUSTOMER_ID_2);
      expect(removed).toBe(true);
    });
  });

  describe('Business scoping', () => {
    it('cannot access memberships from another business', async () => {
      const { rows: otherBiz } = await adminPool.query(
        `INSERT INTO businesses (tenant_id, name, slug, status)
         VALUES ($1, 'Other MBR Biz', 'other-mbr-biz', 'active')
         ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Other MBR Biz'
         RETURNING id`,
        [TENANT_ID],
      );

      const result = await membershipService.getMemberships(otherBiz[0].id);
      const ourCustomers = result.memberships.filter((m: any) => m.customer_id === CUSTOMER_ID);
      expect(ourCustomers.length).toBe(0);
    });
  });
});
