import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Generate a URL-safe slug from a title.
 */
function generateSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
}

/**
 * Get blog posts with optional filters and pagination.
 */
export async function getPosts(siteId: string, filters?: {
  status?: string;
  category?: string;
  page?: number;
  limit?: number;
}) {
  const conditions = ['site_id = $1'];
  const params: any[] = [siteId];
  let idx = 2;

  if (filters?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters?.category) {
    conditions.push(`category = $${idx++}`);
    params.push(filters.category);
  }

  const page = filters?.page || 1;
  const limit = Math.min(filters?.limit || 20, 100);
  const offset = (page - 1) * limit;

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    adminPool.query(
      `SELECT * FROM web_blog_posts WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    adminPool.query(
      `SELECT COUNT(*)::int AS total FROM web_blog_posts WHERE ${where}`,
      params,
    ),
  ]);

  return {
    posts: dataResult.rows,
    total: countResult.rows[0].total,
    page,
    limit,
  };
}

/**
 * Create a new blog post. Slug is auto-generated from title.
 */
export async function createPost(siteId: string, input: {
  title: string;
  content?: string;
  excerpt?: string;
  featuredImagePath?: string;
  authorName?: string;
  tags?: string[];
  category?: string;
}) {
  const slug = generateSlug(input.title);

  const { rows } = await adminPool.query(
    `INSERT INTO web_blog_posts (site_id, title, slug, content, excerpt, featured_image_path, author_name, tags, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      siteId,
      input.title,
      slug,
      input.content || null,
      input.excerpt || null,
      input.featuredImagePath || null,
      input.authorName || null,
      input.tags || [],
      input.category || null,
    ],
  );
  return rows[0];
}

/**
 * Get a blog post by ID.
 */
export async function getPostById(id: string, siteId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM web_blog_posts WHERE id = $1 AND site_id = $2`,
    [id, siteId],
  );
  return rows[0] || null;
}

/**
 * Get a blog post by slug.
 */
export async function getPostBySlug(siteId: string, slug: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM web_blog_posts WHERE site_id = $1 AND slug = $2`,
    [siteId, slug],
  );
  return rows[0] || null;
}

/**
 * Update a blog post.
 */
export async function updatePost(id: string, siteId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
  if (updates.content !== undefined) { fields.push(`content = $${idx++}`); values.push(updates.content); }
  if (updates.excerpt !== undefined) { fields.push(`excerpt = $${idx++}`); values.push(updates.excerpt); }
  if (updates.featuredImagePath !== undefined) { fields.push(`featured_image_path = $${idx++}`); values.push(updates.featuredImagePath); }
  if (updates.authorName !== undefined) { fields.push(`author_name = $${idx++}`); values.push(updates.authorName); }
  if (updates.tags !== undefined) { fields.push(`tags = $${idx++}`); values.push(updates.tags); }
  if (updates.category !== undefined) { fields.push(`category = $${idx++}`); values.push(updates.category); }
  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
  if (updates.scheduledAt !== undefined) { fields.push(`scheduled_at = $${idx++}`); values.push(updates.scheduledAt); }
  if (updates.seoConfig !== undefined) { fields.push(`seo_config = $${idx++}`); values.push(JSON.stringify(updates.seoConfig)); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, siteId);

  const { rows } = await adminPool.query(
    `UPDATE web_blog_posts SET ${fields.join(', ')} WHERE id = $${idx++} AND site_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Publish a blog post.
 */
export async function publishPost(id: string, siteId: string) {
  const { rows } = await adminPool.query(
    `UPDATE web_blog_posts SET status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND site_id = $2 RETURNING *`,
    [id, siteId],
  );
  return rows[0] || null;
}

/**
 * Delete a blog post.
 */
export async function deletePost(id: string, siteId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM web_blog_posts WHERE id = $1 AND site_id = $2`,
    [id, siteId],
  );
  return (rowCount ?? 0) > 0;
}
