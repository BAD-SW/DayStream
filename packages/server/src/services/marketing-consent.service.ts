import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Get all communication preferences for a customer.
 */
export async function getPreferences(tenantId: string, customerId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_communication_preferences
     WHERE tenant_id = $1 AND customer_id = $2
     ORDER BY channel, category`,
    [tenantId, customerId],
  );
  return rows;
}

/**
 * Update communication preferences for a customer (upsert).
 */
export async function updatePreferences(
  tenantId: string,
  customerId: string,
  prefs: { channel: string; category: string; optedIn: boolean }[],
) {
  const results = [];

  for (const pref of prefs) {
    const { rows } = await adminPool.query(
      `INSERT INTO mkt_communication_preferences (tenant_id, customer_id, channel, category, opted_in, opted_in_at, opted_out_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user_preference')
       ON CONFLICT (tenant_id, customer_id, channel, category)
       DO UPDATE SET
         opted_in = EXCLUDED.opted_in,
         opted_in_at = CASE WHEN EXCLUDED.opted_in = true THEN NOW() ELSE mkt_communication_preferences.opted_in_at END,
         opted_out_at = CASE WHEN EXCLUDED.opted_in = false THEN NOW() ELSE mkt_communication_preferences.opted_out_at END
       RETURNING *`,
      [
        tenantId,
        customerId,
        pref.channel,
        pref.category,
        pref.optedIn,
        pref.optedIn ? new Date() : null,
        pref.optedIn ? null : new Date(),
      ],
    );
    results.push(rows[0]);
  }

  await logAudit({
    tenantId,
    action: 'preferences.updated',
    resourceType: 'communication_preferences',
    resourceId: customerId,
    details: { channels: prefs.map((p) => `${p.channel}:${p.category}:${p.optedIn}`) },
  });

  return results;
}

/**
 * Process an unsubscribe: set opted_in = false for the given channel and optional category.
 */
export async function processUnsubscribe(
  tenantId: string,
  customerId: string,
  channel: string,
  category?: string,
) {
  if (category) {
    // Unsubscribe from a specific category
    await adminPool.query(
      `INSERT INTO mkt_communication_preferences (tenant_id, customer_id, channel, category, opted_in, opted_out_at, source)
       VALUES ($1, $2, $3, $4, false, NOW(), 'unsubscribe')
       ON CONFLICT (tenant_id, customer_id, channel, category)
       DO UPDATE SET opted_in = false, opted_out_at = NOW()`,
      [tenantId, customerId, channel, category],
    );
  } else {
    // Unsubscribe from all categories for the channel
    await adminPool.query(
      `UPDATE mkt_communication_preferences
       SET opted_in = false, opted_out_at = NOW()
       WHERE tenant_id = $1 AND customer_id = $2 AND channel = $3`,
      [tenantId, customerId, channel],
    );

    // Also insert a global marketing opt-out record
    await adminPool.query(
      `INSERT INTO mkt_communication_preferences (tenant_id, customer_id, channel, category, opted_in, opted_out_at, source)
       VALUES ($1, $2, $3, 'marketing', false, NOW(), 'unsubscribe')
       ON CONFLICT (tenant_id, customer_id, channel, category)
       DO UPDATE SET opted_in = false, opted_out_at = NOW()`,
      [tenantId, customerId, channel],
    );
  }

  await logAudit({
    tenantId,
    action: 'preferences.unsubscribed',
    resourceType: 'communication_preferences',
    resourceId: customerId,
    details: { channel, category: category || 'all' },
  });
}

/**
 * Check if a customer is opted in for a specific channel and category.
 */
export async function isOptedIn(
  tenantId: string,
  customerId: string,
  channel: string,
  category: string,
): Promise<boolean> {
  const { rows } = await adminPool.query(
    `SELECT opted_in FROM mkt_communication_preferences
     WHERE tenant_id = $1 AND customer_id = $2 AND channel = $3 AND category = $4`,
    [tenantId, customerId, channel, category],
  );

  // If no preference record exists, default to not opted in
  if (rows.length === 0) return false;
  return rows[0].opted_in;
}
