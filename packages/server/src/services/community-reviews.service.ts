import { adminPool } from '../db/pool';

/**
 * Submit a review.
 */
export async function submitReview(tenantId: string, input: {
  customerId: string;
  bookingId?: string;
  serviceId?: string;
  staffId?: string;
  rating: number;
  content?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_reviews (tenant_id, customer_id, booking_id, service_id, staff_id, rating, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      tenantId,
      input.customerId,
      input.bookingId || null,
      input.serviceId || null,
      input.staffId || null,
      input.rating,
      input.content || null,
    ],
  );
  return rows[0];
}

/**
 * Get reviews for a service, optionally filtered by status.
 */
export async function getServiceReviews(serviceId: string, status?: string) {
  let query = `SELECT * FROM eng_reviews WHERE service_id = $1`;
  const params: any[] = [serviceId];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC`;
  const { rows } = await adminPool.query(query, params);
  return rows;
}

/**
 * Moderate a review (approve or reject).
 */
export async function moderateReview(id: string, tenantId: string, status: string) {
  const { rows } = await adminPool.query(
    `UPDATE eng_reviews SET status = $3 WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, status],
  );
  return rows[0] || null;
}

/**
 * Respond to a review as the business.
 */
export async function respondToReview(id: string, tenantId: string, response: string) {
  const { rows } = await adminPool.query(
    `UPDATE eng_reviews SET business_response = $3, responded_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, response],
  );
  return rows[0] || null;
}

/**
 * Get the average rating for a service.
 */
export async function getAverageRating(serviceId: string) {
  const { rows } = await adminPool.query(
    `SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS average_rating, COUNT(*)::int AS review_count
     FROM eng_reviews
     WHERE service_id = $1 AND status = 'published'`,
    [serviceId],
  );
  return rows[0];
}
