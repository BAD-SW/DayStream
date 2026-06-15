import { adminPool } from '../db/pool';

interface AssignStaffInput {
  serviceId: string;
  userId: string;
  variantId?: string | null;
  isPrimary?: boolean;
}

/**
 * Assign a staff member to a service (optionally scoped to a specific variant).
 */
export async function assignStaff(input: AssignStaffInput) {
  // Check if assignment already exists
  const checkQuery = input.variantId
    ? 'SELECT id FROM service_staff WHERE service_id = $1 AND user_id = $2 AND variant_id = $3'
    : 'SELECT id FROM service_staff WHERE service_id = $1 AND user_id = $2 AND variant_id IS NULL';
  const checkParams = input.variantId
    ? [input.serviceId, input.userId, input.variantId]
    : [input.serviceId, input.userId];

  const { rows: existing } = await adminPool.query(checkQuery, checkParams);
  if (existing.length > 0) {
    throw new Error('Staff member is already assigned to this service');
  }

  // If marking as primary, unset current primary for this service
  if (input.isPrimary) {
    await adminPool.query(
      'UPDATE service_staff SET is_primary = false WHERE service_id = $1',
      [input.serviceId],
    );
  }

  const { rows } = await adminPool.query(
    `INSERT INTO service_staff (service_id, user_id, variant_id, is_primary)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.serviceId, input.userId, input.variantId || null, input.isPrimary ?? false],
  );

  return rows[0];
}

/**
 * List staff assigned to a service (with user details).
 */
export async function getStaff(serviceId: string) {
  const { rows } = await adminPool.query(
    `SELECT ss.*, u.first_name, u.last_name, u.email
     FROM service_staff ss
     JOIN users u ON u.id = ss.user_id
     WHERE ss.service_id = $1
     ORDER BY ss.is_primary DESC, u.last_name, u.first_name`,
    [serviceId],
  );
  return rows;
}

/**
 * Remove a staff assignment.
 */
export async function removeStaff(serviceId: string, userId: string, variantId?: string | null): Promise<boolean> {
  let query: string;
  let params: any[];

  if (variantId) {
    query = 'DELETE FROM service_staff WHERE service_id = $1 AND user_id = $2 AND variant_id = $3';
    params = [serviceId, userId, variantId];
  } else {
    query = 'DELETE FROM service_staff WHERE service_id = $1 AND user_id = $2 AND variant_id IS NULL';
    params = [serviceId, userId];
  }

  const { rowCount } = await adminPool.query(query, params);
  return (rowCount ?? 0) > 0;
}

/**
 * Update primary designation for a staff member.
 */
export async function setPrimary(serviceId: string, userId: string): Promise<boolean> {
  // Unset current primary
  await adminPool.query(
    'UPDATE service_staff SET is_primary = false WHERE service_id = $1',
    [serviceId],
  );

  // Set new primary
  const { rowCount } = await adminPool.query(
    'UPDATE service_staff SET is_primary = true WHERE service_id = $1 AND user_id = $2',
    [serviceId, userId],
  );

  return (rowCount ?? 0) > 0;
}
