import { adminPool } from '../db/pool';
import { logAudit } from './audit.service';

/**
 * Get media files for a tenant with optional filters.
 */
export async function getMedia(tenantId: string, filters?: {
  folder?: string;
  search?: string;
}) {
  const conditions = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (filters?.folder) {
    conditions.push(`folder = $${idx++}`);
    params.push(filters.folder);
  }
  if (filters?.search) {
    conditions.push(`(original_filename ILIKE $${idx} OR alt_text ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const { rows } = await adminPool.query(
    `SELECT * FROM web_media_files WHERE ${where} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

/**
 * Upload (record) a media file.
 */
export async function uploadMedia(tenantId: string, input: {
  filename: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  thumbnailPath?: string;
  mediumPath?: string;
  largePath?: string;
  altText?: string;
  folder?: string;
}) {
  const { rows } = await adminPool.query(
    `INSERT INTO web_media_files (tenant_id, filename, original_filename, mime_type, file_size, file_path, thumbnail_path, medium_path, large_path, alt_text, folder)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      tenantId,
      input.filename,
      input.originalFilename,
      input.mimeType,
      input.fileSize,
      input.filePath,
      input.thumbnailPath || null,
      input.mediumPath || null,
      input.largePath || null,
      input.altText || null,
      input.folder || null,
    ],
  );

  await logAudit({
    tenantId,
    action: 'cms.media.uploaded',
    resourceType: 'media_file',
    resourceId: rows[0].id,
    details: { filename: input.originalFilename, mimeType: input.mimeType },
  });

  return rows[0];
}

/**
 * Delete a media file record.
 */
export async function deleteMedia(id: string, tenantId: string) {
  const { rowCount } = await adminPool.query(
    `DELETE FROM web_media_files WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );

  if ((rowCount ?? 0) > 0) {
    await logAudit({
      tenantId,
      action: 'cms.media.deleted',
      resourceType: 'media_file',
      resourceId: id,
    });
  }

  return (rowCount ?? 0) > 0;
}

/**
 * Update alt text for a media file.
 */
export async function updateMediaAlt(id: string, tenantId: string, altText: string) {
  const { rows } = await adminPool.query(
    `UPDATE web_media_files SET alt_text = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [altText, id, tenantId],
  );
  return rows[0] || null;
}
