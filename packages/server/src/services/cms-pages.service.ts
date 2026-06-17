import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Get all pages for a site.
 */
export async function getPages(siteId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM site_pages WHERE site_id = $1 ORDER BY display_order, created_at`,
    [siteId],
  );
  return rows;
}

/**
 * Create a new page.
 */
export async function createPage(siteId: string, input: {
  slug: string;
  title: string;
  pageType: string;
  contentBlocks?: any[];
  seoConfig?: Record<string, any>;
  displayOrder?: number;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO site_pages (site_id, slug, title, page_type, content_blocks, seo_config, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      siteId,
      input.slug,
      input.title,
      input.pageType,
      JSON.stringify(input.contentBlocks || []),
      JSON.stringify(input.seoConfig || {}),
      input.displayOrder ?? 0,
    ],
  );
  return rows[0];
}

/**
 * Get a page by ID.
 */
export async function getPageById(id: string, siteId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM site_pages WHERE id = $1 AND site_id = $2`,
    [id, siteId],
  );
  return rows[0] || null;
}

/**
 * Get a page by slug.
 */
export async function getPageBySlug(siteId: string, slug: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM site_pages WHERE site_id = $1 AND slug = $2`,
    [siteId, slug],
  );
  return rows[0] || null;
}

/**
 * Update a page.
 */
export async function updatePage(id: string, siteId: string, updates: Record<string, any>) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.slug !== undefined) { fields.push(`slug = $${idx++}`); values.push(updates.slug); }
  if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
  if (updates.pageType !== undefined) { fields.push(`page_type = $${idx++}`); values.push(updates.pageType); }
  if (updates.isEnabled !== undefined) { fields.push(`is_enabled = $${idx++}`); values.push(updates.isEnabled); }
  if (updates.displayOrder !== undefined) { fields.push(`display_order = $${idx++}`); values.push(updates.displayOrder); }
  if (updates.contentBlocks !== undefined) { fields.push(`content_blocks = $${idx++}`); values.push(JSON.stringify(updates.contentBlocks)); }
  if (updates.seoConfig !== undefined) { fields.push(`seo_config = $${idx++}`); values.push(JSON.stringify(updates.seoConfig)); }
  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, siteId);

  const { rows } = await adminPool.query(
    `UPDATE site_pages SET ${fields.join(', ')} WHERE id = $${idx++} AND site_id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/**
 * Publish a page.
 */
export async function publishPage(id: string, siteId: string) {
  const { rows } = await adminPool.query(
    `UPDATE site_pages SET status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND site_id = $2 RETURNING *`,
    [id, siteId],
  );
  return rows[0] || null;
}

/**
 * Delete a page.
 */
export async function deletePage(id: string, siteId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM site_pages WHERE id = $1 AND site_id = $2`,
    [id, siteId],
  );
  return (rowCount ?? 0) > 0;
}
