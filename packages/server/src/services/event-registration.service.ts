import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import crypto from 'crypto';

interface RegisterInput {
  customerId: string;
  ticketTierId?: string;
  attendeeInfo?: Record<string, any>;
  groupSize?: number;
}

interface RegistrationFilters {
  status?: string;
  customerId?: string;
  page?: number;
  limit?: number;
}

/**
 * Generate a unique reference number for a registration.
 */
export function generateReferenceNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EVT-${timestamp}-${random}`;
}

/**
 * Register for an event. Creates with status='pending' and a 10-minute hold.
 * For free events (price=0 or no tier), immediately confirms.
 */
export async function registerForEvent(
  eventId: string,
  input: RegisterInput,
) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Check event capacity
    const { rows: eventRows } = await client.query(
      `SELECT e.*, e.tenant_id FROM events e WHERE e.id = $1 AND e.status = 'published' FOR UPDATE`,
      [eventId],
    );
    if (eventRows.length === 0) throw new Error('Event not found or not open for registration');

    const event = eventRows[0];
    const groupSize = input.groupSize || 1;

    // Check current registration count
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM event_registrations
       WHERE event_id = $1 AND status IN ('confirmed','pending')`,
      [eventId],
    );
    if (countRows[0].count + groupSize > event.capacity) {
      await client.query('ROLLBACK');
      throw new Error('Event is at capacity');
    }

    // Check ticket tier availability if specified
    let isFree = true;
    if (input.ticketTierId) {
      const { rows: tierRows } = await client.query(
        `SELECT * FROM event_ticket_tiers WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [input.ticketTierId, eventId],
      );
      if (tierRows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('Ticket tier not found');
      }

      const tier = tierRows[0];
      isFree = tier.price === 0;

      const { rows: soldRows } = await client.query(
        `SELECT COALESCE(SUM(group_size), 0)::int AS sold FROM event_registrations
         WHERE ticket_tier_id = $1 AND status IN ('confirmed','pending')`,
        [input.ticketTierId],
      );
      if (tier.quantity_available && soldRows[0].sold + groupSize > tier.quantity_available) {
        await client.query('ROLLBACK');
        throw new Error('Ticket tier sold out');
      }
    }

    const referenceNumber = generateReferenceNumber();
    const status = isFree ? 'confirmed' : 'pending';
    const holdExpiresAt = isFree ? null : new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { rows } = await client.query(
      `INSERT INTO event_registrations (
         event_id, customer_id, ticket_tier_id, reference_number,
         status, group_size, attendee_info, hold_expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        eventId,
        input.customerId,
        input.ticketTierId || null,
        referenceNumber,
        status,
        groupSize,
        input.attendeeInfo ? JSON.stringify(input.attendeeInfo) : null,
        holdExpiresAt,
      ],
    );

    await client.query('COMMIT');

    await logAudit({
      tenantId: event.tenant_id,
      action: 'event_registration.created',
      resourceType: 'event_registration',
      resourceId: rows[0].id,
      details: { eventId, customerId: input.customerId, status, referenceNumber },
    });

    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Confirm a pending registration (after payment). Increments quantity_sold.
 */
export async function confirmRegistration(id: string) {
  const { rows } = await adminPool.query(
    `UPDATE event_registrations
     SET status = 'confirmed', hold_expires_at = NULL
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id],
  );
  if (!rows[0]) throw new Error('Registration not found or not in pending status');
  return rows[0];
}

/**
 * Cancel a registration.
 */
export async function cancelRegistration(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE event_registrations er
     SET status = 'cancelled'
     FROM events e
     WHERE er.id = $1 AND er.event_id = e.id AND e.tenant_id = $2
       AND er.status IN ('confirmed','pending')
     RETURNING er.*`,
    [id, tenantId],
  );
  if (!rows[0]) throw new Error('Registration not found or cannot be cancelled');

  await logAudit({
    tenantId,
    action: 'event_registration.cancelled',
    resourceType: 'event_registration',
    resourceId: id,
  });

  return rows[0];
}

/**
 * Transfer a registration to a new customer.
 */
export async function transferRegistration(id: string, newCustomerId: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE event_registrations er
     SET customer_id = $2
     FROM events e
     WHERE er.id = $1 AND er.event_id = e.id AND e.tenant_id = $3
       AND er.status = 'confirmed'
     RETURNING er.*`,
    [id, newCustomerId, tenantId],
  );
  if (!rows[0]) throw new Error('Registration not found or not confirmed');

  await logAudit({
    tenantId,
    action: 'event_registration.transferred',
    resourceType: 'event_registration',
    resourceId: id,
    details: { newCustomerId },
  });

  return rows[0];
}

/**
 * Get registrations for an event with optional filters.
 */
export async function getRegistrations(eventId: string, filters: RegistrationFilters = {}) {
  const conditions = ['er.event_id = $1'];
  const params: any[] = [eventId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`er.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.customerId) {
    conditions.push(`er.customer_id = $${idx++}`);
    params.push(filters.customerId);
  }

  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 50, 200);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const { rows } = await adminPool.query(
    `SELECT er.*,
            c.first_name, c.last_name, c.email,
            tt.name AS tier_name, tt.price AS tier_price
     FROM event_registrations er
     LEFT JOIN customers c ON c.id = er.customer_id
     LEFT JOIN event_ticket_tiers tt ON tt.id = er.ticket_tier_id
     WHERE ${where}
     ORDER BY er.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );

  const { rows: countRows } = await adminPool.query(
    `SELECT COUNT(*)::int AS total FROM event_registrations er WHERE ${where}`,
    params,
  );

  return { registrations: rows, total: countRows[0].total, page, limit };
}
