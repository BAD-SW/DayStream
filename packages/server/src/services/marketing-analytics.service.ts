import { adminPool } from '../db/pool';

/**
 * Get aggregate analytics for a campaign.
 */
export async function getCampaignAnalytics(campaignId: string) {
  const { rows } = await adminPool.query(
    `SELECT
       COUNT(*)::int AS sent,
       COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked'))::int AS delivered,
       COUNT(*) FILTER (WHERE status IN ('opened', 'clicked'))::int AS opened,
       COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
       COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced,
       COUNT(*) FILTER (WHERE status = 'unsubscribed')::int AS unsubscribed
     FROM mkt_campaign_recipients
     WHERE campaign_id = $1 AND status != 'pending'`,
    [campaignId],
  );

  const stats = rows[0];
  const sent = stats.sent || 0;

  return {
    sent,
    delivered: stats.delivered,
    opened: stats.opened,
    clicked: stats.clicked,
    bounced: stats.bounced,
    unsubscribed: stats.unsubscribed,
    deliveryRate: sent > 0 ? Math.round((stats.delivered / sent) * 10000) / 100 : 0,
    openRate: sent > 0 ? Math.round((stats.opened / sent) * 10000) / 100 : 0,
    clickRate: sent > 0 ? Math.round((stats.clicked / sent) * 10000) / 100 : 0,
    bounceRate: sent > 0 ? Math.round((stats.bounced / sent) * 10000) / 100 : 0,
  };
}

/**
 * Get the recipient list for a campaign with optional status filter.
 */
export async function getRecipientList(
  campaignId: string,
  filters: { status?: string; page?: number; limit?: number } = {},
) {
  const conditions = ['cr.campaign_id = $1'];
  const params: any[] = [campaignId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`cr.status = $${idx++}`);
    params.push(filters.status);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 50, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT cr.*, c.first_name, c.last_name
       FROM mkt_campaign_recipients cr
       LEFT JOIN cus_customers c ON c.id = cr.customer_id
       WHERE ${where}
       ORDER BY cr.sent_at DESC NULLS LAST
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*)::int AS total FROM mkt_campaign_recipients cr WHERE ${where}`,
      params,
    ),
  ]);

  return {
    recipients: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Get engagement timeline: opens and clicks grouped by hour.
 */
export async function getEngagementTimeline(campaignId: string) {
  const { rows: opens } = await adminPool.query(
    `SELECT date_trunc('hour', opened_at) AS hour, COUNT(*)::int AS count
     FROM mkt_campaign_recipients
     WHERE campaign_id = $1 AND opened_at IS NOT NULL
     GROUP BY hour ORDER BY hour`,
    [campaignId],
  );

  const { rows: clicks } = await adminPool.query(
    `SELECT date_trunc('hour', clicked_at) AS hour, COUNT(*)::int AS count
     FROM mkt_campaign_recipients
     WHERE campaign_id = $1 AND clicked_at IS NOT NULL
     GROUP BY hour ORDER BY hour`,
    [campaignId],
  );

  return { opens, clicks };
}
