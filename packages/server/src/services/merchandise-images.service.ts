import crypto from 'crypto';
import sharp from 'sharp';
import { adminPool } from '../db/pool';
import { storage } from './storage.service';
import { storagePaths, tenantOfBusiness } from '../utils/storage-paths';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const SIZES = {
  medium: { width: 600 },
  thumbnail: { width: 200 },
};

/** The product's image folder (holds original/, medium/, thumbnail/) in the business's public storage. */
async function buildBasePath(businessId: string, merchandiseId: string): Promise<string> {
  return storagePaths.productImageFolder(await tenantOfBusiness(businessId), businessId, merchandiseId);
}

/** Remove a product image's files: the original, every size, and the product folder they were in. */
async function removeImageFiles(imagePath: string): Promise<void> {
  const basePath = imagePath.replace(/\/original\/.*$/, '');
  if (!basePath || basePath === imagePath) { await storage.delete(imagePath); return; }
  await storage.deleteDirectory(basePath);
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
  const basePath = await buildBasePath(businessId, merchandiseId);

  // A product has one image: remove the one it replaces (all sizes) before saving the new one.
  const { rows: prev } = await adminPool.query('SELECT image_url FROM prd_merchandise WHERE id = $1 AND business_id = $2', [merchandiseId, businessId]);
  if (prev[0]?.image_url) await removeImageFiles(prev[0].image_url).catch(() => {});

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

  // Delete files from storage (best effort): the original, its sizes, and the product's folder.
  await removeImageFiles(rows[0].image_url).catch(() => {});

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
