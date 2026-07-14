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

interface GetNotesFilters {
  customerId: string;
  businessId: string;
  tenantId: string;
  userId: string;
  userRole: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export async function getNotes(filters: GetNotesFilters) {
  const conditions = ['cn.customer_id = $1', 'cn.business_id = $2'];
  const params: any[] = [filters.customerId, filters.businessId];
  let idx = 3;

  if (filters.category) {
    conditions.push(`cn.category = $${idx}`);
    params.push(filters.category);
    idx++;
  }
  if (filters.dateFrom) {
    conditions.push(`cn.created_at >= $${idx}::date`);
    params.push(filters.dateFrom);
    idx++;
  }
  if (filters.dateTo) {
    conditions.push(`cn.created_at < ($${idx}::date + interval '1 day')`);
    params.push(filters.dateTo);
    idx++;
  }

  // Exclude sensitive notes for unauthorized roles
  const normalizedRole = filters.userRole.toLowerCase().replace(/\s+/g, '_');
  const allowedSensitiveRoles = ['business_owner', 'business_manager', 'super_admin', 'system_admin'];
  const canSeeSensitive = allowedSensitiveRoles.includes(normalizedRole);
  if (!canSeeSensitive) {
    conditions.push('cn.is_sensitive = false');
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(filters.limit || 10, 50);
  const offset = filters.offset || 0;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT cn.id, cn.customer_id, cn.category, cn.content_encrypted, cn.is_sensitive, cn.created_by, cn.created_at,
              nc.customer_visible
       FROM cus_notes cn
       LEFT JOIN cus_note_categories nc ON nc.business_id = cn.business_id AND nc.name = cn.category
       WHERE ${where}
       ORDER BY cn.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*)::int AS total FROM cus_notes cn WHERE ${where}`, params),
  ]);

  const notes = dataResult.rows.map((row: any) => ({
    id: row.id,
    customer_id: row.customer_id,
    category: row.category,
    content: decrypt(row.content_encrypted),
    is_sensitive: row.is_sensitive,
    customer_visible: row.customer_visible,
    created_by: row.created_by,
    created_at: row.created_at,
  }));

  // Audit sensitive note access
  if (canSeeSensitive) {
    const sensitiveNotes = notes.filter((n: any) => n.is_sensitive);
    for (const note of sensitiveNotes) {
      await logAudit({
        tenantId: filters.tenantId,
        userId: filters.userId,
        action: 'note.sensitive_accessed',
        resourceType: 'customer_note',
        resourceId: note.id,
        details: { customerId: filters.customerId, category: note.category },
      });
    }
  }

  return {
    notes,
    total: countResult.rows[0].total,
    limit,
    offset,
  };
}

export async function deleteNote(noteId: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    'DELETE FROM cus_notes WHERE id = $1 AND business_id = $2',
    [noteId, businessId],
  );
  return (rowCount ?? 0) > 0;
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

export async function deleteCategory(id: string, businessId: string) {
  const { rowCount } = await adminPool.query(
    'DELETE FROM cus_note_categories WHERE id = $1 AND business_id = $2',
    [id, businessId],
  );
  return (rowCount ?? 0) > 0;
}
