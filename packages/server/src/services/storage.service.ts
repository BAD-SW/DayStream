import fs from 'fs';
import path from 'path';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand,
  ListObjectsV2Command, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { logger } from '../middleware/logger';
import { adminPool } from '../db/pool';
import { decrypt } from '../utils/encryption';

export interface StoredFile {
  filePath: string;        // relative path within storage root
  filename: string;
}

/**
 * Where files live (spec 51, gap 1 — design §1.1). The location is chosen on Configuration >
 * Storage (sys_system_configurations, category 'storage'): the local file system or an AWS S3
 * bucket. Both are complete, so features can be tested locally before deploying to AWS. The
 * choice is read with a short cache and the cache is cleared when the page is saved, so a change
 * takes effect without a restart. STORAGE_BACKEND / STORAGE_LOCAL_PATH / S3_* environment
 * variables are only a fallback when nothing is configured.
 *
 * Paths are relative ("tenants/{t}/businesses/{b}/private/…", see utils/storage-paths.ts). Any
 * path with a `private` segment is never served publicly (app.ts /storage route).
 */
interface StorageBackend {
  save(relativePath: string, data: Buffer): Promise<void>;
  read(relativePath: string): Promise<Buffer | null>;
  /** Delete a file, then (local) every parent folder it leaves empty. */
  delete(relativePath: string): Promise<void>;
  /** Delete a folder and everything in it, including the folder itself. */
  deleteDirectory(relativePath: string): Promise<void>;
  getUrl(relativePath: string): string;
  exists(relativePath: string): Promise<boolean>;
  /** Every file under a folder, as relative paths with forward slashes. Empty when there's none. */
  listFiles(relativeFolder: string): Promise<string[]>;
}

export interface StorageConfig {
  storage_type?: 'local' | 'aws_s3';
  local_path?: string;
  s3_bucket?: string;
  s3_region?: string;
  s3_access_key?: string;
  /** Encrypted with utils/encryption (AES-256-GCM). Never returned to the browser. */
  s3_secret_key_encrypted?: string;
  /** Legacy plain-text secret saved before encryption was added; read only, replaced on next save. */
  s3_secret_key?: string;
}

// ============================================================
// Configuration (cached)
// ============================================================

const CACHE_TTL = 60000; // 1 minute
let cachedConfig: StorageConfig | null = null;
let cacheTime = 0;
let cachedBackend: { key: string; backend: StorageBackend } | null = null;

async function loadConfig(): Promise<StorageConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL) return cachedConfig;
  let config: StorageConfig = {};
  try {
    const { rows } = await adminPool.query("SELECT config_data FROM sys_system_configurations WHERE category = 'storage'");
    config = (rows[0]?.config_data as StorageConfig) || {};
  } catch {
    logger.warn('Failed to read storage config from database, using environment fallback');
  }
  cachedConfig = config;
  cacheTime = now;
  return config;
}

/** Forget the cached configuration and backend, so the next call uses the saved settings. */
export function invalidateStorageConfig(): void {
  cachedConfig = null;
  cacheTime = 0;
  cachedBackend = null;
}

/** The S3 secret from a stored config: decrypted, or the legacy plain value. */
function secretOf(config: StorageConfig): string {
  if (config.s3_secret_key_encrypted) {
    try { return decrypt(config.s3_secret_key_encrypted); } catch { logger.warn('The stored S3 secret key could not be decrypted'); return ''; }
  }
  return config.s3_secret_key || '';
}

/** Build the backend a configuration describes (falling back to the environment). */
export function backendFor(config: StorageConfig, secret?: string): StorageBackend {
  const type = config.storage_type || (process.env.STORAGE_BACKEND === 's3' ? 'aws_s3' : 'local');
  if (type === 'aws_s3') {
    return new S3Storage({
      bucket: config.s3_bucket || process.env.S3_BUCKET || '',
      region: config.s3_region || process.env.S3_REGION || 'us-east-1',
      accessKeyId: config.s3_access_key || '',
      secretAccessKey: secret ?? secretOf(config),
      endpoint: process.env.S3_ENDPOINT || undefined,
    });
  }
  return new LocalStorage(config.local_path || process.env.STORAGE_LOCAL_PATH || path.join(process.cwd(), 'storage'));
}

async function currentBackend(): Promise<StorageBackend> {
  const config = await loadConfig();
  const key = JSON.stringify(config);
  if (cachedBackend && cachedBackend.key === key) return cachedBackend.backend;
  const backend = backendFor(config);
  cachedBackend = { key, backend };
  return backend;
}

// ============================================================
// Local file system
// ============================================================

/** Folders a local delete never removes even when empty: the storage root's structure anchors. */
const KEEP_FOLDERS = new Set(['private', 'public']);

class LocalStorage implements StorageBackend {
  constructor(private root: string) {}

  /** Resolve a relative path inside the root, refusing anything that escapes it. */
  private full(relativePath: string): string {
    const root = path.resolve(this.root);
    const full = path.resolve(root, relativePath);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Path is outside the storage root');
    return full;
  }

  async save(relativePath: string, data: Buffer): Promise<void> {
    const fullPath = this.full(relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, data);
  }

