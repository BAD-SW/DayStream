import crypto from 'crypto';
import sharp from 'sharp';
import { adminPool } from '../db/pool';
import { storage } from './storage.service';
import { logger } from '../middleware/logger';

const MAX_IMAGES_PER_SERVICE = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

interface ImageSizes {
  large: { width: number };
  medium: { width: number };
  thumbnail: { width: number };
}

const SIZES: ImageSizes = {
  large: { width: 1200 },
  medium: { width: 600 },
  thumbnail: { width: 200 },
};

/**
 * Build the storage path for a service image.
 */
function buildBasePath(tenantId: string, businessId: string, serviceId: string): string {
  return `services/${businessId}/${serviceId}`;
}

/**
 * Validate an uploaded image file.
 */
export function validateImage(file: { buffer: Buffer; mimetype: string; size: number }): { valid: boolean; error?: string } {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return { valid: false, error: `Invalid format. Accepted: JPEG, PNG, WebP` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum: 5MB` };
  }
  return { valid: true };
}

/**
 * Upload an image for a service. Generates responsive sizes and stores metadata.
 */
export async function uploadImage(
  serviceId: string,
  businessId: string,
  tenantId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  altText?: string,
): Promise<any> {
  // Check image count
  const { rows: countRows } = await adminPool.query(
    'SELECT COUNT(*)::int AS count FROM svc_images WHERE service_id = $1',
    [serviceId],
  );
  if (countRows[0].count >= MAX_IMAGES_PER_SERVICE) {
    throw new Error(`Maximum ${MAX_IMAGES_PER_SERVICE} images per service`);
  }

  // Validate format and size
  const validation = validateImage(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Get dimensions
  const metadata = await sharp(file.buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }
  if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
    throw new Error(`Image too small. Minimum dimensions: ${MIN_WIDTH}x${MIN_HEIGHT}px`);
  }

  // Generate unique filename
  const fileId = crypto.randomUUID();
  const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const basePath = buildBasePath(tenantId, businessId, serviceId);

  // Save original
  const originalPath = `${basePath}/original/${fileId}.${ext}`;
  await storage.save(originalPath, file.buffer);

  // Generate and save responsive sizes
  for (const [sizeName, sizeConfig] of Object.entries(SIZES)) {
    const resized = await sharp(file.buffer)
      .resize(sizeConfig.width, undefined, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await storage.save(`${basePath}/${sizeName}/${fileId}.webp`, resized);
  }

  // Determine if this should be primary (first image = primary)
  const isPrimary = countRows[0].count === 0;

  // Store metadata
  const { rows } = await adminPool.query(
    `INSERT INTO svc_images (service_id, file_path, filename, alt_text, is_primary, display_order, width, height, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      serviceId, originalPath, file.originalname, altText || null,
      isPrimary, countRows[0].count, metadata.width, metadata.height,
      file.size, file.mimetype,
    ],
  );

  const image = rows[0];

  // Add URLs to response
  return {
    ...image,
    urls: {
      original: storage.getUrl(originalPath),
      large: storage.getUrl(`${basePath}/large/${fileId}.webp`),
      medium: storage.getUrl(`${basePath}/medium/${fileId}.webp`),
      thumbnail: storage.getUrl(`${basePath}/thumbnail/${fileId}.webp`),
    },
  };
}

/**
 * List images for a service.
 */
export async function getImages(serviceId: string) {
  const { rows } = await adminPool.query(
    'SELECT * FROM svc_images WHERE service_id = $1 ORDER BY display_order',
    [serviceId],
  );

  return rows.map((img) => ({
    ...img,
    urls: {
      original: storage.getUrl(img.file_path),
      large: storage.getUrl(img.file_path.replace('/original/', '/large/').replace(/\.[^.]+$/, '.webp')),
      medium: storage.getUrl(img.file_path.replace('/original/', '/medium/').replace(/\.[^.]+$/, '.webp')),
      thumbnail: storage.getUrl(img.file_path.replace('/original/', '/thumbnail/').replace(/\.[^.]+$/, '.webp')),
    },
  }));
}

/**
 * Update image metadata (alt text, display order, primary designation).
 */
export async function updateImage(imageId: string, serviceId: string, updates: { alt_text?: string; display_order?: number; is_primary?: boolean }) {
  const { rows: existing } = await adminPool.query(
    'SELECT * FROM svc_images WHERE id = $1 AND service_id = $2',
    [imageId, serviceId],
  );
  if (existing.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.alt_text !== undefined) { fields.push(`alt_text = $${idx++}`); values.push(updates.alt_text); }
  if (updates.display_order !== undefined) { fields.push(`display_order = $${idx++}`); values.push(updates.display_order); }

  // Handle primary toggle
  if (updates.is_primary === true) {
    // Unset current primary
    await adminPool.query(
      'UPDATE svc_images SET is_primary = false WHERE service_id = $1',
      [serviceId],
    );
    fields.push(`is_primary = $${idx++}`);
    values.push(true);
  }

  if (fields.length === 0) return existing[0];

  values.push(imageId);
  values.push(serviceId);

  const { rows } = await adminPool.query(
    `UPDATE svc_images SET ${fields.join(', ')} WHERE id = $${idx++} AND service_id = $${idx}
     RETURNING *`,
    values,
  );

  return rows[0];
}

/**
 * Delete an image (removes files + database record).
 */
export async function deleteImage(imageId: string, serviceId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    'SELECT * FROM svc_images WHERE id = $1 AND service_id = $2',
    [imageId, serviceId],
  );
  if (rows.length === 0) return false;

  const image = rows[0];

  // Delete files from storage
  try {
    await storage.delete(image.file_path);
    // Delete resized versions
    const basePath = image.file_path.replace(/\/original\/.*$/, '');
    const fileId = image.file_path.match(/\/([^/]+)\.[^.]+$/)?.[1];
    if (fileId) {
      for (const sizeName of Object.keys(SIZES)) {
        await storage.delete(`${basePath}/${sizeName}/${fileId}.webp`);
      }
    }
  } catch (err: any) {
    logger.warn('Failed to delete image files', { imageId, error: err.message });
  }

  // Delete database record
  await adminPool.query('DELETE FROM svc_images WHERE id = $1', [imageId]);

  // If deleted image was primary, promote the next one
  if (image.is_primary) {
    await adminPool.query(
      `UPDATE svc_images SET is_primary = true
       WHERE service_id = $1 AND id = (SELECT id FROM svc_images WHERE service_id = $1 ORDER BY display_order LIMIT 1)`,
      [serviceId],
    );
  }

  return true;
}
