import { adminPool } from '../db/pool';

/**
 * Submit a form (e.g., contact form from the public site).
 */
export async function submitForm(tenantId: string, input: {
  formName: string;
  data: Record<string, any>;
  ipAddress?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO web_form_submissions (tenant_id, form_name, data, ip_address)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [
      tenantId,
      input.formName,
      JSON.stringify(input.data),
      input.ipAddress || null,
    ],
  );
  return rows[0];
}

/**
 * Get form submissions with optional filters and pagination.
 */
export async function getSubmissions(tenantId: string, filters?: {
  formName?: string;
  read?: boolean;
  page?: number;
  limit?: number;
}) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters?.formName) {
    conditions.push(`form_name = $${idx++}`);
    params.push(filters.formName);
  }
  if (filters?.read !== undefined) {
    conditions.push(`read = $${idx++}`);
    params.push(filters.read);
  }

  const page = filters?.page || 1;
  const limit = Math.min(filters?.limit || 20, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM web_form_submissions WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*)::int AS total FROM web_form_submissions WHERE ${where}`,
      params,
    ),
  ]);

  return {
    submissions: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * Mark a form submission as read.
 */
export async function markAsRead(id: string, tenantId: string) {
  const { rows } = await adminPool.query(
    `UPDATE web_form_submissions SET read = true WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId],
  );
  return rows[0] || null;
}
