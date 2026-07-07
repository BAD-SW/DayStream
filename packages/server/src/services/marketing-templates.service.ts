import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * List message templates for a tenant, optionally filtered by channel.
 */
export async function getTemplates(tenantId: string, channel?: string) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];

  if (channel) {
    conditions.push('channel = $2');
    params.push(channel);
  }

  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_message_templates WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

/**
 * Create a new message template.
 */
export async function createTemplate(
  tenantId: string,
  input: {
    name: string;
    channel: string;
    subject?: string;
    htmlContent?: string;
    textContent?: string;
    blocks?: any[];
    category?: string;
  },
) {
  const { rows } = await adminPool.query(
    `INSERT INTO mkt_message_templates (tenant_id, name, channel, subject, html_content, text_content, blocks, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      tenantId,
      input.name,
      input.channel,
      input.subject || null,
      input.htmlContent || null,
      input.textContent || null,
      JSON.stringify(input.blocks || []),
      input.category || null,
    ],
  );

  await logAudit({
    tenantId,
    action: 'template.created',
    resourceType: 'message_template',
    resourceId: rows[0].id,
    details: { name: input.name, channel: input.channel },
  });

  return rows[0];
}

/**
 * Get a single template by ID.
 */
export async function getTemplateById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM mkt_message_templates WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] || null;
}

/**
 * Update a template.
 */
export async function updateTemplate(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.channel !== undefined) { fields.push(`channel = $${idx++}`); values.push(updates.channel); }
  if (updates.subject !== undefined) { fields.push(`subject = $${idx++}`); values.push(updates.subject); }
  if (updates.htmlContent !== undefined) { fields.push(`html_content = $${idx++}`); values.push(updates.htmlContent); }
  if (updates.textContent !== undefined) { fields.push(`text_content = $${idx++}`); values.push(updates.textContent); }
  if (updates.blocks !== undefined) { fields.push(`blocks = $${idx++}`); values.push(JSON.stringify(updates.blocks)); }
  if (updates.category !== undefined) { fields.push(`category = $${idx++}`); values.push(updates.category); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE mkt_message_templates SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Delete a template.
 */
export async function deleteTemplate(id: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM mkt_message_templates WHERE id = $1 AND tenant_id = $2 AND is_system = false`,
    [id, tenantId],
  );

  if ((rowCount ?? 0) > 0) {
    await logAudit({
      tenantId,
      action: 'template.deleted',
      resourceType: 'message_template',
      resourceId: id,
    });
  }

  return (rowCount ?? 0) > 0;
}

/**
 * Render a template by replacing {{placeholder}} tokens with provided data values.
 */
export async function renderTemplate(templateId: string, tenantId: string, data: Record<string, any>) {
  const template = await getTemplateById(templateId, tenantId);
  if (!template) throw new Error('Template not found');

  const replacePlaceholders = (text: string | null): string | null => {
    if (!text) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      return data[key] !== undefined ? String(data[key]) : '';
    });
  };

  return {
    subject: replacePlaceholders(template.subject),
    htmlContent: replacePlaceholders(template.html_content),
    textContent: replacePlaceholders(template.text_content),
  };
}
