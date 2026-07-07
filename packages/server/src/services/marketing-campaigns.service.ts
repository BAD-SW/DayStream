import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * List campaigns with optional filters and pagination.
 */
export async function getCampaigns(
  tenantId: string,
  filters: { channel?: string; status?: string; page?: number; limit?: number } = {},
) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters.channel) {
    conditions.push(`channel = $${idx++}`);
    params.push(filters.channel);
  }
  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM mkt_campaigns WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM mkt_campaigns WHERE ${where}`, params),
  ]);

  return {
    campaigns: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

/**
 * Create a new campaign.
 */
export async function createCampaign(
  tenantId: string,
  input: {
    name: string;
    channel: string;
    segmentId?: string;
    subject?: string;
    senderName?: string;
    senderEmail?: string;
    content?: string;
    htmlContent?: string;
    templateId?: string;
    createdBy?: string;
  },
) {
  const { rows } = await adminPool.query(
    `INSERT INTO mkt_campaigns (tenant_id, name, channel, segment_id, subject, sender_name, sender_email, content, html_content, template_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      tenantId,
      input.name,
      input.channel,
      input.segmentId || null,
      input.subject || null,
      input.senderName || null,
      input.senderEmail || null,
      input.content || null,
      input.htmlContent || null,
      input.templateId || null,
      input.createdBy || null,
    ],
  );

  await logAudit({
    tenantId,
    action: 'campaign.created',
    resourceType: 'campaign',
    resourceId: rows[0].id,
    details: { name: input.name, channel: input.channel },
  });

  return rows[0];
}

/**
 * Get a single campaign by ID.
 */
export async function getCampaignById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_campaigns WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] || null;
}

/**
 * Update a campaign (only if still in draft/scheduled status).
 */
export async function updateCampaign(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.channel !== undefined) { fields.push(`channel = $${idx++}`); values.push(updates.channel); }
  if (updates.segmentId !== undefined) { fields.push(`segment_id = $${idx++}`); values.push(updates.segmentId); }
  if (updates.subject !== undefined) { fields.push(`subject = $${idx++}`); values.push(updates.subject); }
  if (updates.senderName !== undefined) { fields.push(`sender_name = $${idx++}`); values.push(updates.senderName); }
  if (updates.senderEmail !== undefined) { fields.push(`sender_email = $${idx++}`); values.push(updates.senderEmail); }
  if (updates.content !== undefined) { fields.push(`content = $${idx++}`); values.push(updates.content); }
  if (updates.htmlContent !== undefined) { fields.push(`html_content = $${idx++}`); values.push(updates.htmlContent); }
  if (updates.templateId !== undefined) { fields.push(`template_id = $${idx++}`); values.push(updates.templateId); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE mkt_campaigns SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} AND status IN ('draft', 'scheduled') RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Schedule a campaign for future delivery.
 */
export async function scheduleCampaign(id: string, tenantId: string, scheduledAt: string) {
  const { rows } = await adminPool.query(
    `UPDATE mkt_campaigns SET status = 'scheduled', scheduled_at = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND status = 'draft' RETURNING *`,
    [scheduledAt, id, tenantId],
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'campaign.scheduled',
      resourceType: 'campaign',
      resourceId: id,
      details: { scheduledAt },
    });
  }

  return rows[0] || null;
}

/**
 * Send a campaign: resolve segment, create recipients, mark as sending.
 */
export async function sendCampaign(id: string, tenantId: string) {
  const campaign = await getCampaignById(id, tenantId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new Error('Campaign must be in draft or scheduled status to send');
  }

  // Resolve segment recipients (placeholder: fetch all customers with email for the tenant)
  const { rows: customers } = await adminPool.query(
    `SELECT id, email, phone FROM cus_customers WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );

  // Create recipient records
  for (const customer of customers) {
    await adminPool.query(
      `INSERT INTO mkt_campaign_recipients (campaign_id, customer_id, email, phone, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT DO NOTHING`,
      [id, customer.id, customer.email || null, customer.phone || null],
    );
  }

  // Mark campaign as sending
  const { rows } = await adminPool.query(
    `UPDATE mkt_campaigns SET status = 'sending', total_recipients = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [customers.length, id, tenantId],
  );

  await logAudit({
    tenantId,
    action: 'campaign.sending',
    resourceType: 'campaign',
    resourceId: id,
    details: { totalRecipients: customers.length },
  });

  return rows[0];
}

/**
 * Send a test email for a campaign to a specific address.
 */
export async function sendTestEmail(id: string, tenantId: string, toEmail: string) {
  const campaign = await getCampaignById(id, tenantId);
  if (!campaign) throw new Error('Campaign not found');

  // Placeholder: in production this would call the email adapter
  return {
    success: true,
    to: toEmail,
    subject: campaign.subject,
    message: 'Test email queued (mock)',
  };
}
