import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';
import { createActivity } from './customer-activity.service';
import { logger } from '../middleware/logger';

interface DuplicateMatch {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  match_type: 'email' | 'phone' | 'name';
  confidence: number;
}

/**
 * Check for potential duplicate customers within a business.
 * Checks email match, phone match, and name similarity.
 */
export async function findDuplicates(
  businessId: string,
  email: string,
  phone?: string,
  firstName?: string,
  lastName?: string,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  // Email match (exact)
  if (email) {
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, phone FROM customers
       WHERE business_id = $1 AND email = $2 AND status != 'anonymized'`,
      [businessId, email],
    );
    for (const row of rows) {
      matches.push({ ...row, match_type: 'email', confidence: 1.0 });
    }
  }

  // Phone match (exact)
  if (phone && phone.trim() !== '') {
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, phone FROM customers
       WHERE business_id = $1 AND phone = $2 AND status != 'anonymized'
       AND id != ALL($3::uuid[])`,
      [businessId, phone, matches.map((m) => m.id)],
    );
    for (const row of rows) {
      matches.push({ ...row, match_type: 'phone', confidence: 0.9 });
    }
  }

  // Name similarity (first + last name match)
  if (firstName && lastName) {
    const { rows } = await adminPool.query(
      `SELECT id, email, first_name, last_name, phone FROM customers
       WHERE business_id = $1
       AND LOWER(first_name) = LOWER($2)
       AND LOWER(last_name) = LOWER($3)
       AND status != 'anonymized'
       AND id != ALL($4::uuid[])`,
      [businessId, firstName, lastName, matches.map((m) => m.id)],
    );
    for (const row of rows) {
      matches.push({ ...row, match_type: 'name', confidence: 0.7 });
    }
  }

  return matches;
}

/**
 * Merge two customer profiles.
 * Reassigns all activities, notes, and tags from secondary to primary,
 * then deletes the secondary customer.
 */
export async function mergeCustomers(
  primaryId: string,
  secondaryId: string,
  businessId: string,
  keepFields: Record<string, 'primary' | 'secondary'>,
  userId: string,
  tenantId: string,
): Promise<{ success: boolean; customer?: any; error?: string }> {
  // Verify both customers exist and belong to the same business
  const { rows: primaryRows } = await adminPool.query(
    'SELECT * FROM customers WHERE id = $1 AND business_id = $2',
    [primaryId, businessId],
  );
  const { rows: secondaryRows } = await adminPool.query(
    'SELECT * FROM customers WHERE id = $1 AND business_id = $2',
    [secondaryId, businessId],
  );

  if (primaryRows.length === 0) return { success: false, error: 'Primary customer not found' };
  if (secondaryRows.length === 0) return { success: false, error: 'Secondary customer not found' };
  if (primaryId === secondaryId) return { success: false, error: 'Cannot merge a customer with itself' };

  const primary = primaryRows[0];
  const secondary = secondaryRows[0];

  // Apply field selections from secondary where specified
  const mergeableFields = ['email', 'first_name', 'last_name', 'phone', 'date_of_birth', 'gender', 'preferred_language', 'country', 'avatar_url'];
  const updates: string[] = [];
  const updateValues: any[] = [];
  let paramIdx = 1;

  for (const field of mergeableFields) {
    if (keepFields[field] === 'secondary' && secondary[field]) {
      updates.push(`${field} = $${paramIdx++}`);
      updateValues.push(secondary[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    updateValues.push(primaryId);
    updateValues.push(businessId);
    await adminPool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${paramIdx++} AND business_id = $${paramIdx}`,
      updateValues,
    );
  }

  // Reassign activities
  await adminPool.query(
    'UPDATE customer_activities SET customer_id = $1 WHERE customer_id = $2',
    [primaryId, secondaryId],
  );

  // Reassign notes
  await adminPool.query(
    'UPDATE customer_notes SET customer_id = $1 WHERE customer_id = $2',
    [primaryId, secondaryId],
  );

  // Reassign tags (skip duplicates)
  await adminPool.query(
    `INSERT INTO customer_tags (customer_id, tag_id, assigned_at, assigned_by)
     SELECT $1, tag_id, assigned_at, assigned_by FROM customer_tags WHERE customer_id = $2
     ON CONFLICT (customer_id, tag_id) DO NOTHING`,
    [primaryId, secondaryId],
  );
  await adminPool.query('DELETE FROM customer_tags WHERE customer_id = $1', [secondaryId]);

  // Reassign custom fields (skip duplicates)
  await adminPool.query(
    `INSERT INTO customer_custom_fields (customer_id, key, value)
     SELECT $1, key, value FROM customer_custom_fields WHERE customer_id = $2
     ON CONFLICT (customer_id, key) DO NOTHING`,
    [primaryId, secondaryId],
  );
  await adminPool.query('DELETE FROM customer_custom_fields WHERE customer_id = $1', [secondaryId]);

  // Delete secondary's preferences
  await adminPool.query('DELETE FROM customer_preferences WHERE customer_id = $1', [secondaryId]);

  // Delete secondary customer
  await adminPool.query('DELETE FROM customers WHERE id = $1 AND business_id = $2', [secondaryId, businessId]);

  // Log in activity timeline
  await createActivity({
    customerId: primaryId,
    businessId,
    activityType: 'profile_change',
    description: `Merged with customer ${secondary.reference_number} (${secondary.email})`,
    metadata: { merged_from: secondaryId, merged_reference: secondary.reference_number },
    createdBy: userId,
  });

  // Audit log
  await logAudit({
    tenantId,
    userId,
    action: 'customer.merged',
    resourceType: 'customer',
    resourceId: primaryId,
    details: { primary_id: primaryId, secondary_id: secondaryId, secondary_email: secondary.email },
  });

  logger.info('Customer merge complete', { primaryId, secondaryId, businessId });

  // Return updated primary
  const { rows: updated } = await adminPool.query(
    'SELECT * FROM customers WHERE id = $1',
    [primaryId],
  );

  return { success: true, customer: updated[0] };
}
