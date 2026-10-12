import { AsyncLocalStorage } from 'async_hooks';

/**
 * The business the reports of the current request are limited to (null: the whole tenant,
 * for tenant-level users who did not choose a business). The older report services filter
 * by tenant only; they add `bizAnd(column)` to their conditions to respect this.
 */
const reportBusiness = new AsyncLocalStorage<string | null>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function withReportBusiness<T>(businessId: string | null, fn: () => T): T {
  return reportBusiness.run(businessId && UUID_RE.test(businessId) ? businessId : null, fn);
}

export function currentReportBusiness(): string | null {
  return reportBusiness.getStore() ?? null;
}

/** SQL condition limiting `column` to the report's business, or nothing when there is none. */
export function bizAnd(column: string): string {
  const id = currentReportBusiness();
  // The id is a checked UUID, never free text.
  return id ? ` AND ${column} = '${id}'::uuid` : '';
}
