import { adminPool } from '../db/pool';

/**
 * Record a price change in the history log.
 */
export async function recordPriceChange(
  businessId: string,
  entityType: 'service_variant' | 'membership_plan',
  entityId: string,
  oldPrice: number,
  newPrice: number,
  changedBy?: string,
  effectiveFrom?: string,
): Promise<void> {
  await adminPool.query(
    `INSERT INTO price_history (business_id, entity_type, entity_id, old_price, new_price, effective_from, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [businessId, entityType, entityId, oldPrice, newPrice, effectiveFrom || new Date().toISOString(), changedBy || null],
  );
}

/**
 * Get price history for a specific entity.
 */
export async function getEntityHistory(entityType: string, entityId: string) {
  const { rows } = await adminPool.query(
    `SELECT ph.*, u.first_name, u.last_name
     FROM price_history ph
     LEFT JOIN users u ON u.id = ph.changed_by
     WHERE ph.entity_type = $1 AND ph.entity_id = $2
     ORDER BY ph.created_at DESC`,
    [entityType, entityId],
  );
  return rows;
}

/**
 * Get all price changes for a business (paginated).
 */
export async function getBusinessHistory(businessId: string, filters?: { entityType?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) {
  const conditions = ['ph.business_id = $1'];
  const params: any[] = [businessId];
  let idx = 2;

  if (filters?.entityType) { conditions.push(`ph.entity_type = $${idx++}`); params.push(filters.entityType); }
  if (filters?.dateFrom) { conditions.push(`ph.created_at >= $${idx++}`); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push(`ph.created_at <= $${idx++}`); params.push(filters.dateTo); }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters?.limit || 50, 100);
  const page = filters?.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT ph.*, u.first_name, u.last_name FROM price_history ph
       LEFT JOIN users u ON u.id = ph.changed_by
       WHERE ${where} ORDER BY ph.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM price_history ph WHERE ${where}`, params),
  ]);

  return { entries: dataResult.rows, total: countResult.rows[0].total, page, limit };
}

/**
 * Get the effective price for an entity at a specific point in time.
 * Useful for scheduled future price changes.
 */
export async function getEffectivePrice(entityType: string, entityId: string, atDate?: string): Promise<number | null> {
  const date = atDate || new Date().toISOString();

  const { rows } = await adminPool.query(
    `SELECT new_price FROM price_history
     WHERE entity_type = $1 AND entity_id = $2 AND effective_from <= $3
     ORDER BY effective_from DESC LIMIT 1`,
    [entityType, entityId, date],
  );

  return rows.length > 0 ? rows[0].new_price : null;
}
