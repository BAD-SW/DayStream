/**
 * Prospect fit signals + Fit Score + territory valuation (spec 31 design §7).
 *
 * TWO SCORES, STRICTLY SEPARATE:
 *   - Overture `confidence` = "is this record real/accurate?" — a source data-quality signal,
 *     an INPUT we may use but do not own. Never computed here.
 *   - DayStream `Fit Score` (0..100) = "how good a DayStream CUSTOMER would this business be?"
 *     — DayStream-owned, the output that matters. A tanning salon can have high Overture
 *     confidence but a low Fit Score.
 *
 * v1 is a TRANSPARENT, CONFIGURABLE weighted rule — a deliberate hypothesis, NOT a learned
 * model (we have no conversion ground truth yet). Raw signals are stored on every prospect so
 * accumulated lifecycle outcomes can later retrain the weights (the learning loop).
 *
 * Pure functions (no I/O) so they unit-test against fixtures, including:
 *   - strong-fit recovery/spa/physio  -> high score / 'strong'
 *   - Exotic Tan (real tanning salon, Facebook-only, no website) -> found but LOW fit
 *   - multi-location operator -> positive contribution
 */

/** Minimal candidate shape the fit layer reads. Overture candidates satisfy this. */
export interface FitInput {
  name: string;
  category: string | null;        // Overture taxonomy.primary
  basicCategory: string | null;
  confidence: number | null;      // Overture 0..1
  phone: string | null;
  website: string | null;
  social: string | null;
  address: string | null;
  reviewCount?: number | null;
  rating?: number | null;
  /** True if this business is one of several locations under the same operator (name-cluster). */
  multiLocation?: boolean;
}

/** Raw fit signals persisted per prospect (stored as JSONB; never discarded). */
export interface FitSignals {
  matched_category: string | null; // the strong/weak bucket we classified it into
  category_fit: 'strong' | 'moderate' | 'weak';
  confidence: number | null;
  has_phone: boolean;
  has_website: boolean;
  has_social: boolean;
  multi_location: boolean;
  review_count: number | null;
  rating: number | null;
  address_complete: boolean;
}

export type FitTier = 'strong' | 'moderate' | 'weak';

/**
 * Configurable Fit Score weights (0..100 total is NOT required; score is clamped to 0..100).
 * Stored as config (sys_system_configurations category 'prospect_fit') with these defaults.
 * Every weight is additive; category fit is the dominant factor by design.
 */
export interface FitWeights {
  categoryStrong: number;   // added when category is a strong-fit bucket
  categoryModerate: number; // added when category is a moderate-fit bucket
  categoryWeak: number;     // added when category is a weak-fit bucket
  hasWebsite: number;       // soft software-readiness signal (a factor, NOT a gate)
  hasPhone: number;
  hasSocial: number;
  multiLocation: number;    // higher potential value
  base: number;             // floor everyone starts from
}

export const DEFAULT_FIT_WEIGHTS: FitWeights = {
  base: 10,
  categoryStrong: 45,
  categoryModerate: 25,
  categoryWeak: 5,
  hasWebsite: 15,
  hasPhone: 10,
  hasSocial: 5,
  multiLocation: 15,
};

/** Fit-tier cutoffs on the 0..100 score (configurable). */
export interface FitTierThresholds {
  strong: number;   // score >= strong -> 'strong'
  moderate: number; // score >= moderate -> 'moderate' (else 'weak')
}

export const DEFAULT_FIT_TIER_THRESHOLDS: FitTierThresholds = {
  strong: 70,
  moderate: 45,
};

/**
 * Category fit classification. Overture taxonomy/basic_category tokens are matched against
 * these buckets. "strong" = DayStream's ideal (recovery/spa/physio/multi-service wellness);
 * "weak" = low-fit (barber/tanning/nail-only). Everything else is "moderate".
 *
 * Kept as data (not hardcoded in the scorer) so it can move to config later. Tokens are
 * substrings matched against lowercased `category + ' ' + basicCategory`.
 */
