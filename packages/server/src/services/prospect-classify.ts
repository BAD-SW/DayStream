/**
 * Post-query prospect classification (spec 31 design §4).
 *
 * Two reversible, local filters decide whether a STORED prospect is shown as active
 * ('included') or retained-but-hidden ('held'). NEITHER is a query-time exclusion — every
 * record is persisted; these flags re-classify instantly with no re-query, so thresholds and
 * the operator's choice can change freely without re-fetching Overture.
 *
 *   1. Confidence threshold — Overture's data-quality score below a local, tunable cutoff is
 *      held (hold_reason 'confidence'). A learn-locally value; default intentionally lenient.
 *   2. Contact completeness (operator-selectable per run / saved default):
 *        - 'all'            : include everything
 *        - 'phone_or_web'   : require phone OR website  (DEFAULT — weeds thin listings, keeps
 *                             anything reachable, e.g. Exotic Tan via phone)
 *        - 'phone_and_web'  : require phone AND website
 *      A record failing the chosen rule is held (hold_reason 'contact').
 *
 * Precedence: a 'manual' hold set by an operator is never overwritten. Otherwise confidence is
 * evaluated first, then contact — the first failing rule wins the hold_reason.
 *
 * Pure functions (no I/O) so they unit-test against fixtures.
 */

export type Inclusion = 'included' | 'held';
export type HoldReason = 'confidence' | 'contact' | 'manual' | 'closed' | null;

export type ContactFilter = 'all' | 'phone_or_web' | 'phone_and_web';

/** Default operator contact filter (design §4): require phone OR website. */
export const DEFAULT_CONTACT_FILTER: ContactFilter = 'phone_or_web';

/**
 * Default confidence threshold. Deliberately lenient — we do NOT fully understand Overture's
 * confidence, so v1 holds only the clearly-weak records. Tunable via config (0..1); null/<=0
 * disables the confidence hold entirely.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.3;

/** Minimal record shape the classifier reads. */
export interface ClassifyInput {
  confidence: number | null;
  phone: string | null;
  website: string | null;
}

export interface ClassifyOptions {
  contactFilter?: ContactFilter;
  confidenceThreshold?: number | null;
}

export interface Classification {
  inclusion: Inclusion;
  holdReason: HoldReason;
}

function hasText(v: string | null | undefined): boolean {
  return !!(v && String(v).trim());
}

/** Does a record satisfy the chosen contact-completeness rule? */
export function passesContactFilter(input: ClassifyInput, filter: ContactFilter): boolean {
  const phone = hasText(input.phone);
  const web = hasText(input.website);
  switch (filter) {
    case 'all': return true;
    case 'phone_or_web': return phone || web;
    case 'phone_and_web': return phone && web;
    default: return true;
  }
}

/** Does a record meet the local confidence threshold? (null threshold / <=0 => always passes.) */
export function passesConfidence(input: ClassifyInput, threshold: number | null | undefined): boolean {
  if (threshold == null || threshold <= 0) return true;
  // Missing confidence is treated as passing — we never hold purely for an absent signal.
  if (input.confidence == null) return true;
  return input.confidence >= threshold;
}

/**
 * Classify one record into included/held + reason. Confidence is evaluated before contact;
 * the first failing rule sets the hold_reason.
 */
export function classifyProspect(input: ClassifyInput, opts: ClassifyOptions = {}): Classification {
  const contactFilter = opts.contactFilter ?? DEFAULT_CONTACT_FILTER;
  const confidenceThreshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  if (!passesConfidence(input, confidenceThreshold)) {
    return { inclusion: 'held', holdReason: 'confidence' };
  }
  if (!passesContactFilter(input, contactFilter)) {
    return { inclusion: 'held', holdReason: 'contact' };
  }
  return { inclusion: 'included', holdReason: null };
}

/**
 * Re-classify a record while PRESERVING an operator's manual hold. Used when the operator
 * changes the contact filter / threshold and we re-flag stored records without re-querying.
 * A record currently held with reason 'manual' stays held; everything else is recomputed.
 */
export function reclassifyPreservingManual(
  input: ClassifyInput,
  current: { inclusion: Inclusion; holdReason: HoldReason },
  opts: ClassifyOptions = {},
): Classification {
  if (current.inclusion === 'held' && current.holdReason === 'manual') {
    return { inclusion: 'held', holdReason: 'manual' };
  }
  return classifyProspect(input, opts);
}

// ---------------------------------------------------------------------------
// Config loading (defaults in code; optional DB override) — design §4/§8
// ---------------------------------------------------------------------------

export interface ClassifyConfig {
  contactFilter: ContactFilter;
  confidenceThreshold: number | null;
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  contactFilter: DEFAULT_CONTACT_FILTER,
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
};

const VALID_CONTACT_FILTERS: ContactFilter[] = ['all', 'phone_or_web', 'phone_and_web'];

/** Merge a partial override (sys_system_configurations 'prospect_fit'.classify) over defaults. */
export function mergeClassifyConfig(override: any): ClassifyConfig {
  const o = override || {};
  const contactFilter = VALID_CONTACT_FILTERS.includes(o.contactFilter)
    ? (o.contactFilter as ContactFilter)
    : DEFAULT_CONTACT_FILTER;
  const ct = o.confidenceThreshold;
  const confidenceThreshold =
    ct === null ? null
    : typeof ct === 'number' && Number.isFinite(ct) ? ct
    : DEFAULT_CONFIDENCE_THRESHOLD;
  return { contactFilter, confidenceThreshold };
}

/**
 * Load the effective classification config: defaults merged with the optional DB override
 * stored under sys_system_configurations category 'prospect_fit', key 'classify'. Never
 * throws — a fresh install simply uses the defaults.
 */
export async function loadClassifyConfig(): Promise<ClassifyConfig> {
  const { adminPool } = await import('../db/pool');
  try {
    const { rows } = await adminPool.query(
      `SELECT config_data FROM sys_system_configurations WHERE category = 'prospect_fit'`,
    );
    return mergeClassifyConfig(rows[0]?.config_data?.classify);
  } catch {
    return DEFAULT_CLASSIFY_CONFIG;
  }
}
