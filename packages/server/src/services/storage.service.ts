import fs from 'fs';
import path from 'path';
import { logger } from '../middleware/logger';

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
  getUrl(relativePath: string): string;
  exists(relativePath: string): Promise<boolean>;
}

// ============================================================
// Local Filesystem Storage
// ============================================================

class LocalStorage implements StorageBackend {
  private root: string;

  constructor() {
    this.root = process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'storage');
    // Ensure root exists
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  async save(relativePath: string, data: Buffer): Promise<void> {
    const fullPath = path.join(this.root, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = path.join(this.root, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  getUrl(relativePath: string): string {
    // In development, serve from /storage/ route
    return `/storage/${relativePath}`;
  }

  async exists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.root, relativePath);
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
  getUrl: (relativePath: string) => backend.getUrl(relativePath),
  exists: (relativePath: string) => backend.exists(relativePath),
};
