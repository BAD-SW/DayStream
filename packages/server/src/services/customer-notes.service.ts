import { adminPool } from '../db/pool';
import { encrypt, decrypt } from '../utils/encryption';
import { logAudit } from './audit.service';

interface CreateNoteInput {
  customerId: string;
  businessId: string;
  tenantId: string;
  category: string;
  content: string;
  isSensitive: boolean;
  createdBy: string;
}

export async function createNote(input: CreateNoteInput) {
  // Validate category exists for business
  const { rows: catRows } = await adminPool.query(
    'SELECT id, is_sensitive FROM cus_note_categories WHERE business_id = $1 AND name = $2',
    [input.businessId, input.category],
  );

  if (catRows.length === 0) {
    throw new Error(`Note category "${input.category}" does not exist for this business`);
  }

  const isSensitive = input.isSensitive || catRows[0].is_sensitive;

  // Encrypt content
  const contentEncrypted = encrypt(input.content);

  const { rows } = await adminPool.query(
    `INSERT INTO cus_notes (customer_id, business_id, category, content_encrypted, is_sensitive, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, customer_id, business_id, category, is_sensitive, created_by, created_at`,
    [input.customerId, input.businessId, input.category, contentEncrypted, isSensitive, input.createdBy],
  );

  // Log in activity timeline
  await adminPool.query(
    `INSERT INTO cus_activities (customer_id, business_id, activity_type, description, metadata, created_by)
     VALUES ($1, $2, 'note', $3, $4, $5)`,
    [input.customerId, input.businessId, `Note added: ${input.category}`, JSON.stringify({ category: input.category, isSensitive }), input.createdBy],
  );

  return { ...rows[0], content: input.content };
}

export async function getNotes(
  customerId: string,
  businessId: string,
  tenantId: string,
  userId: string,
  userRole: string,
) {
  const { rows } = await adminPool.query(
    `SELECT cn.id, cn.customer_id, cn.category, cn.content_encrypted, cn.is_sensitive, cn.created_by, cn.created_at,
            nc.customer_visible
     FROM cus_notes cn
     LEFT JOIN cus_note_categories nc ON nc.business_id = cn.business_id AND nc.name = cn.category
     WHERE cn.customer_id = $1 AND cn.business_id = $2
     ORDER BY cn.created_at DESC`,
    [customerId, businessId],
  );

  // Decrypt and filter based on role
  const notes = [];
  for (const row of rows) {
    // If sensitive, only certain roles can see it
    if (row.is_sensitive) {
      const allowedRoles = ['business_owner', 'business_manager', 'system_admin'];
      if (!allowedRoles.includes(userRole)) {
        continue; // skip sensitive notes for unauthorized roles
      }

      // Audit access to sensitive notes
      await logAudit({
        tenantId,
        userId,
        action: 'note.sensitive_accessed',
        resourceType: 'customer_note',
        resourceId: row.id,
        details: { customerId, category: row.category },
      });
    }

    notes.push({
      id: row.id,
      customer_id: row.customer_id,
      category: row.category,
      content: decrypt(row.content_encrypted),
      is_sensitive: row.is_sensitive,
      customer_visible: row.customer_visible,
      created_by: row.created_by,
      created_at: row.created_at,
    });
  }

  return notes;
}

// --- Note Categories ---

export async function getCategories(businessId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM cus_note_categories WHERE business_id = $1 ORDER BY display_order, name',
    [businessId],
  );
  return rows;
}

export async function createCategory(businessId: string, name: string, isSensitive: boolean, customerVisible: boolean) {
  const { rows } = await adminPool.query(
    `INSERT INTO cus_note_categories (business_id, name, is_sensitive, customer_visible)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [businessId, name, isSensitive, customerVisible],
  );
  return rows[0];
}
