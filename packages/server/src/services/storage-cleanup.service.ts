import { adminPool } from '../db/pool';
import { storage } from './storage.service';
import { storagePaths, tenantOfBusiness } from '../utils/storage-paths';
import { logger } from '../middleware/logger';

/**
 * Removing files and folders when the data they belong to goes (spec 51, gap 1).
 *
 * A customer's whole folder (documents, photo, forms, data exports) is deleted when the customer is
 * anonymised or deleted, so no files or empty folders are left behind. If storage can't be reached
 * at that moment, the path is queued in sys_storage_cleanup and a scheduled job retries it, so a
 * temporary outage never leaves files behind.
 */

const MAX_ERROR = 500;

/** Delete a folder now; if that fails, queue it for the retry job. Never throws. */
export async function deleteDirectoryOrQueue(
  folder: string, reason: string, tenantId: string | null,
): Promise<{ removed: boolean }> {
  try {
    await storage.deleteDirectory(folder);
    // A queued attempt for the same folder is now moot.
    await adminPool.query(`DELETE FROM sys_storage_cleanup WHERE path = $1 AND kind = 'directory'`, [folder]).catch(() => undefined);
    return { removed: true };
  } catch (e) {
    const message = ((e as Error).message || 'unknown error').slice(0, MAX_ERROR);
    logger.warn(`Could not delete ${folder} (${reason}); queued for retry: ${message}`);
    await adminPool.query(
      `INSERT INTO sys_storage_cleanup (tenant_id, path, kind, reason, attempts, last_error, last_attempt)
       VALUES ($1, $2, 'directory', $3, 1, $4, NOW())
       ON CONFLICT (path, kind) DO UPDATE
         SET attempts = sys_storage_cleanup.attempts + 1, last_error = EXCLUDED.last_error, last_attempt = NOW()`,
      [tenantId, folder, reason, message],
    ).catch((qe) => logger.error(`Could not queue ${folder} for cleanup: ${(qe as Error).message}`));
    return { removed: false };
  }
}

/** A customer's folder (…/private/customers/{id}) and everything in it. */
export async function deleteCustomerFolders(
  businessId: string, customerIds: string[], reason: string,
): Promise<{ removed: number; queued: number }> {
  const tenantId = await tenantOfBusiness(businessId);
  let removed = 0;
  let queued = 0;
  for (const id of customerIds) {
    const r = await deleteDirectoryOrQueue(storagePaths.customerFolder(tenantId, businessId, id), reason, tenantId);
    if (r.removed) removed += 1; else queued += 1;
  }
  return { removed, queued };
}

/** Retry queued deletions (the scheduled job). */
export async function retryPendingCleanups(limit = 100): Promise<{ attempted: number; done: number; stillPending: number }> {
  const { rows } = await adminPool.query(
    `SELECT id, path, kind FROM sys_storage_cleanup ORDER BY created_at LIMIT $1`, [limit],
  );
  let done = 0;
  for (const r of rows as { id: string; path: string; kind: 'file' | 'directory' }[]) {
    try {
      if (r.kind === 'file') await storage.delete(r.path); else await storage.deleteDirectory(r.path);
      await adminPool.query('DELETE FROM sys_storage_cleanup WHERE id = $1', [r.id]);
      done += 1;
    } catch (e) {
      await adminPool.query(
        `UPDATE sys_storage_cleanup SET attempts = attempts + 1, last_error = $2, last_attempt = NOW() WHERE id = $1`,
        [r.id, ((e as Error).message || 'unknown error').slice(0, MAX_ERROR)],
      );
    }
  }
  const { rows: left } = await adminPool.query('SELECT COUNT(*)::int AS n FROM sys_storage_cleanup');
  return { attempted: rows.length, done, stillPending: left[0].n };
}
