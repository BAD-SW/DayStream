import { adminPool } from '../db/pool';

/**
 * Get check-in config for a tenant, or create default config if none exists.
 */
export async function getConfig(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM apt_check_in_config WHERE tenant_id = $1`,
    [tenantId],
  );

  if (rows.length > 0) return rows[0];

  // Create default config
  const { rows: newRows } = await adminPool.query(
    `INSERT INTO apt_check_in_config (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = $1
     RETURNING *`,
    [tenantId],
  );

  return newRows[0];
}

/**
 * Update check-in config fields for a tenant.
 */
export async function updateConfig(tenantId: string, updates: Record<string, any>) {
  const allowedFields = [
    'grace_period_minutes',
    'early_arrival_minutes',
    'late_arrival_max_minutes',
    'credit_deduction_mode',
    'no_show_warning_threshold',
    'no_show_restrict_threshold',
    'no_show_ban_threshold',
    'walk_in_enabled',
    'kiosk_enabled',
  ];

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (fields.length === 0) return getConfig(tenantId);

  values.push(tenantId);

  const { rows } = await adminPool.query(
    `UPDATE apt_check_in_config SET ${fields.join(', ')} WHERE tenant_id = $${idx} RETURNING *`,
    values,
  );

  if (rows.length === 0) {
    // Config didn't exist yet — create then update
    await getConfig(tenantId);
    return updateConfig(tenantId, updates);
  }

  return rows[0];
}
