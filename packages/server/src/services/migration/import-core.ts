import { adminPool } from '../../db/pool';
import { logAudit } from '../audit.service';

/**
 * Shared data-migration pipeline core (spec 50, Wave 1): the parts every entity
 * import reuses — unified customer matching, per-row outcome shape, and run
 * history recording for trial and commit.
 */

export type ImportKind =
  | 'customers' | 'payment_methods' | 'memberships'
  | 'packages' | 'appointments' | 'account_balances' | 'transactions' | 'notes';

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
  /**
   * Rows that were imported successfully but that the owner should know about (e.g. a
   * membership imported with no payment method on file). Not failures — these rows ARE
   * counted as imported. Optional so entity importers that never warn need not set it.
   */
  warnings?: RowFailure[];
}

/** A blank result accumulator. */
export function emptyResult(): ImportResult {
  return { runId: null, total: 0, imported: 0, matched: 0, failed: 0, failures: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// Name-based reference matching (plans, packages, and later services/staff)
// ---------------------------------------------------------------------------

/** Normalize a reference name for comparison: case-, punctuation- and spacing-insensitive. */
export function normalizeRefName(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface NameMatchResult<T> {
  match: T | null;
  /** Plain-language reason when match is null (names the value; says if it was ambiguous). */
  reason: string | null;
}

/**
 * Resolve a row's reference value to ONE candidate by normalized name. No match → null with a
 * reason; more than one candidate sharing the normalized name → null (ambiguous), never a guess.
 * `label` is the kind of thing being matched ("membership plan", "package") for the message.
 */
export function matchByName<T extends { name: string }>(
  candidates: T[], value: string | null | undefined, label: string,
): NameMatchResult<T> {
  const wanted = normalizeRefName(value);
  if (!wanted) return { match: null, reason: `No ${label} name on the row` };
  const hits = candidates.filter((c) => normalizeRefName(c.name) === wanted);
  if (hits.length === 1) return { match: hits[0], reason: null };
  if (hits.length > 1) {
    return { match: null, reason: `More than one ${label} is named "${value}" — rename one so the import can tell them apart` };
  }
  return { match: null, reason: `No ${label} named "${value}" — create it in setup first, or fix the name` };
}

// ---------------------------------------------------------------------------
// Dates: day-first vs month-first
// ---------------------------------------------------------------------------

/** Order of a numeric date's first two parts: month/day (US) or day/month (most of the world). */
export type DateOrder = 'mdy' | 'dmy';

/** A numeric date with separators: 15/03/2026, 3-15-26, 15.03.2026. */
const NUMERIC_DATE_RE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/;

/** A two-digit year: up to 10 years ahead is this century (a booking or expiry), else last (a birth). */
function expandYear(y: number): number {
  if (y >= 100) return y;
  const thisYY = new Date().getUTCFullYear() % 100;
  return y <= thisYY + 10 ? 2000 + y : 1900 + y;
}

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime()) || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Parse a date cell to YYYY-MM-DD, or null. Accepts ISO (2026-03-15), numeric dates with /, - or .
 * separators and 2- or 4-digit years, read in `order` (month-first by default), and finally any
 * string the JavaScript date parser understands ("15 March 2026", "Mar 15, 2026").
 */
export function parseDateCell(value: string | null | undefined, order: DateOrder = 'mdy'): string | null {
  const s = (value || '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const num = s.match(NUMERIC_DATE_RE);
  if (num) {
    const a = Number(num[1]); const b = Number(num[2]); const y = expandYear(Number(num[3]));
    return order === 'dmy' ? ymd(y, b, a) : ymd(y, a, b);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Work out a file's date order from its values: a first part over 12 can only be a day (day-first),
 * a second part over 12 can only be a day (month-first). Returns null when the values can't tell
 * (every part is 12 or under) or contradict each other.
 */
export function detectDateOrder(values: Array<string | null | undefined>): DateOrder | null {
  let dayFirst = 0; let monthFirst = 0;
  for (const v of values) {
    const m = (v || '').trim().match(NUMERIC_DATE_RE);
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst++;
    if (Number(m[2]) > 12) monthFirst++;
  }
  if (dayFirst > 0 && monthFirst === 0) return 'dmy';
  if (monthFirst > 0 && dayFirst === 0) return 'mdy';
  return null;
}

/** Countries that write dates month-first. Everywhere else is day-first. */
const MONTH_FIRST_COUNTRIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'PH', 'FM', 'MH', 'PW']);

/**
 * The business's own date order, for files whose values can't tell: from its location's country,
 * else the country of its phone number. Month-first when neither is known (the previous behavior).
 */
export async function businessDateOrder(businessId: string): Promise<DateOrder> {
  const { rows } = await adminPool.query(
    `SELECT l.country AS location_country, b.phone
     FROM sys_businesses b
     LEFT JOIN LATERAL (
       SELECT country FROM sys_locations WHERE business_id = b.id AND country IS NOT NULL ORDER BY created_at LIMIT 1
     ) l ON true
     WHERE b.id = $1`,
    [businessId],
  ).catch(() => ({ rows: [] as Array<{ location_country: string | null; phone: string | null }> }));
  let country = (rows[0]?.location_country || '').toUpperCase();
  if (!country && rows[0]?.phone) {
    const { parsePhoneNumberFromString } = await import('libphonenumber-js');
    country = (parsePhoneNumberFromString(String(rows[0].phone))?.country || '').toUpperCase();
  }
  if (!country) return 'mdy';
  return MONTH_FIRST_COUNTRIES.has(country) ? 'mdy' : 'dmy';
}

/**
 * The date order for one import file: read from all of its date columns together (one export uses
 * one format), else the business's own order.
 */
export async function fileDateOrder(
  businessId: string, rows: Array<Record<string, string>>, dateFields: string[], known?: DateOrder | null,
): Promise<DateOrder> {
  // The order detected over the WHOLE file at analyze time wins: a file is committed in batches,
  // and each batch working out its own order could read 05/04 differently from the next.
  if (known) return known;
  const values = rows.flatMap((r) => dateFields.map((f) => r[f]));
  return detectDateOrder(values) ?? (await businessDateOrder(businessId));
}

// ---------------------------------------------------------------------------
// Unified customer matching (Requirement 11): legacy id preferred, else
// identity service (email, then unique phone). Never creates a customer — only
// resolves to an existing one for the customer-ASSOCIATED imports.
// ---------------------------------------------------------------------------

export interface CustomerMatchInput {
  /** Processor customer ids from the file (e.g. Stripe's old and new cus_ ids), tried first. */
  processorCustomerIds?: Array<string | null | undefined>;
  legacyCustomerId?: string | null;
  email?: string | null;
  phone?: string | null;
}

export type MatchKey = 'processor_id' | 'legacy_id' | 'email' | 'phone';

export interface CustomerMatch {
  customerId: string | null;
  matchedBy: MatchKey | null;
  /**
   * Set when the row's keys point to DIFFERENT customers (e.g. the legacy id is Ana's but the email
   * is Maria's). The row is not attached to anyone; this is the plain-language reason to show.
   */
  conflict?: string;
}

/** A customer found by at least one of the row's keys, and which keys found it. */
export interface MatchCandidate {
  id: string;
  name: string;
  byProcessor: boolean;
  byLegacy: boolean;
  byEmail: boolean;
  byPhone: boolean;
}

const KEY_ORDER: Array<{ key: MatchKey; flag: keyof Pick<MatchCandidate, 'byProcessor' | 'byLegacy' | 'byEmail' | 'byPhone'> }> = [
  { key: 'processor_id', flag: 'byProcessor' },
  { key: 'legacy_id', flag: 'byLegacy' },
  { key: 'email', flag: 'byEmail' },
  { key: 'phone', flag: 'byPhone' },
];

/** How a key and its value read in a reason ("legacy ID "RE9284A""). */
function describeKey(key: MatchKey, input: CustomerMatchInput): string {
  switch (key) {
    case 'processor_id': return `processor customer ID "${(input.processorCustomerIds ?? []).filter((v) => (v || '').trim()).join('" / "')}"`;
    case 'legacy_id': return `legacy ID "${(input.legacyCustomerId || '').trim()}"`;
    case 'email': return `email "${(input.email || '').trim()}"`;
    default: return `phone "${(input.phone || '').trim()}"`;
  }
}

/**
 * Decide the customer from every customer any key found (pure, so it can be tested without a
 * database). Each key counts only when it found EXACTLY ONE customer: a shared email or phone is
 * ignored rather than guessed. When the counting keys agree, the strongest key is reported as the
 * match; when they point to different customers, nothing is attached and the conflict is explained.
 */
export function resolveCustomerMatch(candidates: MatchCandidate[], input: CustomerMatchInput): CustomerMatch {
  const resolved: Array<{ key: MatchKey; customer: MatchCandidate }> = [];
  for (const { key, flag } of KEY_ORDER) {
    const hits = candidates.filter((c) => c[flag]);
    if (hits.length === 1) resolved.push({ key, customer: hits[0] });
  }
  if (resolved.length === 0) return { customerId: null, matchedBy: null };

  const distinct = [...new Map(resolved.map((r) => [r.customer.id, r])).values()];
  if (distinct.length > 1) {
    const parts = distinct.map((d) => `the ${describeKey(d.key, input)} matches ${d.customer.name}`);
    return {
      customerId: null, matchedBy: null,
      conflict: `This row points to different customers: ${parts.join(', but ')}. Fix the row so its details belong to the same customer`,
    };
  }
  return { customerId: resolved[0].customer.id, matchedBy: resolved[0].key };
}

/**
 * Resolve the DayStream customer a row belongs to, checking EVERY key the row has (processor
 * customer id, legacy customer id, email, phone) in one query, then deciding with
 * resolveCustomerMatch: keys that agree resolve the customer; keys that disagree fail the row with
 * a conflict reason instead of silently picking one. With no key resolving, the caller fails the
 * row with noCustomerReason.
 */
export async function matchCustomer(businessId: string, input: CustomerMatchInput): Promise<CustomerMatch> {
  const processorIds = [...new Set((input.processorCustomerIds ?? []).map((v) => (v || '').trim()).filter(Boolean))];
  const legacy = (input.legacyCustomerId || '').trim() || null;
  const email = (input.email || '').trim().toLowerCase() || null;
  const phone = (input.phone || '').trim() || null;
  if (processorIds.length === 0 && !legacy && !email && !phone) return { customerId: null, matchedBy: null };

  const { rows } = await adminPool.query<{
    id: string; first_name: string | null; last_name: string | null; email: string | null;
    by_processor: boolean; by_legacy: boolean; by_email: boolean; by_phone: boolean;
  }>(
    `SELECT id, first_name, last_name, email,
            COALESCE(processor_customer_id = ANY($2::text[]), false) AS by_processor,
            COALESCE(legacy_customer_id = $3, false) AS by_legacy,
            COALESCE(LOWER(email) = $4, false) AS by_email,
            COALESCE(phone = $5 OR phone_e164 = $5, false) AS by_phone
     FROM cus_customers
     WHERE business_id = $1 AND status <> 'merged'
       AND (processor_customer_id = ANY($2::text[]) OR legacy_customer_id = $3
            OR LOWER(email) = $4 OR phone = $5 OR phone_e164 = $5)
     LIMIT 20`,
    [businessId, processorIds, legacy, email, phone],
  );
  return resolveCustomerMatch(rows.map((r) => ({
    id: r.id,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email || 'a customer with no name',
    byProcessor: r.by_processor, byLegacy: r.by_legacy, byEmail: r.by_email, byPhone: r.by_phone,
  })), input);
}

/**
 * The customer keys of a field-mapped row, for matchCustomer and noCustomerReason. Every
 * customer-linked import uses this so they all match the same way (Requirement 19).
 */
export function customerMatchInput(r: Record<string, string | undefined>): CustomerMatchInput {
  return {
    processorCustomerIds: [r.processor_customer_id],
    legacyCustomerId: r.legacy_customer_id, email: r.email, phone: r.phone,
  };
}

/**
 * A plain-language "no customer" failure reason naming what was looked for. Accepts either the
 * match input or a field-mapped file row (snake_case keys such as legacy_customer_id) — most
 * importers pass the row, and reading only the camelCase keys made every reason say "no
 * identifier on the row" even when the row had one.
 */
export function noCustomerReason(input: CustomerMatchInput & { legacy_customer_id?: string }): string {
  const tried: string[] = [];
  const processorIds = [...new Set((input.processorCustomerIds ?? []).map((v) => (v || '').trim()).filter(Boolean))];
  if (processorIds.length) tried.push(`processor customer id "${processorIds.join('" / "')}"`);
  const legacy = (input.legacyCustomerId || input.legacy_customer_id || '').trim();
  if (legacy) tried.push(`legacy id "${legacy}"`);
  if ((input.email || '').trim()) tried.push(`email "${input.email}"`);
  if ((input.phone || '').trim()) tried.push(`phone "${input.phone}"`);
  if (tried.length === 0) return 'No customer identifier on the row (need a legacy id, email, or phone)';
  return `No single matching customer for ${tried.join(' / ')} — import customers first, or fix the identifier (a shared email or phone matching several customers is not used)`;
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