  async read(relativePath: string): Promise<Buffer | null> {
    let fullPath: string;
    try { fullPath = this.full(relativePath); } catch { return null; }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    return fs.readFileSync(fullPath);
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = this.full(relativePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    this.pruneEmptyParents(path.dirname(fullPath));
  }

  async deleteDirectory(relativePath: string): Promise<void> {
    const fullPath = this.full(relativePath);
    if (fullPath === path.resolve(this.root)) throw new Error('Refusing to delete the storage root');
    if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { recursive: true, force: true });
    this.pruneEmptyParents(path.dirname(fullPath));
  }

  /**
   * Remove each folder left empty, walking up until a folder that isn't empty, a `private` /
   * `public` anchor, or the storage root. So deleting one file never leaves empty folders behind.
   */
  private pruneEmptyParents(dir: string): void {
    const root = path.resolve(this.root);
    let current = path.resolve(dir);
    while (current !== root && current.startsWith(root + path.sep)) {
      if (KEEP_FOLDERS.has(path.basename(current))) return;
      try {
        if (fs.readdirSync(current).length > 0) return;
        fs.rmdirSync(current);
      } catch {
        return; // already gone, or not removable: stop quietly
      }
      current = path.dirname(current);
    }
  }

  getUrl(relativePath: string): string {
    return `/storage/${relativePath}`;
  }

  async exists(relativePath: string): Promise<boolean> {
    try { return fs.existsSync(this.full(relativePath)); } catch { return false; }
  }

  async listFiles(relativeFolder: string): Promise<string[]> {
    const start = this.full(relativeFolder);
    if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) return [];
    const root = path.resolve(this.root);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    };
    walk(start);
    return out;
  }
}

// ============================================================
// AWS S3
// ============================================================

interface S3Settings {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

/**
 * A private S3 bucket. With an access key and secret configured they are used; with both blank the
 * SDK's default credential chain applies, so on AWS an IAM role replaces stored keys. Folders are
 * key prefixes and vanish with their last object, so there is nothing to tidy.
 */
class S3Storage implements StorageBackend {
  private client: S3Client;
  private bucket: string;

  constructor(s: S3Settings) {
    if (!s.bucket) throw new Error('S3 storage is selected but no bucket is configured');
    this.bucket = s.bucket;
    this.client = new S3Client({
      region: s.region,
      ...(s.endpoint ? { endpoint: s.endpoint, forcePathStyle: true } : {}),
      ...(s.accessKeyId && s.secretAccessKey
        ? { credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey } }
        : {}),
    });
  }

  private key(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  async save(relativePath: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath), Body: data }));
  }

  async read(relativePath: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) }));
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async delete(relativePath: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) }));
  }

  async deleteDirectory(relativePath: string): Promise<void> {
    const prefix = this.key(relativePath).replace(/\/?$/, '/');
    if (prefix === '/') throw new Error('Refusing to delete the whole bucket');
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents || []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  getUrl(relativePath: string): string {
    // Public files are streamed through the server's /storage route for both backends.
    return `/storage/${this.key(relativePath)}`;
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) }));
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(relativeFolder: string): Promise<string[]> {
    const prefix = this.key(relativeFolder).replace(/\/?$/, '/');
    const out: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix === '/' ? '' : prefix, ContinuationToken: token }));
      for (const o of page.Contents || []) if (o.Key && !o.Key.endsWith('/')) out.push(o.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}

// ============================================================
// Connection test
// ============================================================

/**
 * Prove a storage location works: write a small object, read it back, compare, delete it. Reports
 * the step that failed. Used by Configuration > Storage > Test Connection with the form's values
 * (before they are saved); `secret` is the plain secret from the form, or the stored one.
 */
export async function testStorage(config: StorageConfig, secret?: string): Promise<{ ok: boolean; message: string }> {
  let backend: StorageBackend;
  try {
    backend = backendFor(config, secret);
  } catch (err: any) {
    return { ok: false, message: err?.message || 'The storage settings are incomplete' };
  }
  const where = config.storage_type === 'aws_s3' ? `bucket "${config.s3_bucket}"` : `folder "${config.local_path}"`;
  const testPath = `_connection-test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const payload = Buffer.from(`DayStream storage test ${new Date().toISOString()}`);
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { return await fn(); } catch (err: any) { throw new Error(`${name} failed: ${err?.message || err}`); }
  };
  try {
    await step('Writing a test file', () => backend.save(testPath, payload));
    const back = await step('Reading it back', () => backend.read(testPath)) as Buffer | null;
    if (!back || !back.equals(payload)) throw new Error('Reading it back failed: the file came back different');
    await step('Deleting it', () => backend.deleteDirectory('_connection-test'));
    return { ok: true, message: `Storage works: a test file was written to, read from and deleted from ${where}.` };
  } catch (err: any) {
    return { ok: false, message: `${err.message} (${where})` };
  }
}

// ============================================================
// Storage service
// ============================================================

export const storage = {
  save: async (relativePath: string, data: Buffer) => (await currentBackend()).save(relativePath, data),
  read: async (relativePath: string) => (await currentBackend()).read(relativePath),
  delete: async (relativePath: string) => (await currentBackend()).delete(relativePath),
  deleteDirectory: async (relativePath: string) => (await currentBackend()).deleteDirectory(relativePath),
  exists: async (relativePath: string) => (await currentBackend()).exists(relativePath),
  listFiles: async (relativeFolder: string) => (await currentBackend()).listFiles(relativeFolder),
  /** A public file's URL. Same shape for both backends: the /storage route streams it. */
  getUrl: (relativePath: string) => `/storage/${relativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`,
};
