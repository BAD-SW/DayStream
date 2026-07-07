import { adminPool } from '../db/pool';

/**
 * List qualifications for a staff member.
 */
export async function getQualifications(staffId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM stf_qualifications WHERE staff_id = $1 ORDER BY created_at DESC`,
    [staffId],
  );
  return rows;
}

/**
 * Add a qualification to a staff member.
 */
export async function addQualification(staffId: string, input: {
  name: string;
  issuingBody?: string;
  dateObtained?: string;
  expiryDate?: string;
  certificationNumber?: string;
  documentPath?: string;
  showOnDirectory?: boolean;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO stf_qualifications (
       staff_id, name, issuing_body, date_obtained, expiry_date,
       certification_number, document_path, show_on_directory
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      staffId,
      input.name,
      input.issuingBody || null,
      input.dateObtained || null,
      input.expiryDate || null,
      input.certificationNumber || null,
      input.documentPath || null,
      input.showOnDirectory ?? false,
    ],
  );
  return rows[0];
}

/**
 * Update a qualification.
 */
export async function updateQualification(id: string, staffId: string, updates: Record<string, any>) {
  const allowedFields: Record<string, string> = {
    name: 'name',
    issuing_body: 'issuing_body',
    date_obtained: 'date_obtained',
    expiry_date: 'expiry_date',
    certification_number: 'certification_number',
    document_path: 'document_path',
    show_on_directory: 'show_on_directory',
  };

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields[key] !== undefined) {
      fields.push(`${allowedFields[key]} = $${idx++}`);
      values.push(value);
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  values.push(staffId);

  const { rows } = await adminPool.query(
    `UPDATE stf_qualifications SET ${fields.join(', ')}
     WHERE id = $${idx++} AND staff_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0] || null;
}

/**
 * Delete a qualification.
 */
export async function deleteQualification(id: string, staffId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM stf_qualifications WHERE id = $1 AND staff_id = $2`,
    [id, staffId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get qualifications expiring within N days across the tenant.
 */
export async function getExpiringQualifications(tenantId: string, daysAhead: number = 30) {
  const { rows } = await adminPool.query(
    `SELECT sq.*, sp.first_name, sp.last_name, sp.staff_ref
     FROM stf_qualifications sq
     JOIN stf_profiles sp ON sp.id = sq.staff_id
     WHERE sp.tenant_id = $1
       AND sq.expiry_date IS NOT NULL
       AND sq.expiry_date <= CURRENT_DATE + $2 * INTERVAL '1 day'
       AND sq.expiry_date >= CURRENT_DATE
     ORDER BY sq.expiry_date ASC`,
    [tenantId, daysAhead],
  );
  return rows;
}

/**
 * Check if a staff member has the required qualifications for a service.
 */
export async function validateQualificationsForService(staffId: string, serviceId: string): Promise<{
  valid: boolean;
  missing: string[];
}> {
  // Get required qualifications for the service
  const { rows: requirements } = await adminPool.query(
    `SELECT qualification_name, is_mandatory FROM svc_qualification_requirements WHERE service_id = $1`,
    [serviceId],
  );

  if (requirements.length === 0) return { valid: true, missing: [] };

  // Get staff's current valid qualifications
  const { rows: staffQuals } = await adminPool.query(
    `SELECT name FROM stf_qualifications
     WHERE staff_id = $1
       AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)`,
    [staffId],
  );

  const staffQualNames = new Set(staffQuals.map((q) => q.name.toLowerCase()));

  const missing: string[] = [];
  for (const req of requirements) {
    if (req.is_mandatory && !staffQualNames.has(req.qualification_name.toLowerCase())) {
      missing.push(req.qualification_name);
    }
  }

  return { valid: missing.length === 0, missing };
}

/**
 * CRUD for service qualification requirements.
 */
export async function getServiceQualificationRequirements(serviceId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM svc_qualification_requirements WHERE service_id = $1 ORDER BY qualification_name`,
    [serviceId],
  );
  return rows;
}

export async function addServiceQualificationRequirement(serviceId: string, qualificationName: string, isMandatory: boolean = true) {
  const { rows } = await adminPool.query(
    `INSERT INTO svc_qualification_requirements (service_id, qualification_name, is_mandatory)
     VALUES ($1, $2, $3)
     ON CONFLICT (service_id, qualification_name) DO UPDATE SET is_mandatory = $3
     RETURNING *`,
    [serviceId, qualificationName, isMandatory],
  );
  return rows[0];
}

export async function deleteServiceQualificationRequirement(id: string, serviceId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM svc_qualification_requirements WHERE id = $1 AND service_id = $2`,
    [id, serviceId],
  );
  return (rowCount ?? 0) > 0;
}