export const STRONG_CATEGORY_TOKENS = [
  'spa', 'day_spa', 'medical_spa', 'sauna', 'cryotherapy', 'wellness',
  'massage', 'massage_therapy', 'physical_therapy', 'physiotherap', 'recovery',
  'float', 'wellness_service', 'chiropract',
];

export const WEAK_CATEGORY_TOKENS = [
  'tanning', 'tan_salon', 'barber', 'nail_salon', 'nail', 'tattoo',
];

export function classifyCategoryFit(category: string | null, basicCategory: string | null): FitTier {
  const hay = `${(category || '').toLowerCase()} ${(basicCategory || '').toLowerCase()}`;
  // Weak takes precedence: a "nail_salon" inside a broad "spa" category should read weak.
  if (WEAK_CATEGORY_TOKENS.some((t) => hay.includes(t))) {
    // ...unless it ALSO clearly matches a strong bucket beyond the weak token.
    const strongHit = STRONG_CATEGORY_TOKENS.some((t) => hay.includes(t) && !WEAK_CATEGORY_TOKENS.includes(t));
    if (!strongHit) return 'weak';
  }
  if (STRONG_CATEGORY_TOKENS.some((t) => hay.includes(t))) return 'strong';
  return 'moderate';
}

/** Derive the raw, stored fit signals from a candidate. */
export function deriveFitSignals(input: FitInput): FitSignals {
  const categoryFit = classifyCategoryFit(input.category, input.basicCategory);
  return {
    matched_category: input.category ?? input.basicCategory ?? null,
    category_fit: categoryFit,
    confidence: input.confidence ?? null,
    has_phone: !!(input.phone && input.phone.trim()),
    has_website: !!(input.website && input.website.trim()),
    has_social: !!(input.social && input.social.trim()),
    multi_location: !!input.multiLocation,
    review_count: input.reviewCount ?? null,
    rating: input.rating ?? null,
    address_complete: !!(input.address && input.address.trim()),
  };
}

