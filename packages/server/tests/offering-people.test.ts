import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool } from '../src/db/pool';
import * as packageService from '../src/services/package.service';
import * as membershipService from '../src/services/membership.service';

/**
 * Who has an offering (THE-23 item 1): everyone who bought a package or was enrolled in a plan,
 * past ones included, with their status. Uses its own business so it never touches other data.
 */

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let ANA: string;
let BEN: string;
let PACKAGE_ID: string;
let PLAN_ID: string;

describe('Offering people (THE-23 item 1)', () => {
  beforeAll(async () => {
    const { rows: [b] } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status) VALUES ($1, 'Offering People Test Biz', 'offering-people-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [TENANT_ID],
    );
    BUSINESS_ID = b.id;
    await cleanup();
    const customer = async (first: string, ref: string) => (await adminPool.query(
      `INSERT INTO cus_customers (tenant_id, business_id, reference_number, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, 'Test', $5) RETURNING id`, [TENANT_ID, BUSINESS_ID, ref, first, `${first.toLowerCase()}@offering-people.test`],
    )).rows[0].id;
    ANA = await customer('Ana', 'OPT-1');
    BEN = await customer('Ben', 'OPT-2');

    PACKAGE_ID = (await adminPool.query(`INSERT INTO pkg_packages (business_id, name, price, status) VALUES ($1, 'Ten pack', 10000, 'active') RETURNING id`, [BUSINESS_ID])).rows[0].id;
    const item = async (type: string, qty: number) => (await adminPool.query(
      `INSERT INTO pkg_package_items (package_id, item_type, quantity, redemption_type) VALUES ($1, 'service', $2, $3) RETURNING id`, [PACKAGE_ID, qty, type],
    )).rows[0].id;
    const sessions = await item('sessions', 5);
    const minutes = await item('minutes', 60);
    const purchase = async (cust: string, status: string, at: string) => (await adminPool.query(
      `INSERT INTO pkg_purchases (package_id, business_id, customer_id, status, purchased_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [PACKAGE_ID, BUSINESS_ID, cust, status, at],
    )).rows[0].id;
    const anaPurchase = await purchase(ANA, 'active', '2026-10-20T10:00:00Z');
    await purchase(BEN, 'cancelled', '2026-09-01T10:00:00Z');
    await adminPool.query(
      `INSERT INTO pkg_redemptions (purchase_id, package_item_id, quantity_redeemed, minutes_redeemed) VALUES ($1, $2, 1, NULL), ($1, $2, 1, NULL), ($1, $3, 1, 30)`,
      [anaPurchase, sessions, minutes],
    );

    PLAN_ID = (await adminPool.query(`INSERT INTO mbr_plans (business_id, name, price, status) VALUES ($1, 'Monthly', 5000, 'active') RETURNING id`, [BUSINESS_ID])).rows[0].id;
    await adminPool.query(
      `INSERT INTO mbr_enrollments (plan_id, business_id, customer_id, status, start_date, current_period_start, current_period_end) VALUES ($1, $2, $3, 'active', '2026-10-01', '2026-10-01', '2026-10-31'), ($1, $2, $4, 'cancelled', '2026-06-01', '2026-06-01', '2026-06-30')`,
      [PLAN_ID, BUSINESS_ID, ANA, BEN],
    );
  });

  afterAll(cleanup);

  async function cleanup() {
    await adminPool.query('DELETE FROM pkg_redemptions WHERE purchase_id IN (SELECT id FROM pkg_purchases WHERE business_id = $1)', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM pkg_purchases WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM pkg_package_items WHERE package_id IN (SELECT id FROM pkg_packages WHERE business_id = $1)', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM pkg_packages WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM mbr_enrollments WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM mbr_plans WHERE business_id = $1', [BUSINESS_ID]);
    await adminPool.query('DELETE FROM cus_customers WHERE business_id = $1', [BUSINESS_ID]);
  }

  it('lists every buyer of a package, past ones too, newest first, with sessions and minutes used', async () => {
    const rows = await packageService.getPackagePurchases(PACKAGE_ID, BUSINESS_ID);
    expect(rows.map((r: any) => [r.customer_first_name, r.status])).toEqual([['Ana', 'active'], ['Ben', 'cancelled']]);
    expect(rows[0]).toMatchObject({ customer_id: ANA, sessions_total: 5, sessions_used: 2, minutes_total: 60, minutes_used: 30 });
    expect(rows[1]).toMatchObject({ customer_id: BEN, sessions_total: 5, sessions_used: 0, minutes_total: 60, minutes_used: 0 });
  });

  it('shows nothing from another business', async () => {
    expect(await packageService.getPackagePurchases(PACKAGE_ID, '00000000-0000-0000-0000-000000000002')).toEqual([]);
  });

  it('lists everyone enrolled in a plan, cancelled ones too, with their profile id', async () => {
    const rows = await membershipService.getEnrollments(BUSINESS_ID, { planId: PLAN_ID });
    expect(rows.map((r: any) => [r.customer_id, r.status]).sort()).toEqual([[ANA, 'active'], [BEN, 'cancelled']].sort());
  });
});
