import crypto from 'crypto';
import sharp from 'sharp';
import { adminPool } from '../db/pool';
import { storage } from './storage.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const SIZES = {
  medium: { width: 600 },
  thumbnail: { width: 200 },
};

function buildBasePath(businessId: string, merchandiseId: string): string {
  return `products/${businessId}/${merchandiseId}`;
}

/**
 * Upload/replace the image for a merchandise item.
 * Products have a single image (not a gallery).
 */
export async function uploadImage(
  merchandiseId: string,
  businessId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
): Promise<string> {
  // Validate
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    throw new Error('Invalid format. Accepted: JPEG, PNG, WebP');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large. Maximum: 5MB');
  }

  // Generate unique filename
  const fileId = crypto.randomUUID();
  const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const basePath = buildBasePath(businessId, merchandiseId);

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

  // Store the path reference in the merchandise record
  await adminPool.query(
    'UPDATE prd_merchandise SET image_url = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3',
    [originalPath, merchandiseId, businessId],
  );

  return originalPath;
}

/**
 * Delete the image for a merchandise item.
 */
export async function deleteImage(merchandiseId: string, businessId: string): Promise<boolean> {
  const { rows } = await adminPool.query(
    'SELECT image_url FROM prd_merchandise WHERE id = $1 AND business_id = $2',
    [merchandiseId, businessId],
  );
  if (!rows[0]?.image_url) return false;

  const imagePath = rows[0].image_url;

  // Delete files from storage
  try {
    await storage.delete(imagePath);
    // Delete resized versions
    const basePath = imagePath.replace(/\/original\/.*$/, '');
    const fileId = imagePath.match(/\/([^/]+)\.[^.]+$/)?.[1];
    if (fileId) {
      for (const sizeName of Object.keys(SIZES)) {
        await storage.delete(`${basePath}/${sizeName}/${fileId}.webp`);
      }
    }
    // Remove the product folder and subfolders
    await storage.deleteDirectory(basePath);
  } catch { /* best effort */ }

  // Clear the reference
  await adminPool.query(
    'UPDATE prd_merchandise SET image_url = NULL, updated_at = NOW() WHERE id = $1 AND business_id = $2',
    [merchandiseId, businessId],
  );

  return true;
}

/**
 * Get image URLs for a merchandise item.
 */
export function getImageUrls(imageUrl: string | null) {
  if (!imageUrl) return null;
  const basePath = imageUrl.replace(/\/original\/.*$/, '');
  const fileId = imageUrl.match(/\/([^/]+)\.[^.]+$/)?.[1];
  if (!fileId) return { original: storage.getUrl(imageUrl) };
  return {
    original: storage.getUrl(imageUrl),
    medium: storage.getUrl(`${basePath}/medium/${fileId}.webp`),
    thumbnail: storage.getUrl(`${basePath}/thumbnail/${fileId}.webp`),
  };
}
