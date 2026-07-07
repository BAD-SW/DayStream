import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

interface CreateTierInput {
  name: string;
  description?: string;
  price: number; // cents
  quantityAvailable: number;
  availabilityStart?: string;
  availabilityEnd?: string;
  eligibilityType?: string; // 'all' | 'members' | 'vip' | 'custom'
  eligibilityConfig?: Record<string, any>;
  displayOrder?: number;
}

/**
 * Get ticket tiers for an event.
 */
export async function getTiers(eventId: string) {
  const { rows } = await adminPool.query(
    `SELECT tt.*,
            (SELECT COALESCE(SUM(group_size), 0)::int FROM evt_registrations
             WHERE ticket_tier_id = tt.id AND status IN ('confirmed','pending')) AS sold_count
     FROM evt_ticket_tiers tt
     WHERE tt.event_id = $1
     ORDER BY tt.display_order ASC, tt.created_at ASC`,
    [eventId],
  );
  return rows;
}

/**
 * Create a ticket tier for an event.
 */
export async function createTier(eventId: string, input: CreateTierInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO evt_ticket_tiers (
       event_id, name, description, price, quantity_available,
       availability_start, availability_end,
       eligibility_type, eligibility_config, display_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      eventId,
      input.name,
      input.description || null,
      input.price,
      input.quantityAvailable,
      input.availabilityStart || null,
      input.availabilityEnd || null,
      input.eligibilityType || 'all',
      input.eligibilityConfig ? JSON.stringify(input.eligibilityConfig) : null,
      input.displayOrder || 0,
    ],
  );

  return rows[0];
}

/**
 * Update a ticket tier.
 */
export async function updateTier(id: string, eventId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const allowedFields = [
    'name', 'description', 'price', 'quantity_available',
    'availability_start', 'availability_end',
    'eligibility_type', 'eligibility_config', 'display_order',
  ];

  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = $${idx++}`);
      const val = key === 'eligibility_config' ? JSON.stringify(updates[key]) : updates[key];
      values.push(val);
    }
  }

  if (fields.length === 0) return null;
  values.push(id, eventId);

  const { rows } = await adminPool.query(
    `UPDATE evt_ticket_tiers SET ${fields.join(', ')}
     WHERE id = $${idx++} AND event_id = $${idx} RETURNING *`,
    values,
  );

  return rows[0] || null;
}

/**
 * Delete a ticket tier (only if no registrations use it).
 */
export async function deleteTier(id: string, eventId: string) {
  const { rows: used } = await adminPool.query(
    `SELECT id FROM evt_registrations WHERE ticket_tier_id = $1 LIMIT 1`,
    [id],
  );
  if (used.length > 0) throw new Error('Cannot delete tier with existing registrations');

  const { rowCount } = await adminPool.query(
    `DELETE FROM evt_ticket_tiers WHERE id = $1 AND event_id = $2`,
    [id, eventId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Check tier availability: validates time window and remaining quantity.
 */
export async function checkTierAvailability(tierId: string) {
  const { rows } = await adminPool.query(
    `SELECT tt.*,
            (SELECT COALESCE(SUM(group_size), 0)::int FROM evt_registrations
             WHERE ticket_tier_id = tt.id AND status IN ('confirmed','pending')) AS sold_count
     FROM evt_ticket_tiers tt
     WHERE tt.id = $1`,
    [tierId],
  );

  if (rows.length === 0) throw new Error('Ticket tier not found');

  const tier = rows[0];
  const now = new Date();
  const available = tier.quantity_available - tier.sold_count;

  // Check time window
  let withinWindow = true;
  if (tier.availability_start && new Date(tier.availability_start) > now) {
    withinWindow = false;
  }
  if (tier.availability_end && new Date(tier.availability_end) < now) {
    withinWindow = false;
  }

  return {
    tierId,
    available,
    withinWindow,
    isAvailable: available > 0 && withinWindow,
    quantityAvailable: tier.quantity_available,
    soldCount: tier.sold_count,
    availabilityStart: tier.availability_start,
    availabilityEnd: tier.availability_end,
  };
}
