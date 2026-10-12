import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { setConsent, isGiven, ConsentChannel } from './consent.service';

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
    // Phase 46: written through the single consent store, which also records the history.
    await setConsent({
      customerId, channel: pref.channel as ConsentChannel, category: pref.category, given: pref.optedIn, method: 'portal',
    });
    const { rows } = await adminPool.query(
      `SELECT * FROM mkt_communication_preferences WHERE tenant_id = $1 AND customer_id = $2 AND channel = $3 AND category = $4`,
      [tenantId, customerId, pref.channel, pref.category],
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
    await setConsent({ customerId, channel: channel as ConsentChannel, category, given: false, method: 'unsubscribe_link' });
  } else {
    // Unsubscribe from every marketing category for the channel. Booking reminders are not
    // marketing and stay as they are.
    const { rows: existing } = await adminPool.query(
      `SELECT category FROM mkt_communication_preferences
        WHERE tenant_id = $1 AND customer_id = $2 AND channel = $3 AND opted_in = true AND category <> 'reminders'`,
      [tenantId, customerId, channel],
    );
    for (const row of existing) {
      await setConsent({ customerId, channel: channel as ConsentChannel, category: row.category, given: false, method: 'unsubscribe_link' });
    }
    await setConsent({ customerId, channel: channel as ConsentChannel, category: 'marketing', given: false, method: 'unsubscribe_link' });
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
  // No record means: marketing not given, reminders on (see consent.service).
  return isGiven(customerId, channel as ConsentChannel, category);
}
