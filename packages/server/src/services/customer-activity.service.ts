import { adminPool } from '../db/pool';

interface CreateActivityInput {
  customerId: string;
  businessId: string;
  activityType: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

/**
 * Create an activity timeline entry for a customer.
 * Called by various modules (bookings, payments, memberships, etc.)
 */
export async function createActivity(input: CreateActivityInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO customer_activities (customer_id, business_id, activity_type, description, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.customerId, input.businessId, input.activityType, input.description, input.metadata ? JSON.stringify(input.metadata) : null, input.createdBy || null],
  );
  return rows[0];
}

interface GetActivitiesOptions {
  customerId: string;
  businessId: string;
  activityType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

/**
 * Get paginated activity timeline for a customer, most recent first.
 */
export async function getActivities(options: GetActivitiesOptions) {
  const conditions = ['customer_id = $1', 'business_id = $2'];
  const params: any[] = [options.customerId, options.businessId];
  let paramIndex = 3;

  if (options.activityType) {
    conditions.push(`activity_type = $${paramIndex++}`);
    params.push(options.activityType);
  }

  if (options.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(options.startDate);
  }

  if (options.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(options.endDate);
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(options.limit || 20, 100);
  const page = options.page || 1;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM customer_activities WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    adminPool.query(`SELECT COUNT(*) AS total FROM customer_activities WHERE ${where}`, params),
  ]);

  return {
    activities: dataResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}
