import { adminPool } from '../db/pool';

interface CreateVariantInput {
  serviceId: string;
  name: string;
  duration: number;
  price: number;
  pricingModel?: string;
  billingInterval?: string;
  includedSessions?: number | null;
  sessionsRollover?: boolean;
  capacityOverride?: number | null;
  displayOrder?: number;
}

interface UpdateVariantInput {
  name?: string;
  duration?: number;
  price?: number;
  pricingModel?: string;
  billingInterval?: string | null;
  includedSessions?: number | null;
  sessionsRollover?: boolean;
  capacityOverride?: number | null;
  displayOrder?: number;
  status?: string;
}

/**
 * Create a service variant.
 */
export async function createVariant(input: CreateVariantInput) {
  // Validate subscription fields
  if (input.pricingModel === 'subscription' && !input.billingInterval) {
    throw new Error('Subscription variants require a billing interval');
  }

  const { rows } = await adminPool.query(
    `INSERT INTO service_variants (service_id, name, duration, price, pricing_model, billing_interval, included_sessions, sessions_rollover, capacity_override, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.serviceId,
      input.name,
      input.duration,
      input.price,
      input.pricingModel || 'per_session',
      input.pricingModel === 'subscription' ? input.billingInterval : null,
      input.pricingModel === 'subscription' ? (input.includedSessions ?? null) : null,
      input.pricingModel === 'subscription' ? (input.sessionsRollover ?? false) : false,
      input.capacityOverride ?? null,
      input.displayOrder ?? 0,
    ],
  );

  return rows[0];
}

/**
 * List variants for a service.
 */
export async function getVariants(serviceId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM service_variants WHERE service_id = $1 ORDER BY display_order, created_at',
    [serviceId],
  );
  return rows;
}

/**
 * Update a variant.
 */
export async function updateVariant(variantId: string, serviceId: string, updates: UpdateVariantInput) {
  // Verify variant belongs to service
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM service_variants WHERE id = $1 AND service_id = $2',
    [variantId, serviceId],
  );
  if (existing.length === 0) return null;

  const current = existing[0];

  // Validate subscription consistency
  const pricingModel = updates.pricingModel ?? current.pricing_model;
  if (pricingModel === 'subscription') {
    const billingInterval = updates.billingInterval !== undefined ? updates.billingInterval : current.billing_interval;
    if (!billingInterval) {
      throw new Error('Subscription variants require a billing interval');
    }
  }

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.duration !== undefined) { fields.push(`duration = $${idx++}`); values.push(updates.duration); }
  if (updates.price !== undefined) { fields.push(`price = $${idx++}`); values.push(updates.price); }
  if (updates.pricingModel !== undefined) { fields.push(`pricing_model = $${idx++}`); values.push(updates.pricingModel); }
  if (updates.billingInterval !== undefined) { fields.push(`billing_interval = $${idx++}`); values.push(updates.billingInterval); }
  if (updates.includedSessions !== undefined) { fields.push(`included_sessions = $${idx++}`); values.push(updates.includedSessions); }
  if (updates.sessionsRollover !== undefined) { fields.push(`sessions_rollover = $${idx++}`); values.push(updates.sessionsRollover); }
  if (updates.capacityOverride !== undefined) { fields.push(`capacity_override = $${idx++}`); values.push(updates.capacityOverride); }
  if (updates.displayOrder !== undefined) { fields.push(`display_order = $${idx++}`); values.push(updates.displayOrder); }
  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }

  if (fields.length === 0) return current;

  fields.push('updated_at = NOW()');
  values.push(variantId);
  values.push(serviceId);

  const { rows } = await adminPool.query(
    `UPDATE service_variants SET ${fields.join(', ')} WHERE id = $${idx++} AND service_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0];
}

/**
 * Delete a variant. Prevents deleting the last active variant of an active service.
 */
export async function deleteVariant(variantId: string, serviceId: string): Promise<{ deleted: boolean; error?: string }> {
  // Check if this is the last active variant of an active service
  const { rows: serviceRows } = await adminPool.query(
    'SELECT status FROM services WHERE id = $1',
    [serviceId],
  );

  if (serviceRows.length > 0 && serviceRows[0].status === 'active') {
    const { rows: activeVariants } = await adminPool.query(
      "SELECT id FROM service_variants WHERE service_id = $1 AND status = 'active'",
      [serviceId],
    );

    // Check if the variant we're deleting is active and the last one
    const { rows: targetVariant } = await adminPool.query(
      'SELECT status FROM service_variants WHERE id = $1',
      [variantId],
    );

    if (targetVariant.length > 0 && targetVariant[0].status === 'active' && activeVariants.length <= 1) {
      return { deleted: false, error: 'Cannot delete the last active variant of an active service' };
    }
  }

  const { rowCount } = await adminPool.query(
    'DELETE FROM service_variants WHERE id = $1 AND service_id = $2',
    [variantId, serviceId],
  );

  return { deleted: (rowCount ?? 0) > 0 };
}
