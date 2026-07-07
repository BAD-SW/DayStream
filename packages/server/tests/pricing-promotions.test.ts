import { describe, it, expect, beforeAll } from 'vitest';
import * as promotionsService from '../src/services/promotions.service';
import { adminPool } from '../src/db/pool';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
let BUSINESS_ID: string;
let PROMO_ID: string;

describe('Promotions', () => {
  beforeAll(async () => {
    const { rows: bizRows } = await adminPool.query(
      `INSERT INTO sys_businesses (tenant_id, name, slug, status)
       VALUES ($1, 'Promo Test Biz', 'promo-test-biz', 'active')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = 'Promo Test Biz'
       RETURNING id`,
      [TENANT_ID],
    );
    BUSINESS_ID = bizRows[0].id;

    await adminPool.query("DELETE FROM pri_rules WHERE business_id = $1 AND rule_type = 'promotion'", [BUSINESS_ID]);

    // Create an active promotion
    const { rows: promo } = await adminPool.query(
      `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, effective_from, effective_to, max_redemptions, current_redemptions)
       VALUES ($1, 'Summer Sale', 'promotion', 'percentage', 15, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', 100, 0)
       RETURNING id`,
      [BUSINESS_ID],
    );
    PROMO_ID = promo[0].id;

    // Create an expired promotion (still marked active — job should fix)
    await adminPool.query(
      `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, effective_from, effective_to, status)
       VALUES ($1, 'Old Sale', 'promotion', 'fixed', 500, '2025-01-01', '2025-01-31', 'active')`,
      [BUSINESS_ID],
    );

    // Create a scheduled future promotion (inactive, future start)
    await adminPool.query(
      `INSERT INTO pri_rules (business_id, name, rule_type, discount_type, discount_value, effective_from, effective_to, status)
       VALUES ($1, 'Future Sale', 'promotion', 'percentage', 25, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '7 days', 'inactive')`,
      [BUSINESS_ID],
    );
  });

  it('lists active promotions', async () => {
    const promos = await promotionsService.getActivePromotions(BUSINESS_ID);
    expect(promos.length).toBeGreaterThanOrEqual(1);
    expect(promos.some((p: any) => p.name === 'Summer Sale')).toBe(true);
    // Old Sale should NOT appear (expired date range)
    expect(promos.some((p: any) => p.name === 'Old Sale')).toBe(false);
  });

  it('records redemption count', async () => {
    await promotionsService.recordRedemption(PROMO_ID);
    await promotionsService.recordRedemption(PROMO_ID);

    const { rows } = await adminPool.query('SELECT current_redemptions FROM pri_rules WHERE id = $1', [PROMO_ID]);
    expect(rows[0].current_redemptions).toBe(2);
  });

  it('expires past-due promotions', async () => {
    const expired = await promotionsService.expirePromotions();
    expect(expired).toBeGreaterThanOrEqual(1);

    const { rows } = await adminPool.query(
      "SELECT status FROM pri_rules WHERE business_id = $1 AND name = 'Old Sale'", [BUSINESS_ID],
    );
    expect(rows[0].status).toBe('expired');
  });

  it('activates scheduled promotions', async () => {
    const activated = await promotionsService.activateScheduledPromotions();
    expect(activated).toBeGreaterThanOrEqual(1);

    const { rows } = await adminPool.query(
      "SELECT status FROM pri_rules WHERE business_id = $1 AND name = 'Future Sale'", [BUSINESS_ID],
    );
    expect(rows[0].status).toBe('active');
  });

  it('stops applying promotion at max redemptions', async () => {
    // Set redemptions to max
    await adminPool.query('UPDATE pri_rules SET current_redemptions = 100 WHERE id = $1', [PROMO_ID]);

    const promos = await promotionsService.getActivePromotions(BUSINESS_ID);
    expect(promos.some((p: any) => p.id === PROMO_ID)).toBe(false);
  });
});
