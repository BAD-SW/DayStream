import { adminPool } from '../db/pool';
import crypto from 'crypto';

/**
 * Get all webhook subscriptions for a tenant.
 */
export async function getSubscriptions(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM int_webhook_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a webhook subscription.
 */
export async function createSubscription(tenantId: string, input: {
  url: string;
  eventTypes: string[];
  secret?: string;
}) {
  const secret = input.secret || crypto.randomBytes(32).toString('hex');
  const { rows } = await adminPool.query(
    `INSERT INTO int_webhook_subscriptions (tenant_id, url, secret, event_types)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, input.url, secret, JSON.stringify(input.eventTypes)],
  );
  return rows[0];
}

/**
 * Update a webhook subscription.
 */
export async function updateSubscription(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.url !== undefined) { fields.push(`url = $${idx++}`); values.push(updates.url); }
  if (updates.eventTypes !== undefined) { fields.push(`event_types = $${idx++}`); values.push(JSON.stringify(updates.eventTypes)); }
  if (updates.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(updates.isActive); }

  if (fields.length === 0) return null;
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE int_webhook_subscriptions SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Delete a webhook subscription.
 */
export async function deleteSubscription(id: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM int_webhook_subscriptions WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Deliver a webhook event to all matching subscriptions.
 */
export async function deliverWebhook(tenantId: string, eventType: string, data: any) {
  const { rows: subs } = await adminPool.query(
    `SELECT * FROM int_webhook_subscriptions
     WHERE tenant_id = $1 AND is_active = true
       AND event_types @> $2::jsonb`,
    [tenantId, JSON.stringify([eventType])],
  );

  const deliveries = [];
  for (const sub of subs) {
    const payload = { event: eventType, timestamp: new Date().toISOString(), data };
    const signature = crypto.createHmac('sha256', sub.secret).update(JSON.stringify(payload)).digest('hex');

    const { rows } = await adminPool.query(
      `INSERT INTO int_webhook_deliveries (subscription_id, event_type, payload, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [sub.id, eventType, JSON.stringify(payload)],
    );
    deliveries.push({ delivery: rows[0], signature });
  }
  return deliveries;
}

/**
 * Send a webhook delivery via HTTP POST.
 */
export async function sendDelivery(deliveryId: string) {
  const { rows } = await adminPool.query(
    `SELECT d.*, s.url, s.secret FROM int_webhook_deliveries d
     JOIN int_webhook_subscriptions s ON s.id = d.subscription_id
     WHERE d.id = $1`,
    [deliveryId],
  );
  if (rows.length === 0) return null;

  const delivery = rows[0];
  const signature = crypto.createHmac('sha256', delivery.secret).update(JSON.stringify(delivery.payload)).digest('hex');

  try {
    // HTTP POST to the subscription URL with signature header
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body: JSON.stringify(delivery.payload),
    });

    await adminPool.query(
      `UPDATE int_webhook_deliveries SET status = $1, response_status = $2, attempt_count = attempt_count + 1
       WHERE id = $3`,
      [response.ok ? 'sent' : 'failed', response.status, deliveryId],
    );

    if (response.ok) {
      await adminPool.query(
        `UPDATE int_webhook_subscriptions SET last_delivery_at = NOW(), failure_count = 0 WHERE id = $1`,
        [delivery.subscription_id],
      );
    } else {
      await adminPool.query(
        `UPDATE int_webhook_subscriptions SET failure_count = failure_count + 1, last_failure_at = NOW() WHERE id = $1`,
        [delivery.subscription_id],
      );
    }

    return { success: response.ok, status: response.status };
  } catch (error: any) {
    await adminPool.query(
      `UPDATE int_webhook_deliveries SET status = 'retrying', attempt_count = attempt_count + 1,
       next_retry_at = NOW() + INTERVAL '5 minutes' WHERE id = $1`,
      [deliveryId],
    );
    await adminPool.query(
      `UPDATE int_webhook_subscriptions SET failure_count = failure_count + 1, last_failure_at = NOW() WHERE id = $1`,
      [delivery.subscription_id],
    );
    return { success: false, error: error.message };
  }
}

/**
 * Retry failed deliveries that are due now.
 */
export async function retryFailedDeliveries() {
  const { rows } = await adminPool.query(
    `SELECT id FROM int_webhook_deliveries
     WHERE status = 'retrying' AND next_retry_at <= NOW() AND attempt_count < 5`,
  );
  const results = [];
  for (const row of rows) {
    results.push(await sendDelivery(row.id));
  }
  return results;
}

/**
 * Test a webhook subscription with a sample payload.
 */
export async function testWebhook(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM int_webhook_subscriptions WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  if (rows.length === 0) return null;

  const sub = rows[0];
  const payload = { event: 'test.ping', timestamp: new Date().toISOString(), data: { message: 'Test webhook delivery' } };
  const signature = crypto.createHmac('sha256', sub.secret).update(JSON.stringify(payload)).digest('hex');

  const { rows: deliveries } = await adminPool.query(
    `INSERT INTO int_webhook_deliveries (subscription_id, event_type, payload, status)
     VALUES ($1, 'test.ping', $2, 'pending') RETURNING *`,
    [sub.id, JSON.stringify(payload)],
  );

  return sendDelivery(deliveries[0].id);
}

/**
 * Get deliveries for a subscription.
 */
export async function getDeliveries(subscriptionId: string, limit = 50) {
  const { rows } = await adminPool.query(
    `SELECT * FROM int_webhook_deliveries WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [subscriptionId, limit],
  );
  return rows;
}
