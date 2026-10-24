import { adminPool } from '../../db/pool';
import { logAudit } from '../audit.service';

/**
 * Shared data-migration pipeline core (spec 50, Wave 1): the parts every entity
 * import reuses — unified customer matching, per-row outcome shape, and run
 * history recording for trial and commit.
 */

export type ImportKind =
  | 'customers' | 'payment_methods' | 'memberships'
  | 'packages' | 'appointments' | 'account_balances' | 'transactions';

export type RowOutcome = 'imported' | 'matched' | 'failed';

export interface RowFailure {
  row: number;        // 1-based source row number (data row, not counting a header)
  field: string;
  message: string;
}

export interface ImportResult {
  runId: string | null;
  total: number;
  imported: number;
  matched: number;
  failed: number;
  failures: RowFailure[];
}

/** A blank result accumulator. */
export function emptyResult(): ImportResult {
  return { runId: null, total: 0, imported: 0, matched: 0, failed: 0, failures: [] };
}

// ---------------------------------------------------------------------------
// Unified customer matching (Requirement 11): legacy id preferred, else
// identity service (email, then unique phone). Never creates a customer — only
// resolves to an existing one for the customer-ASSOCIATED imports.
// ---------------------------------------------------------------------------

export interface CustomerMatchInput {
  legacyCustomerId?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CustomerMatch {
  customerId: string | null;
  matchedBy: 'legacy_id' | 'email' | 'phone' | null;
}

/**
 * Resolve the DayStream customer a row belongs to. Preferred key is the legacy
 * customer id captured at customer import (exact, unambiguous); falls back to
 * email (case-insensitive) then a unique phone. Returns a null id when nothing
 * resolves, so the caller can fail the row with a clear reason.
 */
export async function matchCustomer(businessId: string, input: CustomerMatchInput): Promise<CustomerMatch> {
  const legacy = (input.legacyCustomerId || '').trim();
  if (legacy) {
    const { rows } = await adminPool.query(
      `SELECT id FROM cus_customers
       WHERE business_id = $1 AND legacy_customer_id = $2 AND status <> 'merged'
       LIMIT 2`,
      [businessId, legacy],
    );
    if (rows.length === 1) return { customerId: rows[0].id, matchedBy: 'legacy_id' };
    // 0 → fall through to email/phone; 2+ → ambiguous legacy id, also fall through.
  }

  const email = (input.email || '').trim().toLowerCase();
  if (email) {
    const { rows } = await adminPool.query(
      `SELECT id FROM cus_customers
       WHERE business_id = $1 AND LOWER(email) = $2 AND status <> 'merged'
       LIMIT 2`,
      [businessId, email],
    );
    if (rows.length === 1) return { customerId: rows[0].id, matchedBy: 'email' };
  }

  const phone = (input.phone || '').trim();
  if (phone) {
    const { rows } = await adminPool.query(
      `SELECT id FROM cus_customers
       WHERE business_id = $1 AND (phone = $2 OR phone_e164 = $2) AND status <> 'merged'
       LIMIT 2`,
      [businessId, phone],
    );
    if (rows.length === 1) return { customerId: rows[0].id, matchedBy: 'phone' };
  }

  return { customerId: null, matchedBy: null };
}

/** A plain-language "no customer" failure reason naming what was looked for. */
export function noCustomerReason(input: CustomerMatchInput): string {
  const tried: string[] = [];
  if ((input.legacyCustomerId || '').trim()) tried.push(`legacy id "${input.legacyCustomerId}"`);
  if ((input.email || '').trim()) tried.push(`email "${input.email}"`);
  if ((input.phone || '').trim()) tried.push(`phone "${input.phone}"`);
  if (tried.length === 0) return 'No customer identifier on the row (need a legacy id, email, or phone)';
  return `No matching customer for ${tried.join(' / ')} — import customers first, or fix the identifier`;
}

// ---------------------------------------------------------------------------
// Run history recording (trial and commit)
// ---------------------------------------------------------------------------

/**
 * Persist an Import Run row (trial or commit) with its counts, and return the
 * result augmented with the new runId. Non-fatal: a failure to record the run
 * must not lose the import result, so it logs and returns the result unchanged.
 */
export async function recordRun(args: {
  tenantId: string;
  businessId: string;
  entity: ImportKind;
  fileName: string | null;
  isTrial: boolean;
  performedBy: string | null;
  result: ImportResult;
}): Promise<ImportResult> {
  const { tenantId, businessId, entity, fileName, isTrial, performedBy, result } = args;
  try {
    const { rows } = await adminPool.query(
      `INSERT INTO mig_import_runs
         (tenant_id, business_id, entity, file_name, total_rows, imported, matched, failed, status, is_trial, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10)
       RETURNING id`,
      [tenantId, businessId, entity, fileName, result.total, result.imported, result.matched, result.failed, isTrial, performedBy],
    );
    const runId = rows[0]?.id ?? null;
    await logAudit({
      tenantId, userId: performedBy || undefined,
      action: isTrial ? 'import.trial' : 'import.commit',
      resourceType: 'import_run', resourceId: runId || undefined,
      details: { entity, file_name: fileName, total: result.total, imported: result.imported, matched: result.matched, failed: result.failed },
    }).catch(() => {});
    return { ...result, runId };
  } catch {
    return result;
  }
}

export interface RunSummary {
  id: string;
  entity: ImportKind;
  file_name: string | null;
  total_rows: number;
  imported: number;
  matched: number;
  failed: number;
  is_trial: boolean;
  performed_by_name: string | null;
  created_at: string;
}

/** Recent import runs for a business (all kinds, trial + committed, newest first). */
export async function listRuns(businessId: string, limit = 50): Promise<RunSummary[]> {
  const { rows } = await adminPool.query(
    `SELECT r.id, r.entity, r.file_name, r.total_rows, r.imported, r.matched, r.failed,
            r.is_trial, r.created_at,
            NULLIF(BTRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS performed_by_name
     FROM mig_import_runs r
     LEFT JOIN usr_users u ON u.id = r.performed_by
     WHERE r.business_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [businessId, Math.min(limit, 200)],
  );
  return rows;
}

/** One run's summary. */
export async function getRun(id: string, businessId: string): Promise<RunSummary | null> {
  const { rows } = await adminPool.query(
    `SELECT r.id, r.entity, r.file_name, r.total_rows, r.imported, r.matched, r.failed,
            r.is_trial, r.created_at,
            NULLIF(BTRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS performed_by_name
     FROM mig_import_runs r
     LEFT JOIN usr_users u ON u.id = r.performed_by
     WHERE r.id = $1 AND r.business_id = $2`,
    [id, businessId],
  );
  return rows[0] ?? null;
}
