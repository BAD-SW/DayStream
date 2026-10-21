import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool } from '../src/db/pool';
import {
  saveTenantPlan,
  issueTenantCredit,
  computeChargeForCycle,
  billTenantForCycle,
  type BillingCycle,
} from '../src/services/platform-billing.service';

/**
 * Phase 7.4 — unit/integration coverage for the platform billing engine
 * (spec 10, Section A). Exercises computeChargeForCycle's intricate logic
 * (intro period, flat + percentage-of-net-collections, cap in both modes,
 * FIFO credit draw-down, floor-at-zero) and billTenantForCycle's idempotency.
 *
 * DB-backed (mirrors the existing AP test pattern): seeds a throwaway tenant,
 * plan, net-collections, and credits via the real service functions / adminPool,
 * asserts, and cleans everything up. No external provider — zero-amount cycles
 * record a charge without touching an adapter, so these never call Stripe.
 */

let TENANT_ID: string;
const CYCLE: BillingCycle = { year: 2026, month: 6 };
const PLAN_START = '2026-01-01'; // so June 2026 is month 5 (past any short intro)

async function seedNetCollections(cents: number) {
  // A single business row feeding the tenant's net-collections for the cycle.
  const { rows: biz } = await adminPool.query(
    `INSERT INTO sys_businesses (tenant_id, name, slug, status)
     VALUES ($1, 'Billing Test Biz', 'billing-test-biz', 'active')
     ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Billing Test Biz' RETURNING id`,
    [TENANT_ID],
  );
  await adminPool.query(
    `INSERT INTO pay_tenant_net_collections (tenant_id, business_id, cycle_year, cycle_month, net_amount_cents, currency)
     VALUES ($1, $2, $3, $4, $5, 'USD')
     ON CONFLICT (tenant_id, business_id, cycle_year, cycle_month)
     DO UPDATE SET net_amount_cents = EXCLUDED.net_amount_cents`,
    [TENANT_ID, biz.rows?.[0]?.id ?? biz[0].id, CYCLE.year, CYCLE.month, cents],
  );
}

async function clearCredits() {
  await adminPool.query(`DELETE FROM pay_tenant_credits WHERE tenant_id = $1`, [TENANT_ID]);
}

async function clearPlan() {
  await adminPool.query(`DELETE FROM pay_tenant_billing_plans WHERE tenant_id = $1`, [TENANT_ID]);
}

async function clearCharges() {
  await adminPool.query(`DELETE FROM pay_platform_billing_charges WHERE tenant_id = $1`, [TENANT_ID]);
}

