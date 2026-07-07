import { adminPool } from '../db/pool';

/**
 * Award points to a customer.
 */
export async function awardPoints(
  tenantId: string,
  customerId: string,
  points: number,
  action: string,
  description?: string,
) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_customer_points (tenant_id, customer_id, points, action, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, customerId, points, action, description || null],
  );
  return rows[0];
}

/**
 * Get current point balance (sum of non-expired points).
 */
export async function getBalance(tenantId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(SUM(points), 0)::int AS balance
     FROM eng_customer_points
     WHERE tenant_id = $1 AND customer_id = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [tenantId, customerId],
  );
  return rows[0].balance;
}

/**
 * Get point history for a customer.
 */
export async function getHistory(tenantId: string, customerId: string, limit = 50) {
  const { rows } = await adminPool.query(
    `SELECT * FROM eng_customer_points
     WHERE tenant_id = $1 AND customer_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tenantId, customerId, limit],
  );
  return rows;
}

/**
 * Redeem points (inserts a negative-value record). Prevents negative balance.
 */
export async function redeemPoints(
  tenantId: string,
  customerId: string,
  points: number,
  description?: string,
) {
  const balance = await getBalance(tenantId, customerId);
  if (balance < points) {
    throw new Error('Insufficient points balance');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO eng_customer_points (tenant_id, customer_id, points, action, description)
     VALUES ($1, $2, $3, 'redeem', $4) RETURNING *`,
    [tenantId, customerId, -points, description || null],
  );
  return rows[0];
}
