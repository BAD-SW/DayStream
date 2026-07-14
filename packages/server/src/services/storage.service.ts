import fs from 'fs';
import path from 'path';
import { logger } from '../middleware/logger';
import { adminPool } from '../db/pool';

export interface StoredFile {
  filePath: string;        // relative path within storage root
  filename: string;
}

/**
 * Storage backend interface.
 * Implementations: LocalStorage (development), S3Storage (production).
 */
interface StorageBackend {
  save(relativePath: string, data: Buffer): Promise<void>;
  delete(relativePath: string): Promise<void>;
  deleteDirectory(relativePath: string): Promise<void>;
  getUrl(relativePath: string): string;
  exists(relativePath: string): Promise<boolean>;
}

// Cache the storage path from DB (refreshed periodically)
let cachedStoragePath: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

async function getStorageRoot(): Promise<string> {
  const now = Date.now();
  if (cachedStoragePath && (now - cacheTime) < CACHE_TTL) {
    return cachedStoragePath;
  }

  try {
    const { rows } = await adminPool.query(
      "SELECT config_data FROM sys_system_configurations WHERE category = 'storage'",
    );
    const config = rows[0]?.config_data;
    if (config?.local_path) {
      cachedStoragePath = config.local_path;
      cacheTime = now;
      return cachedStoragePath!;
    }
  } catch (err) {
    logger.warn('Failed to read storage config from database, using fallback');
  }

  // Fallback to env or cwd
  cachedStoragePath = process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'storage');
  cacheTime = now;
  return cachedStoragePath!;
}

// ============================================================
// Local Filesystem Storage
// ============================================================

class LocalStorage implements StorageBackend {
  async save(relativePath: string, data: Buffer): Promise<void> {
    const root = await getStorageRoot();
    const fullPath = path.join(root, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
  }

  async delete(relativePath: string): Promise<void> {
    const root = await getStorageRoot();
    const fullPath = path.join(root, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async deleteDirectory(relativePath: string): Promise<void> {
    const root = await getStorageRoot();
    const fullPath = path.join(root, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  getUrl(relativePath: string): string {
    // In development, serve from /storage/ route
    return `/storage/${relativePath}`;
  }

  async exists(relativePath: string): Promise<boolean> {
    const root = await getStorageRoot();
    const fullPath = path.join(root, relativePath);
    return fs.existsSync(fullPath);
  }
}

// ============================================================
// S3-Compatible Storage (placeholder for production)
// ============================================================

class S3Storage implements StorageBackend {
  private bucket: string;
  private endpoint: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || '';
    this.endpoint = process.env.S3_ENDPOINT || '';
    if (!this.bucket) {
      logger.warn('S3_BUCKET not configured, S3 storage will fail');
    }
  }

  async save(relativePath: string, data: Buffer): Promise<void> {
    // TODO: Implement S3 PutObject when ready for production
    throw new Error('S3 storage not yet implemented');
  }

  async delete(relativePath: string): Promise<void> {
    // TODO: Implement S3 DeleteObject
    throw new Error('S3 storage not yet implemented');
  }

  async deleteDirectory(relativePath: string): Promise<void> {
    // TODO: Implement S3 ListObjects + DeleteObjects for prefix
    throw new Error('S3 storage not yet implemented');
  }

  getUrl(relativePath: string): string {
    return `${this.endpoint}/${this.bucket}/${relativePath}`;
  }

  async exists(relativePath: string): Promise<boolean> {
    // TODO: Implement S3 HeadObject
    return false;
  }
}

// ============================================================
// Storage Service (selects backend from env)
// ============================================================

const BACKEND = process.env.STORAGE_BACKEND || 'local';

let backend: StorageBackend;
if (BACKEND === 's3') {
  backend = new S3Storage();
} else {
  backend = new LocalStorage();
}

export const storage = {
  save: (relativePath: string, data: Buffer) => backend.save(relativePath, data),
  delete: (relativePath: string) => backend.delete(relativePath),
  deleteDirectory: (relativePath: string) => backend.deleteDirectory(relativePath),
  getUrl: (relativePath: string) => backend.getUrl(relativePath),
  exists: (relativePath: string) => backend.exists(relativePath),
};