describe('Platform billing engine (Section A)', () => {
  beforeAll(async () => {
    const { rows } = await adminPool.query(
      `INSERT INTO sys_tenants (name, slug, status, currency)
       VALUES ('Billing Test Tenant', 'billing-test-tenant', 'active', 'USD')
       ON CONFLICT (slug) DO UPDATE SET name = 'Billing Test Tenant' RETURNING id`,
    );
    TENANT_ID = rows[0].id;
    await clearCharges();
    await clearCredits();
    await clearPlan();
    await adminPool.query(`DELETE FROM pay_tenant_net_collections WHERE tenant_id = $1`, [TENANT_ID]);
  });

  afterAll(async () => {
    // Clean up everything we created (charges/credits/net-collections cascade off tenant,
    // but delete explicitly so a re-run against a persistent DB starts clean).
    await clearCharges();
    await clearCredits();
    await clearPlan();
    await adminPool.query(`DELETE FROM pay_tenant_net_collections WHERE tenant_id = $1`, [TENANT_ID]);
    await adminPool.query(`DELETE FROM sys_businesses WHERE tenant_id = $1`, [TENANT_ID]);
    await adminPool.query(`DELETE FROM sys_tenants WHERE id = $1`, [TENANT_ID]);
  });

  describe('computeChargeForCycle', () => {
    it('returns null when the tenant has no plan', async () => {
      await clearPlan();
      const result = await computeChargeForCycle(TENANT_ID, CYCLE, 'USD');
      expect(result).toBeNull();
    });

    it('charges a flat-only plan with no net collections', async () => {
      await clearPlan();
      await clearCredits();
      await adminPool.query(`DELETE FROM pay_tenant_net_collections WHERE tenant_id = $1`, [TENANT_ID]);
      await saveTenantPlan(TENANT_ID, { flatAmountCents: 4900, percentageRate: 0, billingDay: 1, planStartDate: PLAN_START }, null);

      const r = await computeChargeForCycle(TENANT_ID, CYCLE, 'USD');
      expect(r).not.toBeNull();
      expect(r!.flatComponentCents).toBe(4900);
      expect(r!.percentageComponentCents).toBe(0);
      expect(r!.amountChargedCents).toBe(4900);
      expect(r!.isZero).toBe(false);
    });

    it('adds a percentage of net collections to the flat component', async () => {
      await clearPlan();
      await clearCredits();
      await saveTenantPlan(TENANT_ID, { flatAmountCents: 5000, percentageRate: 2.5, billingDay: 1, planStartDate: PLAN_START }, null);
      await seedNetCollections(100000); // $1000.00 → 2.5% = $25.00

      const r = await computeChargeForCycle(TENANT_ID, CYCLE, 'USD');
      expect(r!.netCollectionsCents).toBe(100000);
      expect(r!.percentageComponentCents).toBe(2500);
      expect(r!.amountChargedCents).toBe(5000 + 2500);
    });

    it('caps the PERCENTAGE component when cap_applies_to = percentage', async () => {
      await clearPlan();
      await clearCredits();
      await saveTenantPlan(TENANT_ID, {
        flatAmountCents: 5000, percentageRate: 10, capAmountCents: 3000, capAppliesTo: 'percentage',
        billingDay: 1, planStartDate: PLAN_START,
      }, null);
      await seedNetCollections(100000); // 10% = $100 → capped to $30

      const r = await computeChargeForCycle(TENANT_ID, CYCLE, 'USD');
      expect(r!.capAppliedCents).toBe(3000);
      expect(r!.percentageComponentCents).toBe(3000);
      // Flat is NOT part of the cap in percentage mode: 5000 + 3000.
      expect(r!.amountChargedCents).toBe(8000);
    });

    it('caps the COMBINED charge when cap_applies_to = combined', async () => {
      await clearPlan();
      await clearCredits();
      await saveTenantPlan(TENANT_ID, {
        flatAmountCents: 5000, percentageRate: 10, capAmountCents: 9000, capAppliesTo: 'combined',
        billingDay: 1, planStartDate: PLAN_START,
      }, null);
      await seedNetCollections(100000); // flat 5000 + pct 10000 = 15000 → capped to 9000

      const r = await computeChargeForCycle(TENANT_ID, CYCLE, 'USD');
      expect(r!.capAppliedCents).toBe(9000);
      expect(r!.amountChargedCents).toBe(9000);
    });

    it('applies the intro rate during the intro period only', async () => {
      await clearPlan();
      await clearCredits();
      await adminPool.query(`DELETE FROM pay_tenant_net_collections WHERE tenant_id = $1`, [TENANT_ID]);
      // Intro covers the first 3 months from a start of 2026-06-01; the June cycle (month 0) is in intro.
      await saveTenantPlan(TENANT_ID, {
        flatAmountCents: 5000, percentageRate: 0,
        introPeriodMonths: 3, introFlatAmountCents: 1000, introPercentageRate: 0,
        billingDay: 1, planStartDate: '2026-06-01',
      }, null);

      const introCycle: BillingCycle = { year: 2026, month: 6 };
      const rIntro = await computeChargeForCycle(TENANT_ID, introCycle, 'USD');
      expect(rIntro!.flatComponentCents).toBe(1000); // intro flat

      const afterCycle: BillingCycle = { year: 2026, month: 10 }; // month 4 → past 3-month intro
      const rAfter = await computeChargeForCycle(TENANT_ID, afterCycle, 'USD');
      expect(rAfter!.flatComponentCents).toBe(5000); // standard flat
    });

    it('draws credits down FIFO and floors the charge at zero', async () => {
      await clearPlan();
      await clearCredits();
      await adminPool.query(`DELETE FROM pay_tenant_net_collections WHERE tenant_id = $1`, [TENANT_ID]);
      await saveTenantPlan(TENANT_ID, { flatAmountCents: 5000, percentageRate: 0, billingDay: 1, planStartDate: PLAN_START }, null);

      // Two credits totalling $80 against a $50 charge → fully covered, floored at zero.
      await issueTenantCredit(TENANT_ID, 3000, 'test credit 1', null);
      await issueTenantCredit(TENANT_ID, 5000, 'test credit 2', null);

      const r = await computeChargeForCycle(TENANT_ID, CYCLE, 'USD');
      expect(r!.creditAppliedCents).toBe(5000); // only as much as the subtotal
      expect(r!.amountChargedCents).toBe(0);
      expect(r!.isZero).toBe(true);
    });
  });

  describe('billTenantForCycle (idempotency)', () => {
    it('is idempotent per (tenant, cycle): a repeat run does not create a second charge row', async () => {
      await clearPlan();
      await clearCredits();
      await clearCharges();
      await adminPool.query(`DELETE FROM pay_tenant_net_collections WHERE tenant_id = $1`, [TENANT_ID]);
      // Zero-amount plan so the engine records a charge WITHOUT contacting a provider.
      await saveTenantPlan(TENANT_ID, { flatAmountCents: 0, percentageRate: 0, billingDay: 1, planStartDate: PLAN_START }, null);

      await billTenantForCycle(TENANT_ID, CYCLE, 'USD');
      await billTenantForCycle(TENANT_ID, CYCLE, 'USD');

      const { rows } = await adminPool.query(
        `SELECT COUNT(*)::int AS n FROM pay_platform_billing_charges
         WHERE tenant_id = $1 AND cycle_year = $2 AND cycle_month = $3`,
        [TENANT_ID, CYCLE.year, CYCLE.month],
      );
      expect(rows[0].n).toBe(1);
    });
  });
});
