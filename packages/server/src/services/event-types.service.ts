import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * List event types for a tenant.
 */
export async function getEventTypes(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM evt_types WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return rows;
}

/**
 * Create an event type.
 */
export async function createEventType(
  tenantId: string,
  input: { name: string; slug: string; description?: string },
) {
  const { rows } = await adminPool.query(
    `INSERT INTO evt_types (tenant_id, name, slug, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, input.name, input.slug, input.description || null],
  );

  await logAudit({
    tenantId,
    action: 'event_type.created',
    resourceType: 'event_type',
    resourceId: rows[0].id,
    details: { name: input.name },
  });

  return rows[0];
}

/**
 * Update an event type.
 */
export async function updateEventType(
  id: string,
  tenantId: string,
  updates: Record<string, any>,
) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.slug !== undefined) { fields.push(`slug = $${idx++}`); values.push(updates.slug); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }

  if (fields.length === 0) return null;
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE evt_types SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      action: 'event_type.updated',
      resourceType: 'event_type',
      resourceId: id,
      details: updates,
    });
  }

  return rows[0] || null;
}

/**
 * Seed default event types for a tenant.
 */
export async function seedDefaultTypes(tenantId: string) {
  const defaults = [
    { name: 'Workshop', slug: 'workshop' },
    { name: 'Seminar', slug: 'seminar' },
    { name: 'Challenge', slug: 'challenge' },
    { name: 'Retreat', slug: 'retreat' },
    { name: 'Class', slug: 'class' },
    { name: 'Webinar', slug: 'webinar' },
  ];

  for (const d of defaults) {
    await adminPool.query(
      `INSERT INTO evt_types (tenant_id, name, slug, is_system)
       VALUES ($1, $2, $3, true) ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [tenantId, d.name, d.slug],
    );
  }
}
