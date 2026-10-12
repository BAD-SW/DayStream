import { adminPool } from '../db/pool';
import { getMemberIds } from './customer-segments.service';
import { filterAudience, summarise } from './contactability.service';
import { logAudit } from './audit.service';

/** A campaign, segment or person of one business used from another (Phase 46 R14). */
export class CrossBusinessError extends Error {
  code = 'CROSS_BUSINESS';
}

/**
 * List campaigns with optional filters and pagination.
 */
export async function getCampaigns(
  tenantId: string,
  filters: { channel?: string; status?: string; page?: number; limit?: number; businessId?: string } = {},
) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  // Phase 46 R14: a business sees only its own campaigns.
  if (filters.businessId) {
    conditions.push(`business_id = $${idx++}`);
    params.push(filters.businessId);
  }

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
    businessId?: string;
  },
) {
  // The audience must be a segment of the same business (Phase 46 R14).
  let businessId = input.businessId || null;
  if (input.segmentId) {
    const { rows: seg } = await adminPool.query(
      `SELECT s.business_id FROM cus_segments s JOIN sys_businesses b ON b.id = s.business_id WHERE s.id = $1 AND b.tenant_id = $2`,
      [input.segmentId, tenantId],
    );
    if (!seg[0]) throw new CrossBusinessError('The audience of this campaign was not found');
    if (businessId && seg[0].business_id !== businessId) throw new CrossBusinessError('The audience belongs to another business');
    businessId = businessId || seg[0].business_id;
  }

  const { rows } = await adminPool.query(
    `INSERT INTO mkt_campaigns (tenant_id, name, channel, segment_id, subject, sender_name, sender_email, content, html_content, template_id, created_by, business_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
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
      businessId,
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

  if (updates.segmentId) {
    const { rows: ok } = await adminPool.query(
      `SELECT 1 FROM mkt_campaigns c JOIN cus_segments s ON s.id = $2
        WHERE c.id = $1 AND c.tenant_id = $3 AND (c.business_id IS NULL OR c.business_id = s.business_id)`,
      [id, updates.segmentId, tenantId],
    );
    if (!ok[0]) throw new CrossBusinessError('The audience belongs to another business');
  }

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

  // Phase 46: the audience is the campaign's segment, evaluated now, and only the people who may
  // be contacted on this channel for marketing. Until this change every active person of the
  // whole tenant was made a recipient, whatever the segment or their consent.
  if (!campaign.segment_id) throw new Error('Choose an audience (a segment) before sending');
  const { rows: segmentRows } = await adminPool.query(
    `SELECT s.id, s.business_id FROM cus_segments s
       JOIN sys_businesses b ON b.id = s.business_id
      WHERE s.id = $1 AND b.tenant_id = $2`,
    [campaign.segment_id, tenantId],
  );
  if (!segmentRows[0]) throw new Error('The audience of this campaign no longer exists');
  const audienceBusinessId: string = segmentRows[0].business_id;
  if (campaign.business_id && campaign.business_id !== audienceBusinessId) {
    throw new CrossBusinessError('The audience of this campaign belongs to another business');
  }

  const memberIds = (await getMemberIds(campaign.segment_id, audienceBusinessId)) || [];
  const audience = await filterAudience(audienceBusinessId, memberIds, campaign.channel, 'marketing');
  const allowedIds = audience.allowed.map((a) => a.personId);
  const { rows: customers } = allowedIds.length === 0 ? { rows: [] as any[] } : await adminPool.query(
    `SELECT id, email, COALESCE(phone_e164, phone) AS phone FROM cus_customers WHERE id = ANY($1::uuid[])`,
    [allowedIds],
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
    details: { totalRecipients: customers.length, audience: summarise(audience) },
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
