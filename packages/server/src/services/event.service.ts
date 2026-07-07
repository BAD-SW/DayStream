import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

interface CreateEventInput {
  tenantId: string;
  eventTypeId: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  locationId?: string;
  locationName?: string;
  capacity: number;
  minAttendees?: number;
  tags?: string[];
  customFields?: Record<string, any>;
  cancellationPolicy?: string;
  coverImagePath?: string;
  createdBy: string;
}

interface EventFilters {
  eventTypeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Create an event.
 */
export async function createEvent(input: CreateEventInput) {
  const slug = generateSlug(input.title) + '-' + Date.now().toString(36);

  const { rows } = await adminPool.query(
    `INSERT INTO evt_events (
       tenant_id, event_type_id, title, slug, description,
       start_time, end_time, location_id, location_name,
       capacity, min_attendees, tags, custom_fields,
       cancellation_policy, cover_image_path, created_by, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft')
     RETURNING *`,
    [
      input.tenantId,
      input.eventTypeId,
      input.title,
      slug,
      input.description || null,
      input.startTime,
      input.endTime,
      input.locationId || null,
      input.locationName || null,
      input.capacity,
      input.minAttendees || null,
      input.tags || null,
      input.customFields ? JSON.stringify(input.customFields) : '[]',
      input.cancellationPolicy || null,
      input.coverImagePath || null,
      input.createdBy,
    ],
  );

  await logAudit({
    tenantId: input.tenantId,
    userId: input.createdBy,
    action: 'event.created',
    resourceType: 'event',
    resourceId: rows[0].id,
    details: { title: input.title },
  });

  return rows[0];
}

/**
 * List events with filters and pagination.
 */
export async function getEvents(tenantId: string, filters: EventFilters = {}) {
  const conditions = ['e.tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters.eventTypeId) {
    conditions.push(`e.event_type_id = $${idx++}`);
    params.push(filters.eventTypeId);
  }
  if (filters.status) {
    conditions.push(`e.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.startDate) {
    conditions.push(`e.start_time >= $${idx++}::timestamptz`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`e.end_time <= $${idx++}::timestamptz`);
    params.push(filters.endDate);
  }
  if (filters.search) {
    conditions.push(`(e.title ILIKE $${idx} OR e.description ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 20, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const { rows } = await adminPool.query(
    `SELECT e.*,
            et.name AS event_type_name,
            (SELECT COUNT(*)::int FROM evt_registrations er
             WHERE er.event_id = e.id AND er.status IN ('confirmed','pending')) AS registrations_count
     FROM evt_events e
     LEFT JOIN evt_types et ON et.id = e.event_type_id
     WHERE ${where}
     ORDER BY e.start_time ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );

  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS total FROM evt_events e WHERE ${where}`,
    params,
  );

  return { events: rows, total: countRows[0].total, page, limit };
}

/**
 * Get a single event by ID.
 */
export async function getEventById(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `SELECT e.*,
            et.name AS event_type_name,
            (SELECT COUNT(*)::int FROM evt_registrations er
             WHERE er.event_id = e.id AND er.status IN ('confirmed','pending')) AS registrations_count
     FROM evt_events e
     LEFT JOIN evt_types et ON et.id = e.event_type_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] || null;
}

/**
 * Update an event.
 */
export async function updateEvent(
  id: string,
  tenantId: string,
  updates: Record<string, any>,
  userId: string,
) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowedFields = [
    'title', 'description', 'start_time', 'end_time', 'location_id',
    'location_name', 'capacity', 'min_attendees', 'tags', 'custom_fields',
    'cancellation_policy', 'cover_image_path', 'event_type_id',
  ];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      const val = key === 'custom_fields' ? JSON.stringify(updates[key]) : updates[key];
      values.push(val);
    }
  }

  if (fields.length === 0) return null;
  fields.push(`updated_at = NOW()`);
  values.push(id, tenantId);

  const { rows } = await adminPool.query(
    `UPDATE evt_events SET ${fields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING *`,
    values,
  );

  if (rows[0]) {
    await logAudit({
      tenantId,
      userId,
      action: 'event.updated',
      resourceType: 'event',
      resourceId: id,
      details: updates,
    });
  }

  return rows[0] || null;
}

/**
 * Publish an event (make it visible for registration).
 */
export async function publishEvent(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_events SET status = 'published', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status = 'draft' RETURNING *`,
    [id, tenantId],
  );
  if (!rows[0]) throw new Error('Event not found or not in draft status');

  await logAudit({
    tenantId,
    action: 'event.published',
    resourceType: 'event',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Cancel an event.
 */
export async function cancelEvent(id: string, tenantId: string, userId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_events SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','published') RETURNING *`,
    [id, tenantId],
  );
  if (!rows[0]) throw new Error('Event not found or cannot be cancelled');

  await logAudit({
    tenantId,
    userId,
    action: 'event.cancelled',
    resourceType: 'event',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Mark an event as completed.
 */
export async function completeEvent(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE evt_events SET status = 'completed', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status = 'published' RETURNING *`,
    [id, tenantId],
  );
  if (!rows[0]) throw new Error('Event not found or not in published status');

  await logAudit({
    tenantId,
    action: 'event.completed',
    resourceType: 'event',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Add a facilitator to an event.
 */
export async function addFacilitator(eventId: string, staffId: string, role: string) {
  const { rows } = await adminPool.query(
    `INSERT INTO evt_facilitators (event_id, staff_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id, staff_id) DO UPDATE SET role = $3
     RETURNING *`,
    [eventId, staffId, role],
  );
  return rows[0];
}

/**
 * Remove a facilitator from an event.
 */
export async function removeFacilitator(id: string, eventId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM evt_facilitators WHERE id = $1 AND event_id = $2`,
    [id, eventId],
  );
  return (rowCount ?? 0) > 0;
}
