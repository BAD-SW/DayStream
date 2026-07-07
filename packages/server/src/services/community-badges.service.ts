import { adminPool } from '../db/pool';

/**
 * Get all badges for a tenant.
 */
export async function getBadges(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM eng_badges WHERE tenant_id = $1 ORDER BY tier, name`,
    [tenantId],
  );
  return rows;
}

/**
 * Get badges earned by a customer.
 */
export async function getEarnedBadges(customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT b.*, cb.earned_at
     FROM eng_customer_badges cb
     JOIN eng_badges b ON b.id = cb.badge_id
     WHERE cb.customer_id = $1
     ORDER BY cb.earned_at DESC`,
    [customerId],
  );
  return rows;
}

/**
 * Award a badge to a customer (inserts into customer_badges).
 */
export async function awardBadge(customerId: string, badgeId: string) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_customer_badges (customer_id, badge_id)
     VALUES ($1, $2)
     ON CONFLICT (customer_id, badge_id) DO NOTHING
     RETURNING *`,
    [customerId, badgeId],
  );
  return rows[0] || null;
}

/**
 * Create a new badge definition.
 */
export async function createBadge(tenantId: string, input: {
  name: string;
  description?: string;
  iconPath?: string;
  tier?: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  pointsAward?: number;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_badges (tenant_id, name, description, icon_path, tier, trigger_type, trigger_config, points_award)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      tenantId,
      input.name,
      input.description || null,
      input.iconPath || null,
      input.tier || 'standard',
      input.triggerType,
      JSON.stringify(input.triggerConfig),
      input.pointsAward ?? 0,
    ],
  );
  return rows[0];
}