/** Compute a 0..100 Fit Score from signals + weights. Transparent and additive. */
export function computeFitScore(signals: FitSignals, weights: FitWeights = DEFAULT_FIT_WEIGHTS): number {
  let score = weights.base;
  if (signals.category_fit === 'strong') score += weights.categoryStrong;
  else if (signals.category_fit === 'moderate') score += weights.categoryModerate;
  else score += weights.categoryWeak;
  if (signals.has_website) score += weights.hasWebsite;
  if (signals.has_phone) score += weights.hasPhone;
  if (signals.has_social) score += weights.hasSocial;
  if (signals.multi_location) score += weights.multiLocation;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Map a 0..100 score to a tier. */
export function fitTier(score: number, thresholds: FitTierThresholds = DEFAULT_FIT_TIER_THRESHOLDS): FitTier {
  if (score >= thresholds.strong) return 'strong';
  if (score >= thresholds.moderate) return 'moderate';
  return 'weak';
}

export interface FitResult {
  signals: FitSignals;
  score: number;
  tier: FitTier;
}

/** Full fit computation for one candidate. */
export function scoreFit(
  input: FitInput,
  weights: FitWeights = DEFAULT_FIT_WEIGHTS,
  thresholds: FitTierThresholds = DEFAULT_FIT_TIER_THRESHOLDS,
): FitResult {
  const signals = deriveFitSignals(input);
  const score = computeFitScore(signals, weights);
  return { signals, score, tier: fitTier(score, thresholds) };
}

// ---------------------------------------------------------------------------
// Multi-location detection (name-clustering across the territory)
// ---------------------------------------------------------------------------

/**
 * Normalize a business name to a chain key (for grouping LOCATIONS of one operator).
 * Unlike de-dup (name + location), chain detection is name-only BY DESIGN: same name at
 * different addresses = same operator with multiple locations.
 */
export function chainKey(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|llc|inc|pc|llp|co|company|featuring|and|of|at|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Flag multi-location operators across a batch. Returns a Set of indices (into `names`) that
 * belong to a chain key appearing more than once. Caller sets input.multiLocation from this.
 *
 * NOTE: run this on the DE-DUPED set (so two records of the SAME location don't inflate the
 * count into a false "chain"). De-dup collapses same-place dupes first; what remains with a
 * shared name are genuinely distinct locations.
 */
export function detectMultiLocation(names: string[]): Set<number> {
  const counts = new Map<string, number[]>();
  names.forEach((n, i) => {
    const k = chainKey(n);
    if (!k) return;
    const arr = counts.get(k) ?? [];
    arr.push(i);
    counts.set(k, arr);
  });
  const multi = new Set<number>();
  for (const idxs of counts.values()) {
    if (idxs.length > 1) for (const i of idxs) multi.add(i);
  }
  return multi;
}

// ---------------------------------------------------------------------------
// Territory valuation (descriptive: fit-tier counts) — design §7
// ---------------------------------------------------------------------------

export interface TerritoryValuation {
  total: number;
  included: number;        // not held-out
  strong: number;
  moderate: number;
  weak: number;
  averageFitScore: number; // over included prospects (0 if none)
}

/**
 * Descriptive territory valuation: counts by fit tier + average. v1 is explicitly DESCRIPTIVE
 * (NOT a "$ value") per design §7 — predictive valuation is a future learning-loop feature.
 */
export function valuateTerritory(
  prospects: Array<{ fit_score: number | null; fit_tier: FitTier | null; inclusion?: 'included' | 'held' }>,
): TerritoryValuation {
  const v: TerritoryValuation = { total: 0, included: 0, strong: 0, moderate: 0, weak: 0, averageFitScore: 0 };
  let scoreSum = 0;
  for (const p of prospects) {
    v.total++;
    if (p.inclusion === 'held') continue;
    v.included++;
    if (p.fit_tier === 'strong') v.strong++;
    else if (p.fit_tier === 'moderate') v.moderate++;
    else if (p.fit_tier === 'weak') v.weak++;
    scoreSum += p.fit_score ?? 0;
  }
  v.averageFitScore = v.included > 0 ? Math.round(scoreSum / v.included) : 0;
  return v;
}

// ---------------------------------------------------------------------------
// Config loading (defaults in code; optional DB override) — design §7/§8
// ---------------------------------------------------------------------------

export interface FitConfig {
  weights: FitWeights;
  tierThresholds: FitTierThresholds;
}

export const DEFAULT_FIT_CONFIG: FitConfig = {
  weights: DEFAULT_FIT_WEIGHTS,
  tierThresholds: DEFAULT_FIT_TIER_THRESHOLDS,
};

/**
 * Merge a partial override (from sys_system_configurations category 'prospect_fit') over the
 * code defaults. Unknown/missing keys fall back to defaults so a partial config is safe.
 */
export function mergeFitConfig(override: any): FitConfig {
  const o = override || {};
  return {
    weights: { ...DEFAULT_FIT_WEIGHTS, ...(o.weights || {}) },
    tierThresholds: { ...DEFAULT_FIT_TIER_THRESHOLDS, ...(o.tierThresholds || {}) },
  };
}

/**
 * Load the effective fit config: code defaults merged with the optional DB override stored in
 * sys_system_configurations (category 'prospect_fit'). Never throws on missing config — a
 * fresh install with no override simply uses the defaults.
 */
export async function loadFitConfig(): Promise<FitConfig> {
  // Imported lazily so the pure scoring functions above carry no DB dependency.
  const { adminPool } = await import('../db/pool');
  try {
    const { rows } = await adminPool.query(
      `SELECT config_data FROM sys_system_configurations WHERE category = 'prospect_fit'`,
    );
    return mergeFitConfig(rows[0]?.config_data);
  } catch {
    return DEFAULT_FIT_CONFIG;
  }
}
