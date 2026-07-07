import { adminPool } from '../db/pool';
import { validateQualificationsForService } from './staff-qualifications.service';

// ============================================================
// Service Assignments
// ============================================================

/**
 * Get service assignments for a staff member.
 */
export async function getServiceAssignments(staffId: string) {
  const { rows } = await adminPool.query(
    `SELECT ssa.*, s.name AS service_name, sv.name AS variant_name
     FROM stf_service_assignments ssa
     JOIN svc_services s ON s.id = ssa.service_id
     LEFT JOIN svc_variants sv ON sv.id = ssa.variant_id
     WHERE ssa.staff_id = $1
     ORDER BY s.name`,
    [staffId],
  );
  return rows;
}

/**
 * Assign services to a staff member (bulk).
 * Validates qualifications for each service.
 */
export async function assignServices(staffId: string, assignments: Array<{
  serviceId: string;
  variantId?: string;
  isPrimary?: boolean;
}>) {
  const results: any[] = [];
  const errors: string[] = [];

  for (const assignment of assignments) {
    // Validate qualifications
    const { valid, missing } = await validateQualificationsForService(staffId, assignment.serviceId);
    if (!valid) {
      errors.push(`Missing qualifications for service: ${missing.join(', ')}`);
      continue;
    }

    const { rows } = await adminPool.query(
      `INSERT INTO stf_service_assignments (staff_id, service_id, variant_id, is_primary)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (staff_id, service_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'))
       DO UPDATE SET is_primary = $4
       RETURNING *`,
      [staffId, assignment.serviceId, assignment.variantId || null, assignment.isPrimary ?? false],
    );
    results.push(rows[0]);
  }

  return { assignments: results, errors };
}

/**
 * Remove a service assignment.
 */
export async function removeServiceAssignment(staffId: string, serviceId: string, variantId?: string) {
  let query = `DELETE FROM stf_service_assignments WHERE staff_id = $1 AND service_id = $2`;
  const params: any[] = [staffId, serviceId];

  if (variantId) {
    query += ` AND variant_id = $3`;
    params.push(variantId);
  } else {
    query += ` AND variant_id IS NULL`;
  }

  const { rowCount } = await adminPool.query(query, params);
  return (rowCount ?? 0) > 0;
}

/**
 * Get staff assigned to a specific service (for booking engine).
 */
export async function getStaffForService(serviceId: string, variantId?: string) {
  let query = `
    SELECT sp.*, ssa.is_primary, ssa.variant_id
    FROM stf_service_assignments ssa
    JOIN stf_profiles sp ON sp.id = ssa.staff_id
    WHERE ssa.service_id = $1 AND sp.status = 'active'
  `;
  const params: any[] = [serviceId];

  if (variantId) {
    query += ` AND (ssa.variant_id = $2 OR ssa.variant_id IS NULL)`;
    params.push(variantId);
  }

  query += ` ORDER BY ssa.is_primary DESC, sp.last_name`;

  const { rows } = await adminPool.query(query, params);
  return rows;
}

// ============================================================
// Location Assignments
// ============================================================

/**
 * Get location assignments for a staff member.
 */
export async function getLocationAssignments(staffId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM stf_location_assignments WHERE staff_id = $1 ORDER BY is_primary DESC`,
    [staffId],
  );
  return rows;
}

/**
 * Assign locations to a staff member.
 */
export async function assignLocations(staffId: string, assignments: Array<{
  locationId: string;
  isPrimary?: boolean;
}>) {
  const results: any[] = [];

  for (const assignment of assignments) {
    const { rows } = await adminPool.query(
      `INSERT INTO stf_location_assignments (staff_id, location_id, is_primary)
       VALUES ($1, $2, $3)
       ON CONFLICT (staff_id, location_id) DO UPDATE SET is_primary = $3
       RETURNING *`,
      [staffId, assignment.locationId, assignment.isPrimary ?? false],
    );
    results.push(rows[0]);
  }

  return results;
}

/**
 * Remove a location assignment.
 */
export async function removeLocationAssignment(staffId: string, locationId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM stf_location_assignments WHERE staff_id = $1 AND location_id = $2`,
    [staffId, locationId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get staff assigned to a specific location.
 */
export async function getStaffForLocation(locationId: string) {
  const { rows } = await adminPool.query(
    `SELECT sp.*
     FROM stf_location_assignments sla
     JOIN stf_profiles sp ON sp.id = sla.staff_id
     WHERE sla.location_id = $1 AND sp.status = 'active'
     ORDER BY sp.last_name`,
    [locationId],
  );
  return rows;
}
