import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * List recurring event templates for a tenant.
 */
export async function getTemplates(tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT rt.*, et.name AS event_type_name
     FROM recurring_event_templates rt
     LEFT JOIN event_types et ON et.id = rt.event_type_id
     WHERE rt.tenant_id = $1 AND rt.status != 'cancelled'
     ORDER BY rt.created_at DESC`,
    [tenantId],
  );
  return rows;
}

/**
 * Create a recurring event template.
 */
export async function createTemplate(input: any) {
  const { rows } = await adminPool.query(
    `INSERT INTO recurring_event_templates (
       tenant_id, event_type_id, title, description,
       recurrence_pattern, day_of_week, day_of_month, custom_interval_days,
       start_time, duration_minutes,
       location_id, location_name, capacity,
       end_type, end_after_count, end_date, status, template_data
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',$17)
     RETURNING *`,
    [
      input.tenantId, input.eventTypeId || input.event_type_id,
      input.title, input.description || null,
      input.recurrencePattern || input.recurrence_pattern || 'weekly',
      input.dayOfWeek ?? input.day_of_week ?? null,
      input.dayOfMonth ?? input.day_of_month ?? null,
      input.customIntervalDays ?? input.custom_interval_days ?? null,
      input.startTime || input.start_time || '09:00',
      input.durationMinutes || input.duration_minutes || 60,
      input.locationId || input.location_id || null,
      input.locationName || input.location_name || null,
      input.capacity || 20,
      input.endType || input.end_type || 'ongoing',
      input.endAfterCount ?? input.end_after_count ?? null,
      input.endDate || input.end_date || null,
      input.templateData ? JSON.stringify(input.templateData) : '{}',
    ],
  );

  return rows[0];
}

/**
 * Update a recurring event template.
 */
export async function updateTemplate(id: string, tenantId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowedFields = [
    'title', 'description', 'location_id', 'location_name',
    'capacity', 'duration_minutes', 'recurrence_pattern',
    'day_of_week', 'day_of_month', 'custom_interval_days',
    'start_time', 'end_type', 'end_after_count', 'end_date', 'event_type_id',
  ];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (fields.length === 0) return null;
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE recurring_event_templates SET ${fields.join(', ')}
     WHERE id = $${idx++} AND tenant_id = $${idx} AND status = 'active' RETURNING *`,
    values,
  );

  return rows[0] || null;
}

/**
 * Cancel a recurring event template (stops generating new instances).
 */
export async function cancelTemplate(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE recurring_event_templates SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING *`,
    [id, tenantId],
  );
  if (!rows[0]) throw new Error('Template not found or already cancelled');

  await logAudit({
    tenantId,
    action: 'recurring_template.cancelled',
    resourceType: 'recurring_event_template',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Generate event instances from a recurring template for the next 90 days.
 */
export async function generateInstances(templateId: string, tenantId: string) {
  const { rows: templates } = await adminPool.query(
    `SELECT * FROM recurring_event_templates WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
    [templateId, tenantId],
  );
  if (templates.length === 0) throw new Error('Template not found or inactive');

  const template = templates[0];
  const now = new Date();
  const endWindow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  // Find the last generated instance to avoid duplicates
  const { rows: lastInstance } = await adminPool.query(
    `SELECT MAX(start_time) AS last_start FROM events WHERE recurrence_id = $1 AND tenant_id = $2`,
    [templateId, tenantId],
  );
  const generateFrom = lastInstance[0]?.last_start
    ? new Date(new Date(lastInstance[0].last_start).getTime() + 24 * 60 * 60 * 1000)
    : now;

  const dates = computeOccurrences(template, generateFrom, endWindow);
  const created: any[] = [];

  for (const date of dates) {
    const [hours, minutes] = (template.start_time || '09:00').split(':').map(Number);
    const startTime = new Date(date);
    startTime.setHours(hours, minutes, 0, 0);
    const endTime = new Date(startTime.getTime() + (template.duration_minutes || 60) * 60 * 1000);

    const slug = template.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-' + startTime.toISOString().slice(0, 10);

    const { rows } = await adminPool.query(
      `INSERT INTO events (
         tenant_id, event_type_id, title, slug, description,
         start_time, end_time, location_id, location_name,
         capacity, recurrence_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published')
       ON CONFLICT (tenant_id, slug) DO NOTHING
       RETURNING *`,
      [
        tenantId, template.event_type_id, template.title, slug,
        template.description, startTime.toISOString(), endTime.toISOString(),
        template.location_id, template.location_name, template.capacity, templateId,
      ],
    );
    if (rows[0]) created.push(rows[0]);
  }

  return created;
}

/**
 * Compute occurrence dates based on template recurrence pattern.
 */
function computeOccurrences(template: any, from: Date, until: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);

  while (current <= until) {
    const dayOfWeek = current.getDay();
    const dayOfMonth = current.getDate();
    let include = false;

    switch (template.recurrence_pattern) {
      case 'weekly':
        include = template.day_of_week != null ? dayOfWeek === template.day_of_week : true;
        break;
      case 'biweekly': {
        const weekNum = Math.floor((current.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000));
        include = weekNum % 2 === 0 && (template.day_of_week == null || dayOfWeek === template.day_of_week);
        break;
      }
      case 'monthly':
        include = template.day_of_month ? dayOfMonth === template.day_of_month : dayOfMonth === 1;
        break;
      case 'custom':
        // Use custom_interval_days
        if (template.custom_interval_days) {
          const daysSinceStart = Math.floor((current.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
          include = daysSinceStart % template.custom_interval_days === 0;
        }
        break;
    }

    if (include) dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
