import { adminPool } from '../db/pool';

/**
 * Get paginated community feed with reaction/comment counts.
 */
export async function getFeed(tenantId: string, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const { rows } = await adminPool.query(
    `SELECT p.*,
       (SELECT COUNT(*)::int FROM eng_reactions WHERE post_id = p.id) AS reaction_count,
       (SELECT COUNT(*)::int FROM eng_comments WHERE post_id = p.id AND is_deleted = false) AS comment_count
     FROM eng_posts p
     WHERE p.tenant_id = $1 AND p.is_deleted = false
     ORDER BY p.is_pinned DESC, p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset],
  );
  return rows;
}

/**
 * Create a community post.
 */
export async function createPost(tenantId: string, input: {
  authorId: string;
  authorType: string;
  postType: string;
  content?: string;
  imagePath?: string;
  metadata?: Record<string, any>;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_posts (tenant_id, author_id, author_type, post_type, content, image_path, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      tenantId,
      input.authorId,
      input.authorType,
      input.postType,
      input.content || null,
      input.imagePath || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
  return rows[0];
}

/**
 * React to a post (upsert — one reaction per customer per post).
 */
export async function reactToPost(postId: string, customerId: string, reactionType: string) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_reactions (post_id, customer_id, reaction_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (post_id, customer_id) DO UPDATE SET reaction_type = $3
     RETURNING *`,
    [postId, customerId, reactionType],
  );
  return rows[0];
}

/**
 * Add a comment to a post.
 */
export async function addComment(postId: string, input: {
  authorId: string;
  authorType: string;
  content: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_comments (post_id, author_id, author_type, content)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [postId, input.authorId, input.authorType, input.content],
  );
  return rows[0];
}

/**
 * Soft-delete a post.
 */
export async function deletePost(id: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    `UPDATE eng_posts SET is_deleted = true WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get comments for a post.
 */
export async function getComments(postId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM eng_comments
     WHERE post_id = $1 AND is_deleted = false
     ORDER BY created_at ASC`,
    [postId],
  );
  return rows;
}
