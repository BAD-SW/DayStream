/**
 * Integration tests for the Pricing Engine (Phase 09).
 * Verifies cross-cutting flows across rules, codes, memberships, bundles, and tax.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as pricingService from '../src/services/pricing.service';
import * as codesService from '../src/services/discount-codes.service';
import * as bundlesService from '../src/services/pricing-bundles.service';
import { calculateTax } from '../src/services/tax.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
let VARIANT_ID_2: string;
let CUSTOMER_ID: string;
let NEW_CUSTOMER_ID: string;
let PLAN_ID: string;

describe('Pricing Engine — Integration Tests', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'PRC Integration Biz', 'prc-integration-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'PRC Integration Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM pri_rules WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM pri_discount_codes WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM pri_bundles WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM mem_memberships WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_tax_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Tax
    const { rows: taxRows } = await adminPool.query(
      `INSERT INTO svc_tax_categories (business_id, name, rate, is_default) VALUES ($1, 'Standard', 2100, true) RETURNING id`,
      [BUSINESS_ID],
    );

    // Services
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'PRC Int Cat') RETURNING id`, [BUSINESS_ID],
    );
    const { rows: svc1 } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, tax_category_id, created_by)
       VALUES ($1, $2, 'Massage', 'massage-int', 'active', $3, '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, catRows[0].id, taxRows[0].id],
    );
    SERVICE_ID = svc1[0].id;

    const { rows: v1 } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 8000, 'active') RETURNING id`, [SERVICE_ID],
    );
    VARIANT_ID = v1[0].id;

    const { rows: svc2 } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, tax_category_id, created_by)
       VALUES ($1, $2, 'Sauna', 'sauna-int', 'active', $3, '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, catRows[0].id, taxRows[0].id],
    );
    const { rows: v2 } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '45 min', 45, 3500, 'active') RETURNING id`, [svc2[0].id],
    );
    VARIANT_ID_2 = v2[0].id;

    // Customers
    const { rows: c1 } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-PINT01', 'prc-int1@example.com', 'PrcInt', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'PrcInt' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = c1[0].id;

    // New customer (0 bookings — for first_time rule)
    const { rows: c2 } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-PINT02', 'prc-new@example.com', 'New', 'Visitor', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'New' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    NEW_CUSTOMER_ID = c2[0].id;

    // Membership plan + active membership for CUSTOMER_ID
    const { rows: planRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price) VALUES ($1, 'Gold', 'unlimited', 'monthly', 12900) RETURNING id`,
      [BUSINESS_ID],
    );
    PLAN_ID = planRows[0].id;

    await adminPool.query(
      `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, credit_balance, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE, 0, '00000000-0000-0000-0000-000000000010')`,
      [BUSINESS_ID, CUSTOMER_ID, PLAN_ID],
    );

    // Discount code
    await adminPool.query(
      `INSERT INTO pri_discount_codes (business_id, code, discount_type, discount_value, max_total_uses, max_uses_per_customer)
       VALUES ($1, 'INTTEST15', 'percentage', 15, 100, 1)`,
      [BUSINESS_ID],
    );
  });

  describe('Full calculation with multiple overlapping rules', () => {
    beforeAll(async () => {
      // Membership rule: 10% for Gold members
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, priority, stacking_mode, applies_to_all_customers, membership_plan_ids)
         VALUES ($1, 'Gold 10%', 'membership', 'percentage', 10, 50, 'stackable', false, $2)`,
        [BUSINESS_ID, [PLAN_ID]],
      );

      // First-time rule: 20% for new customers
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, priority, stacking_mode, first_time_booking_limit)
         VALUES ($1, 'First Visit 20%', 'first_time', 'percentage', 20, 60, 'stackable', 3)`,
        [BUSINESS_ID],
      );
    });

    it('applies membership discount for member', async () => {
      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        customerId: CUSTOMER_ID,
      });

      expect(breakdown.base_price).toBe(8000);
      expect(breakdown.discounts.some((d) => d.rule_name === 'Gold 10%')).toBe(true);
      expect(breakdown.savings).toBeGreaterThanOrEqual(800); // at least membership discount
      expect(breakdown.subtotal).toBeLessThanOrEqual(7200);
      expect(breakdown.tax_rate).toBe(2100);
      expect(breakdown.total).toBeGreaterThan(0);
    });

    it('applies first-time discount for new customer (not membership)', async () => {
      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        customerId: NEW_CUSTOMER_ID,
      });

      expect(breakdown.discounts.some((d) => d.rule_name === 'First Visit 20%')).toBe(true);
      // No membership rule (new customer has no membership)
      expect(breakdown.discounts.some((d) => d.rule_name === 'Gold 10%')).toBe(false);
      expect(breakdown.savings).toBe(1600); // 20%
    });
  });

  describe('Discount code + membership discount stacking', () => {
    it('stacks code on top of membership rule', async () => {
      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        customerId: CUSTOMER_ID,
        discountCode: 'INTTEST15',
      });

      // Membership rule applies (10%), then code (15% on remainder)
      // Exact savings depend on whether first_time also applies (customer may have bookings from other tests)
      expect(breakdown.discount_code_applied).toBe('INTTEST15');
      expect(breakdown.discounts.some((d) => d.rule_name === 'Gold 10%')).toBe(true);
      expect(breakdown.savings).toBeGreaterThan(800); // at least membership + code
      expect(breakdown.subtotal).toBeLessThan(8000);
    });
  });

  describe('Promotion with redemption limit reached', () => {
    it('stops applying when max redemptions hit', async () => {
      // Create promotion with max 2 redemptions, already at 2
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, max_redemptions, current_redemptions, priority)
         VALUES ($1, 'Limited Promo', 'promotion', 'fixed', 1000, 2, 2, 40)`,
        [BUSINESS_ID],
      );

      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        customerId: CUSTOMER_ID,
      });

      // Limited Promo should NOT be applied
      expect(breakdown.discounts.some((d) => d.rule_name === 'Limited Promo')).toBe(false);
    });
  });

  describe('Bundle pricing end-to-end', () => {
    it('calculates fixed price bundle savings', async () => {
      const bundle = await bundlesService.createBundle({
        businessId: BUSINESS_ID,
        name: 'Recovery Duo',
        bundleType: 'fixed_price',
        bundlePrice: 9500,
        items: [{ variant_id: VARIANT_ID }, { variant_id: VARIANT_ID_2 }],
      });

      const detail = await bundlesService.getBundleById(bundle.id, BUSINESS_ID);
      expect(detail!.individual_total).toBe(11500); // 8000 + 3500
      expect(detail!.bundle_price).toBe(9500);
      expect(detail!.savings).toBe(2000);
    });

    it('calculates percentage bundle savings', () => {
      const result = bundlesService.calculateBundlePrice({
        bundle_type: 'percentage_off',
        discount_percentage: 20,
        items: [{ price: 8000, quantity: 1 }, { price: 3500, quantity: 1 }],
      });

      expect(result.individual_total).toBe(11500);
      expect(result.bundle_price).toBe(9200); // 11500 × 80%
      expect(result.savings).toBe(2300);
    });
  });

  describe('Business scoping', () => {
    it('rules from another business do not apply', async () => {
      // Create a rule in a different business
      const { rows: otherBiz } = await adminPool.query(
        `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Other PRC Biz', 'other-prc-biz', 'active')
         ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Other PRC Biz' RETURNING id`,
        [TENANT_ID],
      );
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value) VALUES ($1, 'Other Biz Rule', 'promotion', 'percentage', 99)`,
        [otherBiz[0].id],
      );

      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
      });

      // 99% rule from other business should NOT apply
      expect(breakdown.discounts.some((d) => d.rule_name === 'Other Biz Rule')).toBe(false);
    });

    it('codes from another business are not valid', async () => {
      const result = await codesService.validateCode('INTTEST15', '00000000-0000-0000-0000-999999999999');
      expect(result.valid).toBe(false);
    });
  });

  describe('Tax calculation modes', () => {
    it('exclusive: adds tax on top', () => {
      const result = calculateTax(8000, 2100, 'exclusive');
      expect(result.subtotal).toBe(8000);
      expect(result.tax_amount).toBe(1680);
      expect(result.total).toBe(9680);
    });

    it('inclusive: extracts tax from total', () => {
      const result = calculateTax(9680, 2100, 'inclusive');
      expect(result.total).toBe(9680);
      expect(result.subtotal).toBe(8000);
      expect(result.tax_amount).toBe(1680);
    });
  });
});
