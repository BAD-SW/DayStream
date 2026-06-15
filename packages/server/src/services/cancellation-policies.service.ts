import { adminPool } from '../db/pool';

interface CreatePolicyInput {
  businessId: string;
  name: string;
  isDefault?: boolean;
  freeCancellationHours?: number;
  lateCancelFeeType?: string;
  lateCancelFeeValue?: number;
  noshowFeeType?: string;
  noshowFeeValue?: number;
}

interface UpdatePolicyInput {
  name?: string;
  isDefault?: boolean;
  freeCancellationHours?: number;
  lateCancelFeeType?: string;
  lateCancelFeeValue?: number;
  noshowFeeType?: string;
  noshowFeeValue?: number;
}

/**
 * Create a cancellation policy.
 */
export async function createPolicy(input: CreatePolicyInput) {
  // If marking as default, unset current default
  if (input.isDefault) {
    await adminPool.query(
      'UPDATE cancellation_policies SET is_default = false WHERE business_id = $1',
      [input.businessId],
    );
  }

  const { rows } = await adminPool.query(
    `INSERT INTO cancellation_policies (business_id, name, is_default, free_cancellation_hours, late_cancel_fee_type, late_cancel_fee_value, noshow_fee_type, noshow_fee_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.businessId, input.name, input.isDefault ?? false,
      input.freeCancellationHours ?? 24,
      input.lateCancelFeeType || 'percentage', input.lateCancelFeeValue ?? 50,
      input.noshowFeeType || 'percentage', input.noshowFeeValue ?? 100,
    ],
  );

  return rows[0];
}

/**
 * List cancellation policies for a business.
 */
export async function getPolicies(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM cancellation_policies WHERE business_id = $1 ORDER BY is_default DESC, name',
    [businessId],
  );
  return rows;
}

/**
 * Update a cancellation policy.
 */
export async function updatePolicy(id: string, businessId: string, updates: UpdatePolicyInput) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM cancellation_policies WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  if (existing.length === 0) return null;

  // If marking as default, unset current default
  if (updates.isDefault) {
    await adminPool.query(
      'UPDATE cancellation_policies SET is_default = false WHERE business_id = $1',
      [businessId],
    );
  }

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.isDefault !== undefined) { fields.push(`is_default = $${idx++}`); values.push(updates.isDefault); }
  if (updates.freeCancellationHours !== undefined) { fields.push(`free_cancellation_hours = $${idx++}`); values.push(updates.freeCancellationHours); }
  if (updates.lateCancelFeeType !== undefined) { fields.push(`late_cancel_fee_type = $${idx++}`); values.push(updates.lateCancelFeeType); }
  if (updates.lateCancelFeeValue !== undefined) { fields.push(`late_cancel_fee_value = $${idx++}`); values.push(updates.lateCancelFeeValue); }
  if (updates.noshowFeeType !== undefined) { fields.push(`noshow_fee_type = $${idx++}`); values.push(updates.noshowFeeType); }
  if (updates.noshowFeeValue !== undefined) { fields.push(`noshow_fee_value = $${idx++}`); values.push(updates.noshowFeeValue); }

  if (fields.length === 0) return existing[0];

  fields.push('updated_at = NOW()');
  values.push(id);
  values.push(businessId);

  const { rows } = await adminPool.query(
    `UPDATE cancellation_policies SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0];
}

/**
 * Delete a cancellation policy.
 */
export async function deletePolicy(id: string, businessId: string): Promise<boolean> {
  // Unlink services using this policy first
  await adminPool.query(
    'UPDATE services SET cancellation_policy_id = NULL WHERE cancellation_policy_id = $1',
    [id],
  );

  const { rowCount } = await adminPool.query(
    'DELETE FROM cancellation_policies WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Calculate cancellation fee based on policy and timing.
 */
export function calculateCancellationFee(
  policy: { late_cancel_fee_type: string; late_cancel_fee_value: number; noshow_fee_type: string; noshow_fee_value: number; free_cancellation_hours: number },
  bookingPrice: number,
  hoursBeforeStart: number,
  isNoshow = false,
): number {
  if (isNoshow) {
    return policy.noshow_fee_type === 'percentage'
      ? Math.round(bookingPrice * policy.noshow_fee_value / 100)
      : policy.noshow_fee_value;
  }

  if (hoursBeforeStart >= policy.free_cancellation_hours) return 0;

  return policy.late_cancel_fee_type === 'percentage'
    ? Math.round(bookingPrice * policy.late_cancel_fee_value / 100)
    : policy.late_cancel_fee_value;
}
