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
  /** A tax category of the hosting business; none = that business's default tax (THE-20). */
  taxCategoryId?: string | null;
}

interface EventFilters {
  eventTypeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  /** true: only deleted (archived) events; otherwise deleted events are left out. */
  deleted?: boolean;
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
       cancellation_policy, cover_image_path, created_by, status, tax_category_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17)
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
      input.taxCategoryId || null,
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
  const conditions = ['e.tenant_id = $1', filters.deleted ? 'e.deleted_at IS NOT NULL' : 'e.deleted_at IS NULL'];
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
/** A change the server refuses (shown to the user as it is). */
export class EventChangeError extends Error {}

/**
 * Update an event. Changes to a published event stay live (decision 14). Capacity cannot go below
 * the places already taken. When the date, time or place changes while people are registered, the
 * refund window opens (`change_refund_until`, events.change_refund_days of the hosting business)
 * and the result says so in `material_change`, so the page can offer to tell them.
 * Choosing where it is hosted also sets the location's name, which customers see.
 */
export async function updateEvent(
  id: string,
  tenantId: string,
  updates: Record<string, any>,
  userId: string,
) {
  const { rows: before } = await adminPool.query(
    `SELECT e.start_time, e.end_time, e.location_id, e.status,
            (SELECT COALESCE(SUM(r.group_size), 0)::int FROM evt_registrations r WHERE r.event_id = e.id AND r.status IN ('confirmed', 'pending')) AS taken,
            (SELECT COUNT(*)::int FROM evt_registrations r WHERE r.event_id = e.id AND r.status IN ('confirmed', 'pending')) AS registrations
       FROM evt_events e WHERE e.id = $1 AND e.tenant_id = $2`,
    [id, tenantId],
  );
  const old = before[0];
  if (!old) return null;
  if (updates.capacity !== undefined && updates.capacity !== null && Number(updates.capacity) < old.taken) {
    throw new EventChangeError(`Capacity cannot be lower than the ${old.taken} ${old.taken === 1 ? "place" : "places"} already taken`);
  }
  if (updates.start_time !== undefined || updates.end_time !== undefined) {
    const start = new Date(updates.start_time ?? old.start_time); const end = new Date(updates.end_time ?? old.end_time);
    if (!(end > start)) throw new EventChangeError('The event must end after it starts');
  }
  if (updates.location_id) {
    const { rows: loc } = await adminPool.query('SELECT name FROM sys_locations WHERE id = $1', [updates.location_id]);
    if (loc[0]) updates = { ...updates, location_name: loc[0].name };
  }
  const changedTime = (k: 'start_time' | 'end_time') => updates[k] !== undefined && new Date(updates[k]).getTime() !== new Date(old[k]).getTime();
  const material = changedTime('start_time') || changedTime('end_time')
    || (updates.location_id !== undefined && (updates.location_id || null) !== (old.location_id || null));

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowedFields = [
    'title', 'description', 'start_time', 'end_time', 'location_id',
    'location_name', 'capacity', 'min_attendees', 'tags', 'custom_fields',
    'cancellation_policy', 'cover_image_path', 'event_type_id', 'tax_category_id',
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

  if (rows[0] && material && old.registrations > 0) {
    const { rows: host } = await adminPool.query(
      `SELECT COALESCE(l.business_id, u.business_id) AS business_id FROM evt_events e
         LEFT JOIN sys_locations l ON l.id = e.location_id LEFT JOIN usr_users u ON u.id = e.created_by WHERE e.id = $1`, [id],
    );
    const { getCancelSettings } = await import('./customer-cancellation.service');
    const days = (await getCancelSettings(host[0]?.business_id || null, 'events')).change_refund_days;
    const { rows: opened } = await adminPool.query(
      `UPDATE evt_events SET change_refund_until = LEAST(NOW() + make_interval(days => $2::int), start_time) WHERE id = $1 RETURNING change_refund_until`,
      [id, days],
    );
    return { ...rows[0], change_refund_until: opened[0].change_refund_until, material_change: { registrations: old.registrations, refund_until: opened[0].change_refund_until, refund_days: days } };
  }

  return rows[0] || null;
}

/**
 * Take a published event back to draft (decision 14): only while nobody is registered or waiting.
 */
export async function unpublishEvent(id: string, tenantId: string) {
  const { rows: held } = await adminPool.query(
    `SELECT (SELECT COUNT(*)::int FROM evt_registrations r WHERE r.event_id = $1 AND r.status IN ('confirmed', 'pending')) AS registrations,
            (SELECT COUNT(*)::int FROM evt_waitlist w WHERE w.event_id = $1 AND w.status IN ('waiting', 'offered', 'notified')) AS waiting`,
    [id],
  );
  if (held[0].registrations > 0 || held[0].waiting > 0) {
    throw new EventChangeError('People are registered or waiting: it can no longer be unpublished. Cancel the event instead (they are told and refunded).');
  }
  const { rows } = await adminPool.query(
    `UPDATE evt_events SET status = 'draft', updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND status = 'published' RETURNING *`,
    [id, tenantId],
  );
  if (!rows[0]) throw new EventChangeError('Only a published event can be unpublished');
  await logAudit({ tenantId, action: 'event.unpublished', resourceType: 'event', resourceId: id });
  return rows[0];
}

/**
 * Publish an event (make it visible for registration).
 */
export async function publishEvent(id: string, tenantId: string) {
  const { rows: tiers } = await adminPool.query(
    'SELECT 1 FROM evt_ticket_tiers t JOIN evt_events e ON e.id = t.event_id WHERE t.event_id = $1 AND e.tenant_id = $2 LIMIT 1', [id, tenantId],
  );
  if (tiers.length === 0) throw new Error('Add at least one ticket (it can be free) before publishing: nobody could register otherwise');
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
/**
 * What cancelling an event will do (David, 2026-10-29), shown before the person confirms:
 * how many registrations are cancelled, how many paid tickets are refunded and for how much,
 * where the money goes (the hosting business's event setting: card or account credit), and how
 * many people leave the waiting list.
 */
export async function cancelPreview(id: string, tenantId: string) {
  const { rows: ev } = await adminPool.query('SELECT id, status FROM evt_events WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!ev[0]) throw new Error('Event not found');
  const { rows: [counts] } = await adminPool.query(
    `SELECT (SELECT COUNT(*)::int FROM evt_registrations WHERE event_id = $1 AND status IN ('confirmed', 'pending')) AS registrations,
            (SELECT COUNT(*)::int FROM evt_waitlist WHERE event_id = $1 AND status IN ('waiting', 'notified')) AS waiting`,
    [id],
  );
  // Paid = the ticket's order is completed (or partly refunded) and still has event lines to refund.
  const { rows: paid } = await adminPool.query(
    `SELECT COUNT(DISTINCT r.id)::int AS tickets,
            COALESCE(SUM(oi.line_left), 0)::int AS amount,
            MAX(b.currency) AS currency
       FROM evt_registrations r
       JOIN fin_orders o ON o.id = r.order_id AND o.status IN ('completed', 'partially_refunded')
       LEFT JOIN sys_businesses b ON b.id = o.business_id
       JOIN LATERAL (
         SELECT SUM(ROUND((oi.quantity - oi.refunded_quantity)::numeric / NULLIF(oi.quantity, 0) * (oi.unit_price * oi.quantity - COALESCE(oi.discount_amount, 0) + COALESCE(oi.tax_amount, 0))))::int AS line_left
           FROM fin_order_items oi WHERE oi.order_id = o.id AND oi.item_type = 'event' AND oi.quantity > oi.refunded_quantity
       ) oi ON oi.line_left > 0
      WHERE r.event_id = $1 AND r.status IN ('confirmed', 'pending')`,
    [id],
  );
  const { hostBusinessId } = await import('./customer-events.service');
  const { getCancelSettings } = await import('./customer-cancellation.service');
  const hostId = await hostBusinessId(id);
  const settings = hostId ? await getCancelSettings(hostId, 'events') : null;
  return {
    status: ev[0].status,
    registrations: counts.registrations,
    waiting: counts.waiting,
    paid_tickets: paid[0]?.tickets || 0,
    refund_amount: paid[0]?.amount || 0,
    currency: paid[0]?.currency || 'EUR',
    refund_to: settings?.cancel_refund_to === 'credit' ? 'credit' : 'card',
  };
}

export async function cancelEvent(id: string, tenantId: string, userId: string) {
  const { rows: ev } = await adminPool.query(
    `SELECT id FROM evt_events WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','published')`, [id, tenantId]);
  if (!ev[0]) throw new Error('Event not found or cannot be cancelled');
  // The waiting list goes first, so nobody is moved into a place that is being cancelled.
  await adminPool.query(`UPDATE evt_waitlist SET status = 'expired' WHERE event_id = $1 AND status IN ('waiting', 'notified')`, [id]).catch(() => undefined);
  // Each registration is cancelled the way staff cancel one (David, 2026-10-29): a paid ticket is
  // refunded (card or account credit, as the hosting business set it) and the customer is emailed.
  const { cancelOwnRegistration } = await import('./customer-events.service');
  const { rows: regs } = await adminPool.query(
    `SELECT id FROM evt_registrations WHERE event_id = $1 AND status IN ('confirmed', 'pending') ORDER BY created_at`, [id]);
  const failed: string[] = [];
  for (const r of regs) {
    try { await cancelOwnRegistration({ registrationId: r.id, tenantId, userId, byCustomer: false }); }
    catch (err: any) { failed.push(err?.message || 'not cancelled'); }
  }
  if (failed.length > 0) {
    throw new Error(`The event was not cancelled: ${failed.length} of ${regs.length} registrations could not be cancelled (${failed[0]}). The others were cancelled and refunded; try again.`);
  }
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

export class EventArchiveError extends Error {
  constructor(message: string, public status = 400, public code = 'VALIDATION_ERROR') { super(message); }
}

/**
 * Delete an event (David, 2026-10-28): it is archived, not erased, and can be restored. Only an
 * event with no registrations and nobody on its waiting list can be deleted; one that has them
 * is cancelled first (cancelling cancels its registrations and empties the waiting list).
 */
export async function archiveEvent(id: string, tenantId: string, userId: string) {
  const { rows: ev } = await adminPool.query('SELECT id, deleted_at FROM evt_events WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (!ev[0]) throw new EventArchiveError('Event not found', 404, 'NOT_FOUND');
  if (ev[0].deleted_at) throw new EventArchiveError('This event is already deleted', 409, 'ALREADY_DELETED');
  const { rows: [held] } = await adminPool.query(
    `SELECT (SELECT COUNT(*)::int FROM evt_registrations WHERE event_id = $1 AND status IN ('pending', 'confirmed', 'waitlisted')) AS registrations,
            (SELECT COUNT(*)::int FROM evt_waitlist WHERE event_id = $1 AND status IN ('waiting', 'notified')) AS waiting`,
    [id],
  );
  if (held.registrations > 0 || held.waiting > 0) {
    const parts = [held.registrations ? `${held.registrations} ${held.registrations === 1 ? 'registration' : 'registrations'}` : '',
      held.waiting ? `${held.waiting} on the waiting list` : ''].filter(Boolean).join(' and ');
    throw new EventArchiveError(`This event has ${parts}. Cancel the event first, then delete it.`, 409, 'HAS_REGISTRATIONS');
  }
  const { rows } = await adminPool.query(
    'UPDATE evt_events SET deleted_at = NOW(), deleted_by = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *',
    [id, tenantId, userId],
  );
  await logAudit({ tenantId, userId, action: 'event.deleted', resourceType: 'event', resourceId: id });
  return rows[0];
}

/** Bring a deleted event back, with the status it had. */
export async function restoreEvent(id: string, tenantId: string, userId: string) {
  const { rows } = await adminPool.query(
    'UPDATE evt_events SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL RETURNING *',
    [id, tenantId],
  );
  if (!rows[0]) throw new EventArchiveError('Deleted event not found', 404, 'NOT_FOUND');
  await logAudit({ tenantId, userId, action: 'event.restored', resourceType: 'event', resourceId: id });
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
 * An event's facilitators with the staff member's name (the Facilitators tab).
 */
export async function getFacilitators(eventId: string) {
  const { rows } = await adminPool.query(
    `SELECT f.id, f.staff_id, f.role, f.created_at, TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS staff_name
     FROM evt_facilitators f JOIN stf_profiles p ON p.id = f.staff_id
     WHERE f.event_id = $1 ORDER BY f.created_at`,
    [eventId],
  );
  return rows;
}

/**
 * Add a facilitator to an event. The staff member must belong to the event's tenant.
 */
export async function addFacilitator(eventId: string, staffId: string, role: string) {
  const { rows: ok } = await adminPool.query(
    `SELECT 1 FROM evt_events e JOIN stf_profiles p ON p.tenant_id = e.tenant_id
     WHERE e.id = $1 AND p.id::text = $2`,
    [eventId, staffId || ''],
  );
  if (!ok.length) throw Object.assign(new Error('Choose a staff member of this business'), { status: 400 });
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
