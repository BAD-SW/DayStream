import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app';
import http from 'http';
import * as authService from '../src/services/auth.service';
import * as pricingService from '../src/services/pricing.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let SERVICE_ID: string;
let VARIANT_ID: string;
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

describe('Pricing Engine — Calculation & Rules', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Pricing Test Biz', 'pricing-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Pricing Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    // Clean
    await adminPool.query('DELETE FROM pri_rules WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM pri_discount_codes WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_services WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_categories WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM svc_tax_categories WHERE business_id = $1', [BUSINESS_ID]);

    // Tax category
    const { rows: taxRows } = await adminPool.query(
      `INSERT INTO svc_tax_categories (business_id, name, rate, is_default) VALUES ($1, 'Standard', 2100, true) RETURNING id`,
      [BUSINESS_ID],
    );

    // Service + variant
    const { rows: catRows } = await adminPool.query(
      `INSERT INTO svc_categories (business_id, name) VALUES ($1, 'Pricing Cat') RETURNING id`, [BUSINESS_ID],
    );
    const { rows: svcRows } = await adminPool.query(
      `INSERT INTO svc_services (business_id, category_id, name, slug, status, tax_category_id, created_by)
       VALUES ($1, $2, 'Pricing Service', 'pricing-service', 'active', $3, '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, catRows[0].id, taxRows[0].id],
    );
    SERVICE_ID = svcRows[0].id;

    const { rows: varRows } = await adminPool.query(
      `INSERT INTO svc_variants (service_id, name, duration, price, status) VALUES ($1, '60 min', 60, 10000, 'active') RETURNING id`,
      [SERVICE_ID],
    );
    VARIANT_ID = varRows[0].id;

    // Customer
    const { rows: custRows } = await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
       VALUES ($1, $2, 'CUST-PRC01', 'pricing-cust@example.com', 'Pricing', 'Cust', '00000000-0000-0000-0000-000000000010')
       ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'Pricing' RETURNING id`,
      [TENANT_ID, BUSINESS_ID],
    );
    CUSTOMER_ID = custRows[0].id;

    // Membership plan + active membership
    const { rows: planRows } = await adminPool.query(
      `INSERT INTO mem_plans (business_id, name, plan_type, billing_cycle, price) VALUES ($1, 'Gold', 'unlimited', 'monthly', 12900) RETURNING id`,
      [BUSINESS_ID],
    );
    PLAN_ID = planRows[0].id;

    const { rows: mbrRows } = await adminPool.query(
      `INSERT INTO mem_memberships (business_id, customer_id, plan_id, status, start_date, credit_balance, created_by)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE, 0, '00000000-0000-0000-0000-000000000010') RETURNING id`,
      [BUSINESS_ID, CUSTOMER_ID, PLAN_ID],
    );
    MEMBERSHIP_ID = mbrRows[0].id;

    // Discount code
    await adminPool.query(
      `INSERT INTO pri_discount_codes (business_id, code, discount_type, discount_value, max_total_uses, max_uses_per_customer)
       VALUES ($1, 'SAVE10', 'percentage', 10, 100, 1)`,
      [BUSINESS_ID],
    );

    ownerToken = authService.generateAccessToken(
      '00000000-0000-0000-0000-000000000010', TENANT_ID, 'business_owner',
      ['services:*', 'customers:*', 'bookings:*', 'staff:*', 'reports:*', 'settings:*'],
    );
  });

  // ==================== Price Calculation ====================

  describe('POST /pricing/calculate', () => {
    it('calculates base price with tax (no rules)', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/calculate', {
        business_id: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.base_price).toBe(10000);
      expect(body.data.tax_rate).toBe(2100);
      expect(body.data.tax_amount).toBe(2100); // 10000 × 21%
      expect(body.data.total).toBe(12100);
      expect(body.data.discounts.length).toBe(0);
    });

    it('applies a percentage discount rule', async () => {
      // Create a 20% rule
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, priority, stacking_mode)
         VALUES ($1, '20% Off All', 'promotion', 'percentage', 20, 50, 'stackable')`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request('POST', '/api/v1/pricing/calculate', {
        business_id: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
      }, ownerToken);

      expect(statusCode).toBe(200);
      expect(body.data.savings).toBe(2000); // 20% of 10000
      expect(body.data.subtotal).toBe(8000);
      expect(body.data.discounts.length).toBe(1);
      expect(body.data.discounts[0].rule_name).toBe('20% Off All');
    });

    it('applies discount code on top of rules', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/calculate', {
        business_id: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        discount_code: 'SAVE10',
      }, ownerToken);

      expect(statusCode).toBe(200);
      // Rule: 20% = 2000 off. Then code: 10% of (10000-2000=8000) = 800
      expect(body.data.savings).toBe(2800);
      expect(body.data.discount_code_applied).toBe('SAVE10');
    });

    it('applies membership-based rule', async () => {
      // Create membership rule
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, priority, stacking_mode, applies_to_all_customers, membership_plan_ids)
         VALUES ($1, 'Gold Member 15%', 'membership', 'percentage', 15, 30, 'stackable', false, $2)`,
        [BUSINESS_ID, [PLAN_ID]],
      );

      const { statusCode, body } = await request('POST', '/api/v1/pricing/calculate', {
        business_id: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        customer_id: CUSTOMER_ID,
      }, ownerToken);

      expect(statusCode).toBe(200);
      // Both rules apply (20% + 15% on remainder): 2000 + 1200 = 3200
      expect(body.data.discounts.some((d: any) => d.rule_name === 'Gold Member 15%')).toBe(true);
      expect(body.data.savings).toBeGreaterThan(2000);
    });

    it('exclusive rule overrides stackable rules', async () => {
      // Create exclusive 30% rule
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, priority, stacking_mode)
         VALUES ($1, 'Flash Sale 30%', 'promotion', 'percentage', 30, 10, 'exclusive')`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request('POST', '/api/v1/pricing/calculate', {
        business_id: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
      }, ownerToken);

      expect(statusCode).toBe(200);
      // Exclusive rule wins: only 30% applied
      expect(body.data.discounts.length).toBe(1);
      expect(body.data.discounts[0].rule_name).toBe('Flash Sale 30%');
      expect(body.data.savings).toBe(3000);
    });

    it('enforces max discount cap (50%)', async () => {
      // Remove exclusive rule, add a huge discount
      await adminPool.query("DELETE FROM pri_rules WHERE business_id = $1 AND name = 'Flash Sale 30%'", [BUSINESS_ID]);
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, priority, stacking_mode)
         VALUES ($1, 'Huge 60%', 'promotion', 'percentage', 60, 20, 'stackable')`,
        [BUSINESS_ID],
      );

      const { statusCode, body } = await request('POST', '/api/v1/pricing/calculate', {
        business_id: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
      }, ownerToken);

      expect(statusCode).toBe(200);
      // Max 50% cap: savings capped at 5000
      expect(body.data.savings).toBeLessThanOrEqual(5000);
      expect(body.data.subtotal).toBeGreaterThanOrEqual(5000);
    });
  });

  // ==================== Rules CRUD ====================

  describe('Rules CRUD API', () => {
    let ruleId: string;

    it('POST /pricing/rules creates a rule', async () => {
      const { statusCode, body } = await request('POST', '/api/v1/pricing/rules', {
        business_id: BUSINESS_ID, name: 'Tuesday Special', rule_type: 'day_of_week',
        discount_type: 'fixed', discount_value: 500, days_of_week: [2], priority: 80,
      }, ownerToken);

      expect(statusCode).toBe(201);
      expect(body.data.name).toBe('Tuesday Special');
      expect(body.data.rule_type).toBe('day_of_week');
      expect(body.data.days_of_week).toEqual([2]);
      ruleId = body.data.id;
    });

    it('GET /pricing/rules lists rules', async () => {
      const { statusCode, body } = await request(
        'GET', `/api/v1/pricing/rules?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('PUT /pricing/rules/:id updates a rule', async () => {
      const { statusCode, body } = await request(
        'PUT', `/api/v1/pricing/rules/${ruleId}?business_id=${BUSINESS_ID}`,
        { discount_value: 750 }, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.discount_value).toBe(750);
    });

    it('DELETE /pricing/rules/:id deletes a rule', async () => {
      const { statusCode, body } = await request(
        'DELETE', `/api/v1/pricing/rules/${ruleId}?business_id=${BUSINESS_ID}`,
        undefined, ownerToken,
      );

      expect(statusCode).toBe(200);
      expect(body.data.deleted).toBe(true);
    });
  });

  // ==================== Rule Type Evaluation ====================

  describe('Rule type evaluation', () => {
    it('first_time rule applies for new customers', async () => {
      // Create a customer with 0 bookings
      const { rows: newCust } = await adminPool.query(
        `INSERT INTO cus_customers (tenant_id, business_id, reference_number, email, first_name, last_name, created_by)
         VALUES ($1, $2, 'CUST-PRC02', 'pricing-new@example.com', 'New', 'Customer', '00000000-0000-0000-0000-000000000010')
         ON CONFLICT (business_id, email) DO UPDATE SET first_name = 'New' RETURNING id`,
        [TENANT_ID, BUSINESS_ID],
      );

      // Clean rules, add first-time rule only
      await adminPool.query("DELETE FROM pri_rules WHERE business_id = $1", [BUSINESS_ID]);
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, first_time_booking_limit)
         VALUES ($1, 'First Visit 25%', 'first_time', 'percentage', 25, 3)`,
        [BUSINESS_ID],
      );

      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        customerId: newCust[0].id,
      });

      expect(breakdown.savings).toBe(2500); // 25% of 10000
    });

    it('time_of_day rule applies at matching time', async () => {
      await adminPool.query("DELETE FROM pri_rules WHERE business_id = $1", [BUSINESS_ID]);
      await adminPool.query(
        `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, time_from, time_to)
         VALUES ($1, 'Off-Peak €10 off', 'time_of_day', 'fixed', 1000, '06:00', '10:00')`,
        [BUSINESS_ID],
      );

      // Booking at 08:00 (within range)
      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        bookingDatetime: '2026-07-01T08:00:00Z',
      });

      expect(breakdown.savings).toBe(1000);
    });

    it('time_of_day rule does NOT apply outside time range', async () => {
      const breakdown = await pricingService.calculatePrice({
        businessId: BUSINESS_ID,
        items: [{ variant_id: VARIANT_ID }],
        bookingDatetime: '2026-07-01T14:00:00Z', // 14:00, outside 06:00-10:00
      });

      expect(breakdown.savings).toBe(0);
    });
  });
});
