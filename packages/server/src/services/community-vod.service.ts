import { adminPool } from '../db/pool';

/**
 * Get VOD library for a tenant with optional filters.
 */
export async function getLibrary(tenantId: string, filters?: { category?: string; difficulty?: string }) {
  let query = `SELECT * FROM eng_vod_content WHERE tenant_id = $1 AND status = 'published'`;
  const params: any[] = [tenantId];

  if (filters?.category) {
    params.push(filters.category);
    query += ` AND category = $${params.length}`;
  }
  if (filters?.difficulty) {
    params.push(filters.difficulty);
    query += ` AND difficulty = $${params.length}`;
  }

  query += ` ORDER BY display_order ASC, created_at DESC`;
  const { rows } = await adminPool.query(query, params);
  return rows;
}

/**
 * Get a single VOD content item.
 */
export async function getContent(id: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM eng_vod_content WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Create a new VOD content item.
 */
export async function createContent(tenantId: string, input: {
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailPath?: string;
  durationSeconds?: number;
  category?: string;
  tags?: string[];
  instructorName?: string;
  difficulty?: string;
  accessLevel?: string;
  planIds?: any[];
  displayOrder?: number;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_vod_content (tenant_id, title, description, video_url, thumbnail_path, duration_seconds, category, tags, instructor_name, difficulty, access_level, plan_ids, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [
      tenantId,
      input.title,
      input.description || null,
      input.videoUrl,
      input.thumbnailPath || null,
      input.durationSeconds || null,
      input.category || null,
      input.tags || [],
      input.instructorName || null,
      input.difficulty || null,
      input.accessLevel || 'members',
      JSON.stringify(input.planIds || []),
      input.displayOrder ?? 0,
    ],
  );
  return rows[0];
}

/**
 * Update watch progress for a customer on a VOD item.
 */
export async function updateProgress(
  customerId: string,
  contentId: string,
  watchedSeconds: number,
  completed?: boolean,
) {
  const { rows } = await adminPool.query(
    `INSERT INTO eng_vod_progress (customer_id, content_id, watched_seconds, completed, last_watched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (customer_id, content_id) DO UPDATE
       SET watched_seconds = GREATEST(eng_vod_progress.watched_seconds, $3),
           completed = COALESCE($4, eng_vod_progress.completed),
           last_watched_at = NOW()
     RETURNING *`,
    [customerId, contentId, watchedSeconds, completed ?? false],
  );
  return rows[0];
}

/**
 * Get a customer's progress on a specific VOD item.
 */
export async function getProgress(customerId: string, contentId: string) {
  const { rows } = await adminPool.query(
    `SELECT * FROM eng_vod_progress WHERE customer_id = $1 AND content_id = $2`,
    [customerId, contentId],
  );
  return rows[0] || null;
}
