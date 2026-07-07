import { adminPool } from '../db/pool';
import { logger } from '../middleware/logger';

/**
 * Get active promotions (for catalog display).
 */
export async function getActivePromotions(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM pri_rules
     WHERE business_id = $1 AND rule_type = 'promotion' AND status = 'active'
       AND (effective_from IS NULL OR effective_from <= NOW())
       AND (effective_to IS NULL OR effective_to >= NOW())
       AND (max_redemptions IS NULL OR current_redemptions < max_redemptions)
     ORDER BY priority, name`,
    [businessId],
  );
  return rows;
}

/**
 * Increment redemption count for a promotion.
 */
export async function recordRedemption(ruleId: string): Promise<void> {
  await adminPool.query(
    'UPDATE pri_rules SET current_redemptions = current_redemptions + 1 WHERE id = $1',
    [ruleId],
  );
}

/**
 * Scheduled job: expire promotions past their effective_to date.
 */
export async function expirePromotions(): Promise<number> {
  const { rowCount } = await adminPool.query(
    `UPDATE pri_rules SET status = 'expired'
     WHERE rule_type = 'promotion' AND status = 'active'
       AND effective_to IS NOT NULL AND effective_to < NOW()`,
  );

  const count = rowCount ?? 0;
  if (count > 0) logger.info('Promotions expired', { count });
  return count;
}

/**
 * Scheduled job: activate promotions that have reached their effective_from date.
 * (For rules created with status 'inactive' and a future effective_from.)
 */
export async function activateScheduledPromotions(): Promise<number> {
  const { rowCount } = await adminPool.query(
    `UPDATE pri_rules SET status = 'active'
     WHERE rule_type = 'promotion' AND status = 'inactive'
       AND effective_from IS NOT NULL AND effective_from <= NOW()
       AND (effective_to IS NULL OR effective_to >= NOW())`,
  );

  const count = rowCount ?? 0;
  if (count > 0) logger.info('Promotions activated', { count });
  return count;
}
